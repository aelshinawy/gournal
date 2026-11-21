import { setupClaude } from './claude';
import type { CommandRunner } from './runner';

/**
 * Remove the gournal setup after the package was removed. The Stop hook calls it.
 * It runs the uninstall flow with `ownedOnly`, so it touches only what gournal wrote.
 * It never throws and prints nothing. The journal stays.
 */
export async function selfCleanup(o: { copyHome: string; userHome: string; platform: NodeJS.Platform; exec: CommandRunner }): Promise<void> {
  try {
    await setupClaude(
      {
        out: () => {},
        err: () => {},
        home: o.userHome,
        gournalHome: o.copyHome,
        isTTY: false,
        confirm: async () => true,
        exec: o.exec,
        platform: o.platform,
      },
      { uninstall: true, yes: true, hook: false, ownedOnly: true },
    );
  } catch {
    // The next Stop hook tries again.
  }
}
