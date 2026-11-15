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
