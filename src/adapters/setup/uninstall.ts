import fs from 'fs';
import path from 'path';
import { SKILL_MARKER } from './skill';
import { removeStopHook } from './settings';
import { classifyRegistration } from './command';
import { readSettings, readRegistration, writeSettingsFile } from './claude-files';
import { removeRuntime } from './runtime';
import type { SetupCtx } from './claude';

/** Returns true when a registration that starts the launcher is still there. */
async function mcpStep(ctx: SetupCtx): Promise<boolean> {
  const { io } = ctx;
  const reg = readRegistration(ctx.claudeJson);
  if (reg === null) {
    io.out('MCP server: not set up.');
    return false;
  }
  const kind = classifyRegistration(reg, { command: ctx.prefix.command, args: ctx.serverArgs });
  if (ctx.opts.ownedOnly && kind !== 'current') {
    io.out(`MCP server: gournal is registered as "${ctx.shown(reg.command, reg.args)}", not as the launcher of this gournal home. Kept.`);
    return false;
  }
  io.out(`MCP server: remove the gournal registration (claude ${ctx.removeArgs.join(' ')}).`);
  if (!(await ctx.ask('Remove the gournal MCP registration?', true))) {
    io.out('MCP server: kept.');
    return kind === 'current';
  }
  const res = await ctx.runClaude(ctx.removeArgs);
  if (res === 'ok') {
    io.out('MCP server: removed.');
    return false;
  }
  if (res === 'missing') {
    io.out(`MCP server: the claude CLI was not found on PATH. Run this command yourself:\n  claude ${ctx.removeArgs.join(' ')}`);
  }
  ctx.status = 1; // The registration is still there. Do not exit 0.
  return kind === 'current';
}

async function skillStep(ctx: SetupCtx): Promise<void> {
  const { io, skillFile } = ctx;
  if (!fs.existsSync(skillFile)) return void io.out('Skill: not set up.');
  if (!fs.readFileSync(skillFile, 'utf8').includes(SKILL_MARKER)) {
    return void io.out(`Skill: ${skillFile} was not written by gournal. Left alone.`);
  }
  io.out(`Skill: remove ${skillFile}.`);
  if (await ctx.ask('Remove the gournal skill?', true)) {
    fs.rmSync(skillFile, { force: true });
    try { fs.rmdirSync(path.dirname(skillFile)); } catch { /* not empty: keep it */ }
    io.out('Skill: removed.');
  } else io.out('Skill: kept.');
}

/** Returns true when a gournal Stop hook is still there, or when settings.json cannot be read. */
async function hookStep(ctx: SetupCtx): Promise<boolean> {
  const { io, settingsFile, backupFile } = ctx;
  const read = readSettings(settingsFile);
  if (read.kind === 'invalid') {
    io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
    ctx.status = 1;
    return true;
  }
  const { next, changed } = removeStopHook(read.settings, ctx.hook);
  if (!changed) {
    io.out('Stop hook: not set up.');
    return false;
  }
  // Only a backup that install took before its first write holds the original file.
  const hasOriginal = fs.existsSync(backupFile);
  io.out(`Stop hook: remove the gournal hook from ${settingsFile}${hasOriginal ? ` (original backup: ${backupFile})` : ''}.`);
  if (await ctx.ask('Remove the gournal Stop hook?', true)) {
    writeSettingsFile(ctx, read, next, false);
    io.out(`Stop hook: removed.${hasOriginal ? ` The original file is kept at ${backupFile}.` : ''}`);
    return false;
  }
  io.out('Stop hook: kept.');
  return true;
}

async function launcherStep(ctx: SetupCtx, pinnedBy: string[]): Promise<void> {
  const { io, paths } = ctx;
  if (!fs.existsSync(paths.launcher) && !fs.existsSync(paths.runtimeDir)) return void io.out('Launcher: not set up.');
  if (pinnedBy.length > 0) {
    return void io.out(`Launcher: kept, because ${pinnedBy.join(' and ')} still start${pinnedBy.length === 1 ? 's' : ''} it. Run this command again when you have fixed that.`);
  }
  io.out(`Launcher: remove ${paths.launcher} and ${paths.runtimeDir}.`);
  if (await ctx.ask('Remove the gournal launcher?', true)) {
    removeRuntime(io.gournalHome, ctx.platform);
    io.out('Launcher: removed.');
  } else io.out('Launcher: kept.');
}

export async function uninstallFlow(ctx: SetupCtx): Promise<void> {
  const pinnedBy: string[] = [];
  if (await mcpStep(ctx)) pinnedBy.push('the MCP registration');
  await skillStep(ctx);
  if (await hookStep(ctx)) pinnedBy.push('the Stop hook');
  await launcherStep(ctx, pinnedBy);
}
