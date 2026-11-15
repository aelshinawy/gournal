import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readEntries,
  writeEntriesAtomic,
  backupIfNeeded,
  updateEntries,
  CorruptJournalError,
} from '../src/storage';
import type { Entry } from '../src/types';

const entry: Entry = { timestamp: '2026-11-15T09:00:00.000Z', message: 'Test', project: 'test', tags: [] };

describe('Storage Operations', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
    file = path.join(dir, 'entries.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('missing file reads as empty', async () => {
    expect(await readEntries(file)).toEqual([]);
  });
  test('round-trips entries through writeEntriesAtomic', async () => {
    await writeEntriesAtomic([entry], file);
    expect(await readEntries(file)).toEqual([entry]);
  });
  test('treats truncated JSON as corrupt', async () => {
    fs.writeFileSync(file, '[{"timestamp":"x"');
    await expect(readEntries(file)).rejects.toBeInstanceOf(CorruptJournalError);
  });
  test('treats an empty file as corrupt', async () => {
    fs.writeFileSync(file, '');
    await expect(readEntries(file)).rejects.toBeInstanceOf(CorruptJournalError);
  });
  test('treats a non-array as corrupt', async () => {
    fs.writeFileSync(file, '{}');
    await expect(readEntries(file)).rejects.toBeInstanceOf(CorruptJournalError);
  });
  test('corrupt error names the latest backup', async () => {
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.writeFileSync(path.join(dir, 'backups', 'entries-2026-11-14.json'), '[]');
    fs.writeFileSync(path.join(dir, 'backups', 'entries-2026-11-13.json'), '[]');
    fs.writeFileSync(file, 'garbage');
    const err = await readEntries(file).catch(e => e);
    expect(err.latestBackup).toBe(path.join(dir, 'backups', 'entries-2026-11-14.json'));
    expect(err.message).toContain('entries-2026-11-14.json');
    expect(err.message).toContain('did not change');
  });
  test('atomic write leaves no temp files', async () => {
    await writeEntriesAtomic([entry], file);
    expect(fs.readdirSync(dir)).toEqual(['entries.json']);
  });
  test('first write creates the file and no backup', async () => {
    expect(await backupIfNeeded(file, new Date(2026, 10, 15))).toBeNull();
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
  });
  test('backs up once per local day', async () => {
    await writeEntriesAtomic([entry], file);
    const day = new Date(2026, 10, 15, 9);
    expect(await backupIfNeeded(file, day)).toBe(path.join(dir, 'backups', 'entries-2026-11-15.json'));
    expect(await backupIfNeeded(file, new Date(2026, 10, 15, 23))).toBeNull();
  });
  test('keeps the newest 7 backups', async () => {
    await writeEntriesAtomic([entry], file);
    for (let d = 1; d <= 9; d++) await backupIfNeeded(file, new Date(2026, 10, d));
    const names = fs.readdirSync(path.join(dir, 'backups')).sort();
    expect(names).toHaveLength(7);
    expect(names[0]).toBe('entries-2026-11-03.json');
  });
  test('updateEntries does not back up or change a corrupt file', async () => {
    fs.writeFileSync(file, 'garbage');
    await expect(updateEntries(e => e, file)).rejects.toBeInstanceOf(CorruptJournalError);
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('garbage');
  });
});
