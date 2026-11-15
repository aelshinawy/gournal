import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIn } from './helpers/run-cli';

test('find rejects an invalid --from even when the journal is empty', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
  try {
    const res = await runIn(home, ['find', 'x', '--from', 'garbage']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid date: garbage');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('find with blank text matches nothing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
  try {
    const add = await runIn(home, ['add', 'something']);
    expect(add.status).toBe(0);
    const anchor = await runIn(home, ['find', 'something']);
    expect(anchor.stdout).toContain('Found 1 entries:');
    const res = await runIn(home, ['find', '  ']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Found 0 entries:');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
