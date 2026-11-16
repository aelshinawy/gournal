import fs from 'fs';
import os from 'os';
import path from 'path';
import { CorruptJournalError, readLegacyEntries } from '../../src/storage/legacy-json';
import { rmTmp } from '../helpers/tmp';

describe('legacy entries.json reader', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-legacy-'));
    file = path.join(dir, 'entries.json');
  });
  afterEach(() => rmTmp(dir));

  test('missing file reads as empty', async () => {
    expect(await readLegacyEntries(file)).toEqual([]);
  });
  test('reads entries as parsed', async () => {
    const e = { timestamp: '2026-11-15T09:00:00.000Z', message: 'Test', project: 'test', tags: [] };
    fs.writeFileSync(file, JSON.stringify([e]));
    expect(await readLegacyEntries(file)).toEqual([e]);
  });
  test.each([['truncated JSON', '[{"timestamp":"x"'], ['an empty file', ''], ['a non-array', '{}']])(
    'treats %s as corrupt',
    async (_name, text) => {
      fs.writeFileSync(file, text);
      await expect(readLegacyEntries(file)).rejects.toBeInstanceOf(CorruptJournalError);
    }
  );
  test('corrupt error names the latest backup and never changes the file', async () => {
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.writeFileSync(path.join(dir, 'backups', 'entries-2026-11-14.json'), '[]');
    fs.writeFileSync(path.join(dir, 'backups', 'entries-2026-11-13.json'), '[]');
    fs.writeFileSync(file, 'garbage');
    const err = await readLegacyEntries(file).catch((e) => e);
    expect(err.latestBackup).toBe(path.join(dir, 'backups', 'entries-2026-11-14.json'));
    expect(err.message).toContain('did not change');
    expect(fs.readFileSync(file, 'utf8')).toBe('garbage');
  });
});
