import { readRegistration, SERVER } from './claude-files';
import { ask, shown, type Ctx } from './claude-ctx';

type Cli = 'ok' | 'missing' | 'failed';

const status = (res: Cli): number => (res === 'ok' ? 0 : 1);

/** Run the claude CLI and say the given lines for the result. A failure prints the CLI message first. */
async function claudeCli(c: Ctx, args: string[], say: { ok?: string; missing: string[]; failed?: string }): Promise<Cli> {
  const r = await c.io.exec('claude', args);
  if (r.code === 0) {
    if (say.ok) c.io.out(say.ok);
    return 'ok';
  }
  if (r.code === 127) {
    say.missing.forEach((l) => c.io.out(l));
    return 'missing';
  }
  c.io.err(`claude ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim()}`);
  if (say.failed) c.io.out(say.failed);
  return 'failed';
}

const register = (c: Ctx): Promise<Cli> => claudeCli(c, c.addArgs, {
  ok: 'MCP server: registered.',
  missing: ['MCP server: the claude CLI was not found on PATH. Run this command yourself:', `  ${c.manualAdd}`],
  // On Windows the failure can be an argument that cmd.exe cannot quote. Print the line to run by hand.
  failed: c.platform === 'win32' ? `MCP server: could not register. Run this command yourself:\n  ${c.manualAdd}` : undefined,
});

async function replace(c: Ctx, old: { command: string; args: string[] }): Promise<number> {
  const removed = await claudeCli(c, c.removeArgs, {
    missing: [
      'MCP server: the claude CLI was not found on PATH. Run these yourself:',
      `  claude ${c.removeArgs.join(' ')}`,
      `  ${c.manualAdd}`,
    ],
  });
  if (removed !== 'ok') return 1;
  const res = await register(c);
  if (res === 'failed') {
    c.io.out('MCP server: the old registration was removed. To restore it, run:');
    c.io.out(`  claude mcp add --scope user ${SERVER} -- ${shown(c.platform, old.command, old.args)}`);
  }
  return status(res);
}

export async function installMcp(c: Ctx): Promise<number> {
  const { io } = c;
  const reg = readRegistration(c.claudeJson);
  if (reg === null) {
    io.out(`MCP server: register gournal for all projects (${c.manualAdd}).`);
    if (await ask(c, 'Register the gournal MCP server with Claude Code?', true)) return status(await register(c));
    io.out('MCP server: skipped.');
    return 0;
  }
  if (reg.command === c.cmd.command && JSON.stringify(reg.args) === JSON.stringify(c.serverArgs)) {
    io.out('MCP server: already set up.');
    return 0;
  }
  io.out(`MCP server: gournal is registered as "${shown(c.platform, reg.command, reg.args)}". Setup would use "${shown(c.platform, c.cmd.command, c.serverArgs)}".`);
  if (!io.isTTY) {
    io.out('MCP server: kept the existing registration. Run setup in a terminal to replace it.');
    return 0;
  }
  if (await io.confirm('Replace the existing gournal MCP registration?', false)) return replace(c, reg);
  io.out('MCP server: kept the existing registration.');
  return 0;
}

export async function uninstallMcp(c: Ctx): Promise<number> {
  const { io } = c;
  if (readRegistration(c.claudeJson) === null) {
    io.out('MCP server: not set up.');
    return 0;
  }
  io.out(`MCP server: remove the gournal registration (claude ${c.removeArgs.join(' ')}).`);
  if (!(await ask(c, 'Remove the gournal MCP registration?', true))) {
    io.out('MCP server: kept.');
    return 0;
  }
  return status(await claudeCli(c, c.removeArgs, {
    ok: 'MCP server: removed.',
    missing: [`MCP server: the claude CLI was not found on PATH. Run this command yourself:\n  claude ${c.removeArgs.join(' ')}`],
  }));
}
