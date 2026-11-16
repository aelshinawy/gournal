import fs from 'fs';
import path from 'path';

/**
 * The npm CLI script, or null when none is found.
 * Windows cannot start the bare name `npm`, because the file is `npm.cmd`.
 * So tests run the Node binary with this script.
 */
export function npmCli(): string | null {
  const candidates: string[] = [];
  const fromEnv = process.env.npm_execpath;
  // npm sets npm_execpath when it runs a script. Other tools can set it to their own script.
  if (fromEnv && path.basename(fromEnv) === 'npm-cli.js') candidates.push(fromEnv);
  try {
    candidates.push(require.resolve('npm/bin/npm-cli.js'));
  } catch {
    // The npm package is not a dependency of this repo.
  }
  const nodeDir = path.dirname(process.execPath);
  candidates.push(
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  );
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

/** The command and arguments that run npm with the given arguments. */
export function npmCommand(args: string[]): { command: string; args: string[] } {
  const cli = npmCli();
  return cli ? { command: process.execPath, args: [cli, ...args] } : { command: 'npm', args };
}
