import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { newId } from '../../core';
import { resolveGournalCommand, shellQuote, type CommandEnv } from './command';
import { SKILL_MARKER, SKILL_MD } from './skill';
import { addStopHook, removeStopHook } from './settings';

/** ENOENT (the binary is missing) maps to code 127. */
export type CommandRunner = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface SetupIo {
  out(t: string): void;
  err(t: string): void;
  /** The user's home. Every path derives from it. */
  home: string;
  isTTY: boolean;
  confirm(message: string, def: boolean): Promise<boolean>;
  exec: CommandRunner;
  /** Test seam. The default reads process.argv, process.execPath and PATH. */
  env?: CommandEnv;
}

export interface SetupOptions { uninstall: boolean; yes: boolean; hook: boolean }

/** Production runner: execFile, no shell. */
export const execFileRunner: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => {
      if (error === null) return resolve({ code: 0, stdout, stderr });
      const e = error as NodeJS.ErrnoException & { code?: string | number };
      if (e.code === 'ENOENT') return resolve({ code: 127, stdout, stderr: e.message });
      resolve({ code: typeof e.code === 'number' ? e.code : 1, stdout, stderr: stderr || e.message });
    });
  });

type Json = Record<string, unknown>;
const SERVER = 'gournal';

function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${newId()}.tmp`);
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

type SettingsRead = { kind: 'ok'; settings: Json; exists: boolean } | { kind: 'invalid' };

function readSettings(file: string): SettingsRead {
  if (!fs.existsSync(file)) return { kind: 'ok', settings: {}, exists: false };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { kind: 'ok', settings: parsed as Json, exists: true };
    }
  } catch { /* fall through */ }
  return { kind: 'invalid' };
}

function readRegistration(claudeJson: string): { command: string; args: string[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeJson, 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
    const s = parsed.mcpServers?.[SERVER];
    if (!s) return null;
    return {
      command: typeof s.command === 'string' ? s.command : '',
      args: Array.isArray(s.args) ? s.args.map(String) : [],
    };
  } catch {
    return null;
  }
}

const shown = (command: string, args: string[]): string => [command, ...args].map(shellQuote).join(' ');

export async function setupClaude(io: SetupIo, opts: SetupOptions): Promise<number> {
  const claudeDir = path.join(io.home, '.claude');
  const claudeJson = path.join(io.home, '.claude.json');
  const skillFile = path.join(claudeDir, 'skills', 'gournal', 'SKILL.md');
  const settingsFile = path.join(claudeDir, 'settings.json');
  const env = io.env ?? { argv1: process.argv[1] ?? '', execPath: process.execPath, path: process.env.PATH ?? '' };
  const cmd = resolveGournalCommand(env);
  const serverArgs = [...cmd.args, 'mcp'];
  const hookCommand = [cmd.command, ...cmd.args, 'hook', 'stop'].map(shellQuote).join(' ');
  const addArgs = ['mcp', 'add', '--scope', 'user', SERVER, '--', cmd.command, ...serverArgs];
  const removeArgs = ['mcp', 'remove', '--scope', 'user', SERVER];
  const manualAdd = `claude ${shown(addArgs[0]!, addArgs.slice(1))}`;
  let status = 0;

  const ask = (message: string, def: boolean): Promise<boolean> => (opts.yes ? Promise.resolve(true) : io.confirm(message, def));

  if (!opts.yes && !io.isTTY) {
    const verb = opts.uninstall ? 'remove' : 'make';
    io.out(`gournal setup claude would ${verb} these changes:`);
    if (opts.uninstall) {
      io.out(`  1. Remove the MCP registration: claude ${removeArgs.join(' ')}`);
      io.out(`  2. Remove ${skillFile} (only if gournal wrote it)`);
      io.out(`  3. Remove the gournal Stop hook from ${settingsFile}`);
    } else {
      io.out(`  1. Register the MCP server: ${manualAdd}`);
      io.out(`  2. Write the skill file ${skillFile}`);
      io.out(`  3. Optional, with --hook: add a Stop hook to ${settingsFile}: ${hookCommand}`);
    }
    io.err('Not a terminal. Run it again with --yes to apply these changes.');
    return 1;
  }

  const runClaude = async (args: string[]): Promise<'ok' | 'missing' | 'failed'> => {
    const r = await io.exec('claude', args);
    if (r.code === 0) return 'ok';
    if (r.code === 127) return 'missing';
    io.err(`claude ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
    return 'failed';
  };

  const registerMcp = async (): Promise<void> => {
    const res = await runClaude(addArgs);
    if (res === 'ok') io.out('MCP server: registered.');
    else if (res === 'missing') {
      io.out('MCP server: the claude CLI was not found. Run this command yourself:');
      io.out(`  ${manualAdd}`);
    } else status = 1;
  };

  const writeSettings = (read: Extract<SettingsRead, { kind: 'ok' }>, next: Json): void => {
    if (read.exists) fs.copyFileSync(settingsFile, `${settingsFile}.gournal-backup`);
    writeAtomic(settingsFile, JSON.stringify(next, null, 2) + '\n');
  };

  if (!opts.uninstall) {
    // 1. MCP registration
    const reg = readRegistration(claudeJson);
    if (reg === null) {
      io.out(`MCP server: register gournal for all projects (${manualAdd}).`);
      if (await ask('Register the gournal MCP server with Claude Code?', true)) await registerMcp();
      else io.out('MCP server: skipped.');
    } else if (reg.command === cmd.command && JSON.stringify(reg.args) === JSON.stringify(serverArgs)) {
      io.out('MCP server: already set up.');
    } else {
      io.out(`MCP server: gournal is registered as "${shown(reg.command, reg.args)}". Setup would use "${shown(cmd.command, serverArgs)}".`);
      if (await io.confirm('Replace the existing gournal MCP registration?', false)) {
        if ((await runClaude(removeArgs)) === 'ok') await registerMcp();
        else {
          io.out('MCP server: the claude CLI could not remove the old registration. Run these yourself:');
          io.out(`  claude ${removeArgs.join(' ')}`);
          io.out(`  ${manualAdd}`);
        }
      } else io.out('MCP server: kept the existing registration.');
    }

    // 2. Skill file
    const current = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : null;
    if (current === SKILL_MD) io.out('Skill: already set up.');
    else if (current !== null && !current.includes(SKILL_MARKER)) {
      io.out(`Skill: ${skillFile} exists and gournal did not write it. Left alone.`);
    } else {
      io.out(`Skill: ${current === null ? 'write' : 'update'} ${skillFile}.`);
      if (await ask('Install the gournal skill?', true)) {
        writeAtomic(skillFile, SKILL_MD);
        io.out('Skill: installed.');
      } else io.out('Skill: skipped.');
    }

    // 3. Stop hook (opt in)
    if (opts.yes && !opts.hook) {
      io.out('Stop hook: not enabled (add --hook to enable it).');
    } else {
      const read = readSettings(settingsFile);
      if (read.kind === 'invalid') {
        io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
        status = 1;
      } else {
        const { next, changed } = addStopHook(read.settings, hookCommand);
        if (!changed) io.out('Stop hook: already set up.');
        else {
          io.out(`Stop hook: add "${hookCommand}" to ${settingsFile} (backup: settings.json.gournal-backup).`);
          if (await ask('Add the gournal Stop hook?', opts.hook)) {
            writeSettings(read, next);
            io.out('Stop hook: added.');
          } else io.out('Stop hook: skipped.');
        }
      }
    }
    return status;
  }

  // Uninstall
  if (readRegistration(claudeJson) === null) io.out('MCP server: not set up.');
  else {
    io.out(`MCP server: remove the gournal registration (claude ${removeArgs.join(' ')}).`);
    if (await ask('Remove the gournal MCP registration?', true)) {
      const res = await runClaude(removeArgs);
      if (res === 'ok') io.out('MCP server: removed.');
      else if (res === 'missing') io.out(`MCP server: the claude CLI was not found. Run this command yourself:\n  claude ${removeArgs.join(' ')}`);
      else status = 1;
    } else io.out('MCP server: kept.');
  }

  if (!fs.existsSync(skillFile)) io.out('Skill: not set up.');
  else if (!fs.readFileSync(skillFile, 'utf8').includes(SKILL_MARKER)) {
    io.out(`Skill: ${skillFile} was not written by gournal. Left alone.`);
  } else {
    io.out(`Skill: remove ${skillFile}.`);
    if (await ask('Remove the gournal skill?', true)) {
      fs.rmSync(skillFile, { force: true });
      try { fs.rmdirSync(path.dirname(skillFile)); } catch { /* not empty: keep it */ }
      io.out('Skill: removed.');
    } else io.out('Skill: kept.');
  }

  const read = readSettings(settingsFile);
  if (read.kind === 'invalid') {
    io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
    status = 1;
  } else {
    const { next, changed } = removeStopHook(read.settings);
    if (!changed) io.out('Stop hook: not set up.');
    else {
      io.out(`Stop hook: remove the gournal hook from ${settingsFile} (backup: settings.json.gournal-backup).`);
      if (await ask('Remove the gournal Stop hook?', true)) {
        writeSettings(read, next);
        io.out('Stop hook: removed.');
      } else io.out('Stop hook: kept.');
    }
  }
  return status;
}
