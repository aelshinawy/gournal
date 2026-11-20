import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join('test', 'fixtures', 'style', 'probe.ts');

/** Run the probe in a child process. The env starts empty: jest workers set FORCE_COLOR and CI sets CI. */
function runProbe(extra: Record<string, string>): { stdout: string; stderr: string; status: number | null } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const res = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', PROBE], {
    cwd: ROOT,
    env: { ...env, ...extra },
    encoding: 'utf8'
  });
  if (res.error) throw res.error;
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

const YELLOW = '\u001b[33mNo tags found.\u001b[39m';
const PLAIN = 'No tags found.';
const TTY = { PROBE_TTY: '1', TERM: 'xterm-256color' };

describe('terminal color decision', () => {
  test.each([
    ['no env and piped stdout gives plain text', {}, PLAIN],
    ['FORCE_COLOR=1 gives yellow text', { FORCE_COLOR: '1' }, YELLOW],
    ['FORCE_COLOR=0 gives plain text', { FORCE_COLOR: '0' }, PLAIN],
    ['a TTY with TERM=xterm-256color gives yellow text', TTY, YELLOW],
    ['a TTY with NO_COLOR=1 gives plain text', { ...TTY, NO_COLOR: '1' }, PLAIN],
    ['a TTY with TERM=dumb gives plain text', { PROBE_TTY: '1', TERM: 'dumb' }, PLAIN],
    ['a TTY with FORCE_COLOR=0 gives plain text', { ...TTY, FORCE_COLOR: '0' }, PLAIN],
    ['forceColor(true) on a pipe gives yellow text', { PROBE_FORCE: 'on' }, YELLOW],
    ['forceColor(false) on a TTY gives plain text', { ...TTY, PROBE_FORCE: 'off' }, PLAIN]
  ])('%s', (_name, extra, expected) => {
    const out = runProbe(extra);
    expect(out.status).toBe(0);
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout.trim())).toBe(expected);
  });
});
