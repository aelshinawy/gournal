import { readEntries, writeEntries } from '../src/storage';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';

const TEST_PATH = path.join(process.env.HOME || process.env.USERPROFILE!, '.gournal', 'test-entries.json');

describe('Storage Operations', () => {
  afterEach(() => {
    if (existsSync(TEST_PATH)) unlinkSync(TEST_PATH);
  });

  test('Reads and writes entries', async () => {
    const testEntries = [{ timestamp: new Date().toISOString(), message: 'Test', project: 'test', tags: [] }];
    await writeEntries(testEntries, TEST_PATH);
    const entries = await readEntries(TEST_PATH);
    expect(entries).toEqual(testEntries);
  });
});