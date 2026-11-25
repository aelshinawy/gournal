import fs from 'fs';
import path from 'path';
import { SKILL_MARKER, SKILL_MD } from './skill';
import { addStopHook } from './settings';
import { classifyRegistration } from './command';
import { SERVER, writeAtomic, readSettings, readRegistration, writeSettingsFile } from './claude-files';
import { makeLauncherStep, type LauncherStep } from './ensure-launcher';
import { copyHomeOf } from './source';
import { PACKAGE_ROOT } from './package-copy';
import { installSkill } from './claude-skill';
import type { Ctx } from './claude-ctx';

const NO_LAUNCHER_MCP = 'MCP server: skipped, because the launcher is not installed.';
const NO_LAUNCHER_HOOK = 'Stop hook: skipped, because the launcher is not installed.';

async function registerMcp(ctx: Ctx): Promise<'ok' | 'missing' | 'failed'> {
  const { io } = ctx;
  const res = await ctx.runClaude(ctx.addArgs);
  if (res === 'ok') io.out('MCP server: registered.');
  else if (res === 'missing') {
    io.out('MCP server: the claude CLI was not found on PATH. Run this command yourself:');
    io.out(`  ${ctx.manualAdd}`);
    ctx.status = 1; // Nothing is registered. Do not exit 0.
  } else {
    // On Windows the failure can be an argument that cmd.exe cannot quote. Print the line to run by hand.
    if (ctx.platform === 'win32') io.out(`MCP server: could not register. Run this command yourself:\n  ${ctx.manualAdd}`);
    ctx.status = 1;
  }
  return res;
}

async function replaceMcp(ctx: Ctx, old: { command: string; args: string[] }): Promise<void> {
  const { io } = ctx;
  const removed = await ctx.runClaude(ctx.removeArgs);
  if (removed === 'ok') {
    if ((await registerMcp(ctx)) === 'failed') {
      io.out('MCP server: the old registration was removed. To restore it, run:');
      io.out(`  claude mcp add --scope user ${SERVER} -- ${ctx.shown(old.command, old.args)}`);
    }
  } else if (removed === 'missing') {
    io.out('MCP server: the claude CLI was not found on PATH. Run these yourself:');
    io.out(`  claude ${ctx.removeArgs.join(' ')}`);
    io.out(`  ${ctx.manualAdd}`);
    ctx.status = 1;
  } else ctx.status = 1;
}

async function mcpStep(ctx: Ctx, launcher: LauncherStep): Promise<void> {
  const { io } = ctx;
  const reg = readRegistration(ctx.claudeJson);
  if (reg === null) {
    io.out(`MCP server: register gournal for all projects (${ctx.manualAdd}).`);
    if (!(await ctx.ask('Register the gournal MCP server with Claude Code?', true))) io.out('MCP server: skipped.');
    else if (launcher.ensure()) await registerMcp(ctx);
    else io.out(NO_LAUNCHER_MCP);
    return;
  }
  const now = { command: ctx.prefix.command, args: ctx.serverArgs };
  const kind = classifyRegistration(reg, now);
  if (kind === 'current') {
    launcher.ensure();
    io.out('MCP server: already set up.');
  } else if (kind === 'gournal') {
    io.out(`MCP server: gournal is registered as "${ctx.shown(reg.command, reg.args)}". That command depends on the PATH and the Node.js version of the shell that ran setup. Setup now registers the launcher: "${ctx.shown(now.command, now.args)}".`);
    if (!(await ctx.ask('Move the gournal MCP registration to the launcher?', true))) io.out('MCP server: kept the existing registration.');
    else if (launcher.ensure()) await replaceMcp(ctx, reg);
    else io.out(NO_LAUNCHER_MCP);
  } else {
    io.out(`MCP server: gournal is registered as "${ctx.shown(reg.command, reg.args)}". Setup would use "${ctx.shown(now.command, now.args)}".`);
    if (!io.isTTY) io.out('MCP server: kept the existing registration. Run setup in a terminal to replace it.');
    else if (!(await io.confirm('Replace the existing gournal MCP registration?', false))) io.out('MCP server: kept the existing registration.');
    else if (launcher.ensure()) await replaceMcp(ctx, reg);
    else io.out(NO_LAUNCHER_MCP);
  }
}

async function hookStep(ctx: Ctx, launcher: LauncherStep): Promise<void> {
  const { io, opts, settingsFile, backupFile } = ctx;
  const notEnabled = 'Stop hook: not enabled (add --hook to enable it).';
  const read = readSettings(settingsFile);
  if (read.kind === 'invalid') {
    if (opts.yes && !opts.hook) io.out(notEnabled);
    else {
      io.err(`Stop hook: ${settingsFile} is not a valid JSON object. Gournal did not change it.`);
      ctx.status = 1;
    }
    return;
  }
  const { next, changed, action } = addStopHook(read.settings, ctx.hook);
  // With --yes, a gournal hook that exists is always moved to the launcher. A new hook needs --hook.
  if (opts.yes && !opts.hook && action === 'added') return void io.out(notEnabled);
  if (!changed) {
    launcher.ensure();
    return void io.out('Stop hook: already set up.');
  }
  const plan = action === 'updated'
    ? `update the gournal hook in ${settingsFile} to ${ctx.planCommand}`
    : `add ${ctx.planCommand} to ${settingsFile}`;
  io.out(`Stop hook: ${plan}${read.exists ? ` (backup: ${backupFile})` : ''}.`);
  if (!(await ctx.ask(action === 'updated' ? 'Update the gournal Stop hook?' : 'Add the gournal Stop hook?', action === 'updated' || opts.hook))) {
    return void io.out('Stop hook: skipped.');
  }
  if (!launcher.ensure()) return void io.out(NO_LAUNCHER_HOOK);
  writeSettingsFile(ctx, read, next, true);
  io.out(`Stop hook: ${action}.`);
}

export async function installFlow(ctx: Ctx): Promise<void> {
  const packageRoot = ctx.io.packageRoot ?? PACKAGE_ROOT;
  if (copyHomeOf(packageRoot) !== null) {
    // The copy has no package manager. A setup from it would record the copy as the source.
    ctx.io.err(`Launcher: run setup from an installed gournal, not from the copy in ${path.dirname(packageRoot)}.`);
    ctx.status = 1;
    return;
  }
  const launcher = makeLauncherStep(ctx);
  await mcpStep(ctx, launcher);
  await installSkill(ctx);
  await hookStep(ctx, launcher);
  if (launcher.installed) await launcher.check();
}
