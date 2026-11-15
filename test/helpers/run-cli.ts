import chalk from 'chalk';
import { runCli } from '../../src/adapters/cli/program';

/** Run the CLI in this process. Collects out, err, and process.stderr writes. */
export async function runIn(
  home: string,
  args: string[],
  opts: { cwd?: string; isTTY?: boolean } = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  const level = chalk.level;
  chalk.level = 0;
  const out: string[] = [];
  const err: string[] = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    err.push(String(chunk).replace(/\n$/, ''));
    return true;
  }) as typeof process.stderr.write);
  try {
    const status = await runCli(['node', 'gournal', ...args], {
      home,
      cwd: opts.cwd ?? process.cwd(),
      isTTY: opts.isTTY ?? false,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
    });
    return { status, stdout: out.join('\n'), stderr: err.join('\n') };
  } finally {
    spy.mockRestore();
    chalk.level = level;
  }
}
