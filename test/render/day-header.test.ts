import { spawnSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const PROBE = path.join('test', 'fixtures', 'render', 'day-header.ts');
const ZONE = 'America/New_York';

type Probe = { zone: string; md: string; term: string };

/** Run the probe in a child process with TZ set. Node reads TZ at start, so a zone needs a new process. */
function runProbe(zone: string): Probe {
  const res = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', PROBE], {
    cwd: ROOT,
    env: { ...process.env, TZ: zone },
    encoding: 'utf8'
  });
  if (res.status !== 0) throw new Error(`probe failed (${res.status}): ${res.error ?? res.stderr}`);
  return JSON.parse(res.stdout.trim()) as Probe;
}

// Node reads TZ at process start. If a child does not honor it, the zone case cannot run.
const out = runProbe(ZONE);
const honored = out.zone === ZONE;
const zoneDescribe = honored ? describe : describe.skip;
const skippedName = 'day header (skipped: Node on this Windows runner ignores TZ in a child process)';

if (!honored && process.platform !== 'win32') {
  test('TZ is honored in a child process', () => {
    throw new Error(`TZ is not honored in a child process on ${process.platform}`);
  });
}

// Selects the suite name. Only a Windows runner that ignores TZ gets the skip name. On other platforms the guard test above fails instead.
zoneDescribe(honored || process.platform !== 'win32' ? 'day header' : skippedName, () => {
  test('the markdown day header reads the day as a local day', () => {
    expect(out.md).toBe('### Sun Mar 29');
  });

  test('the terminal day header reads the day as a local day', () => {
    expect(out.term).toContain('  Sun Mar 29\n');
  });
});
