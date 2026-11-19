import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join('test', 'fixtures', 'style', 'probe.ts');

/** Run the probe in a child process. The env starts empty: jest workers set FORCE_COLOR and CI sets CI. */
function runProbe(extra: Record<string, string>): { text: string; stderr: string; status: number | null } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const res = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', PROBE], {
    cwd: ROOT,
    env: { ...env, ...extra },
    encoding: 'utf8'
  });
  if (res.error) throw res.error;
  return { text: JSON.parse(res.stdout.trim()) as string, stderr: res.stderr, status: res.status };
}

describe('terminal color decision', () => {
  test.each([
    ['no env and piped stdout gives plain text', {}, 'No tags found.'],
    ['FORCE_COLOR=1 gives yellow text', { FORCE_COLOR: '1' }, '\u001b[33mNo tags found.\u001b[39m'],
    ['FORCE_COLOR=0 gives plain text', { FORCE_COLOR: '0' }, 'No tags found.']
  ])('%s', (_name, extra, expected) => {
    const out = runProbe(extra);
    expect(out.status).toBe(0);
    expect(out.stderr).toBe('');
    expect(out.text).toBe(expected);
  });
});
