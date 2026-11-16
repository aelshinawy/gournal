import { execFile, type ExecFileException } from 'child_process';
import { resolveBin } from '../bin';

export type GhErrorKind = 'missing' | 'auth' | 'rate-limit' | 'timeout' | 'network' | 'other';

export class GhError extends Error {
  readonly kind: GhErrorKind;
  constructor(kind: GhErrorKind, message: string) {
    super(message);
    this.name = 'GhError';
    this.kind = kind;
  }
}

/** Returns stdout. Throws GhError. */
export type GhRunner = (args: string[], opts: { timeoutMs: number }) => Promise<string>;

const MAX_BUFFER = 32 * 1024 * 1024;

function classify(err: ExecFileException, stderr: string): GhError {
  const text = stderr.toLowerCase();
  const first = stderr.split('\n').find((l) => l.trim() !== '')?.trim() ?? err.message;
  if (err.code === 'ENOENT') return new GhError('missing', 'gh is not installed');
  if (text.includes('gh auth login') || text.includes('not logged') || text.includes('http 401')) return new GhError('auth', first);
  if (text.includes('rate limit') || text.includes('http 429')) return new GhError('rate-limit', first);
  if (err.killed || err.signal || err.code === 'ETIMEDOUT') return new GhError('timeout', 'gh timed out');
  if (text.includes('error connecting') || text.includes('enotfound') || text.includes('could not resolve')) return new GhError('network', first);
  return new GhError('other', first);
}

/**
 * The runner for the gh program.
 * `prefixArgs` go before the gh arguments. Tests use them to run a Node script as gh.
 * Production code leaves them empty.
 */
export function execGh(bin?: string, prefixArgs: readonly string[] = []): GhRunner {
  // An explicit bin wins, then GOURNAL_GH, then `gh`. A bare name goes through the PATH scan,
  // so libuv never searches the current folder. A value with a path separator stays as it is.
  const configured = bin ?? process.env.GOURNAL_GH;
  return (args, opts) =>
    new Promise((resolve, reject) => {
      const file = resolveBin(configured ?? 'gh');
      execFile(file, [...prefixArgs, ...args], { timeout: opts.timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true, env: process.env, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (err) reject(classify(err, String(stderr ?? '')));
        else resolve(String(stdout));
      });
    });
}
