import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../../src/storage/db';
import { loadConfig, type Config } from '../../src/storage/config';
import { exportBundle, importBundle } from '../../src/storage/bundle';
import { makeTmp, rmTmp } from '../helpers/tmp';

const DIR = path.join(__dirname, '..', 'fixtures', 'bundles');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
let home: string; let db: DatabaseSync; let config: Config;
beforeEach(() => {
  home = makeTmp('gournal-bundle-fixtures-');
  config = loadConfig(home);
  db = openDb(path.join(home, 'a.db'));
});
afterEach(() => { db.close(); rmTmp(home); });

// Each fixture was written by the code before the zod switch. Import must keep accepting it.
const full = () => read('current-full.json');
test.each([
  ['current-full.json', () => full()],
  ['pre-activity.json', () => ({ ...full(), activity: [] })],
  ['extra-keys.json', () => full()],
])('imports %s and exports the same data', (name, expected) => {
  const fixture = read(name);
  const want = expected();
  expect(fixture.entries.length).toBeGreaterThanOrEqual(6);
  expect(importBundle(db, fixture)).toMatchObject({ inserted: fixture.entries.length, updated: 0, skipped: 0, deduplicated: 0 });
  const out = JSON.parse(JSON.stringify(exportBundle(db, config)));
  expect(out.entries).toEqual(want.entries);
  expect(out.activity).toEqual(want.activity);
  // The extra-keys fixture still carries a legacyMap key. Import ignores it, so export never has one.
  expect(out).not.toHaveProperty('legacyMap');
});

test('the extra-keys fixture really holds an extra key at every level, and an ignored legacyMap', () => {
  const b = read('extra-keys.json');
  expect(JSON.stringify(b)).toEqual(expect.stringContaining('extraTop'));
  expect(b.entries.some((e: Record<string, unknown>) => 'extraEntry' in e)).toBe(true);
  expect(b.entries.some((e: { refs: Record<string, unknown>[] }) => e.refs.some((r) => 'extraRef' in r))).toBe(true);
  expect(b.activity.some((a: Record<string, unknown>) => 'extraActivity' in a)).toBe(true);
  expect(b.activity.some((a: Record<string, unknown>) => !('capturedBy' in a))).toBe(true);
  expect(Array.isArray(b.legacyMap)).toBe(true);
});
