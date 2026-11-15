import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('find rejects an invalid --from even when the journal is empty', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
  const res = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', 'find', 'x', '--from', 'garbage'],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' }
  );
  expect(res.status).toBe(1);
  expect(res.stderr).toContain('Invalid date: garbage');
});
