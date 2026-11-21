import { makeCtx, planCommand, type Ctx, type SetupIo, type SetupOptions } from './claude-ctx';
import { installMcp, uninstallMcp } from './claude-mcp';
import { installSkill, uninstallSkill, installHook, uninstallHook } from './claude-steps';

export type { SetupIo, SetupOptions };

function printPlan(c: Ctx): void {
  const { io } = c;
  io.out(`gournal setup claude would ${c.opts.uninstall ? 'remove' : 'make'} these changes:`);
  if (c.opts.uninstall) {
    io.out(`  1. Remove the MCP registration: claude ${c.removeArgs.join(' ')}`);
    io.out(`  2. Remove ${c.skillFile} (only if gournal wrote it)`);
    io.out(`  3. Remove the gournal Stop hook from ${c.settingsFile}`);
  } else {
    io.out(`  1. Register the MCP server: ${c.manualAdd}`);
    io.out(`  2. Write the skill file ${c.skillFile}`);
    io.out(`  3. Optional, with --hook: add a Stop hook to ${c.settingsFile}: ${planCommand(c)}`);
  }
  io.err('Not a terminal. Run it again with --yes to apply these changes.');
}

export async function setupClaude(io: SetupIo, opts: SetupOptions): Promise<number> {
  const c = makeCtx(io, opts);
  if (!opts.yes && !io.isTTY) {
    printPlan(c);
    return 1;
  }
  const [mcp, skill, hook] = opts.uninstall
    ? ([uninstallMcp, uninstallSkill, uninstallHook] as const)
    : ([installMcp, installSkill, installHook] as const);
  const mcpStatus = await mcp(c);
  await skill(c);
  return mcpStatus | (await hook(c));
}
