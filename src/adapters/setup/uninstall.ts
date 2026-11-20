import fs from 'fs';
import path from 'path';
import { SKILL_MARKER } from './skill';
import { removeStopHook } from './settings';
import { readSettings, readRegistration, writeSettingsFile } from './claude-files';
import { removeRuntime } from './runtime';
import type { SetupCtx } from './claude';

async function mcpStep(ctx: SetupCtx): Promise<void> {
  const { io } = ctx;
  if (readRegistration(ctx.claudeJson) === null) return void io.out('MCP server: not set up.');
  io.out(`MCP server: remove the gournal registration (claude ${ctx.removeArgs.join(' ')}).`);
  if (!(await ctx.ask('Remove the gournal MCP registration?', true))) return void io.out('MCP server: kept.');
  const res = await ctx.runClaude(ctx.removeArgs);
  if (res === 'ok') io.out('MCP server: removed.');
  else if (res === 'missing') {
    io.out(`MCP server: the claude CLI was not found on PATH. Run this command yourself:\n  claude ${ctx.removeArgs.join(' ')}`);
    ctx.status = 1; // The registration is still there. Do not exit 0.
  } else ctx.status = 1;
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

async function hookStep(ctx: SetupCtx): Promise<void> {
  const { io, settingsFile, backupFile } = ctx;
  const read = readSettings(settingsFile);
  if (read.kind === 'invalid') {
    io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
    ctx.status = 1;
    return;
  }
  const { next, changed } = removeStopHook(read.settings, ctx.hook);
  if (!changed) return void io.out('Stop hook: not set up.');
  // Only a backup that install took before its first write holds the original file.
  const hasOriginal = fs.existsSync(backupFile);
  io.out(`Stop hook: remove the gournal hook from ${settingsFile}${hasOriginal ? ` (original backup: ${backupFile})` : ''}.`);
  if (await ctx.ask('Remove the gournal Stop hook?', true)) {
    writeSettingsFile(ctx, read, next, false);
    io.out(`Stop hook: removed.${hasOriginal ? ` The original file is kept at ${backupFile}.` : ''}`);
  } else io.out('Stop hook: kept.');
}

async function launcherStep(ctx: SetupCtx): Promise<void> {
  const { io, paths } = ctx;
  if (!fs.existsSync(paths.launcher) && !fs.existsSync(paths.runtimeDir)) return void io.out('Launcher: not set up.');
  io.out(`Launcher: remove ${paths.launcher} and ${paths.runtimeDir}.`);
  if (await ctx.ask('Remove the gournal launcher?', true)) {
    removeRuntime(io.gournalHome, ctx.platform);
    io.out('Launcher: removed.');
  } else io.out('Launcher: kept.');
}

export async function uninstallFlow(ctx: SetupCtx): Promise<void> {
  await mcpStep(ctx);
  await skillStep(ctx);
  await hookStep(ctx);
  await launcherStep(ctx);
}
