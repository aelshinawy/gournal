import fs from 'fs';
import path from 'path';
import { runIn } from './helpers/run-cli';
import { makeTmp, rmTmp } from './helpers/tmp';

const NOTICE = 'entries.json from 0.x is no longer read';

describe('legacy entries.json notice', () => {
  let home: string;

  beforeEach(() => {
    home = makeTmp('gournal-');
  });
  afterEach(() => {
    rmTmp(home);
  });

  test('prints one stderr line when entries.json exists and the journal is empty', async () => {
    fs.writeFileSync(path.join(home, 'entries.json'), '[]');
    const res = await runIn(home, ['standup']);
    expect(res.stderr).toContain(NOTICE);
    expect(res.stdout).not.toContain(NOTICE);
  });

  test('stays quiet when the journal has an entry', async () => {
    expect((await runIn(home, ['add', 'first'])).status).toBe(0);
    fs.writeFileSync(path.join(home, 'entries.json'), '[]');
    expect((await runIn(home, ['standup'])).stderr).not.toContain(NOTICE);
  });

  test('counts a removed entry as an entry', async () => {
    await runIn(home, ['add', 'first']);
    await runIn(home, ['undo']);
    fs.writeFileSync(path.join(home, 'entries.json'), '[]');
    expect((await runIn(home, ['standup'])).stderr).not.toContain(NOTICE);
  });

  test('stays quiet when entries.json is absent', async () => {
    expect((await runIn(home, ['standup'])).stderr).not.toContain(NOTICE);
  });
});
