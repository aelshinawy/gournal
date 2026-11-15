import chalk from 'chalk';
import type { GhRunner } from '../../src/sources';
import { runCli } from '../../src/adapters/cli/program';

/** Run the CLI in this process. Collects out, err, and process.stderr writes. Calls must not overlap: the chalk level and the stderr spy are shared. */
export async function runIn(
  home: string,
  args: string[],
  opts: { cwd?: string; isTTY?: boolean; gh?: GhRunner } = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  const level = chalk.level;
  const out: string[] = [];
  const err: string[] = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    err.push(String(chunk).replace(/\n$/, ''));
    return true;
  }) as typeof process.stderr.write);
  try {
    chalk.level = 0;
    const status = await runCli(['node', 'gournal', ...args], {
      home,
      cwd: opts.cwd ?? process.cwd(),
      isTTY: opts.isTTY ?? false,
      gh: opts.gh,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    });
    return { status, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    spy.mockRestore();
    chalk.level = level;
  }
}
