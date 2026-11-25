import { makeCtx, type Ctx, type SetupIo, type SetupOptions } from './claude-ctx';
import { installFlow } from './install';
import { uninstallFlow } from './uninstall';

export type { SetupIo, SetupOptions };

function printPlan(ctx: Ctx): void {
  const { io, opts, paths } = ctx;
  io.out(`gournal setup claude would ${opts.uninstall ? 'remove' : 'make'} these changes:`);
  if (opts.uninstall) {
    io.out(`  1. Remove the MCP registration: claude ${ctx.removeArgs.join(' ')}`);
    io.out(`  2. Remove ${ctx.skillFile} (only if gournal wrote it)`);
    io.out(`  3. Remove the gournal Stop hook from ${ctx.settingsFile}`);
    io.out(`  4. Remove the launcher ${paths.launcher} and ${paths.runtimeDir}`);
  } else {
    io.out(`  1. Install the launcher ${paths.launcher} and a copy of gournal in ${paths.runtimeDir}`);
    io.out(`  2. Register the MCP server: ${ctx.manualAdd}`);
    io.out(`  3. Write the skill file ${ctx.skillFile}`);
    io.out(`  4. Optional, with --hook: add a Stop hook to ${ctx.settingsFile}: ${ctx.hookCommand}`);
  }
  io.err('Not a terminal. Run it again with --yes to apply these changes.');
}

export async function setupClaude(io: SetupIo, opts: SetupOptions): Promise<number> {
  const ctx = makeCtx(io, opts);
  if (!opts.yes && !io.isTTY) {
    printPlan(ctx);
    return 1;
  }
  if (opts.uninstall) await uninstallFlow(ctx);
  else await installFlow(ctx);
  return ctx.status;
}
