import { PACKAGE_ROOT } from './package-copy';
import { detectHomebrew } from './homebrew';
import { installRuntime } from './runtime';
import { checkLauncherPath } from './launcher';
import { createLauncherCheck } from './launcher-check';
import { VERSION } from '../version';
import type { Ctx } from './claude-ctx';

export interface LauncherStep {
  ensure(): boolean;
  readonly installed: boolean;
  check(): Promise<void>;
}

const LABELS = { installed: 'installed in', updated: 'updated in', unchanged: '' } as const;

export function makeLauncherStep(ctx: Ctx): LauncherStep {
  const { io, paths, platform } = ctx;
  let state: 'new' | 'ok' | 'failed' = 'new';
  const fail = (message: string): boolean => {
    io.err(message);
    ctx.status = 1;
    state = 'failed';
    return false;
  };
  return {
    ensure(): boolean {
      if (state !== 'new') return state === 'ok';
      const bad = checkLauncherPath(paths.launcher, platform);
      if (bad !== null) return fail(bad);
      try {
        const packageRoot = io.packageRoot ?? PACKAGE_ROOT;
        // The Node.js of a Homebrew run is a Cellar path. A brew upgrade removes it. Record the opt path.
        const brew = detectHomebrew(packageRoot, platform);
        const { action } = installRuntime({
          gournalHome: io.gournalHome,
          packageRoot,
          nodePath: brew?.node ?? ctx.env.execPath,
          platform,
          bakeHome: ctx.bakeHome,
        });
        io.out(action === 'unchanged' ? 'Launcher: already set up.' : `Launcher: ${LABELS[action]} ${paths.runtimeDir}.`);
        if (brew) io.out(`Homebrew: the launcher runs gournal from ${brew.prefix}/opt/gournal with ${brew.node}.`);
        state = 'ok';
        return true;
      } catch (error) {
        return fail(`Launcher: could not install in ${paths.runtimeDir}: ${(error as Error).message}`);
      }
    },
    get installed(): boolean {
      return state === 'ok';
    },
    async check(): Promise<void> {
      const run = io.check ?? createLauncherCheck(platform, io.home);
      const r = await run(ctx.prefix.command, [...ctx.prefix.args, '--version']);
      if (r.code === 0 && r.stdout.trim() === VERSION) {
        io.out('Check: Claude Code can start gournal without your shell PATH.');
        return;
      }
      const why = (r.stderr.trim() || r.stdout.trim()).split('\n')[0] ?? '';
      io.err(`Check: the launcher did not start gournal (exit ${r.code}). ${why}`);
      ctx.status = 1;
    },
  };
}
