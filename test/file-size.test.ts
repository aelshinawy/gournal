import fs from 'fs';
import path from 'path';
import { ROOT, lineCount, tsFiles } from './helpers/source-files';

const MAX_LINES = 250;

/**
 * Files that are over the limit today. Each row names the phase of the slim-and-DRY plan that
 * brings the file under the limit. A row must go when its file is at or under the limit.
 * max is the line count on the day the row was added. A file on the list must not grow.
 */
const ALLOWED: Record<string, { max: number; phase: string }> = {
  'src/adapters/cli/program.ts': { max: 496, phase: 'Phase 6 (adapters)' },
  'src/adapters/mcp/server.ts': { max: 393, phase: 'Phase 6 (adapters)' },
  'src/adapters/setup/claude.ts': { max: 359, phase: 'Phase 6 (adapters)' },
  'src/storage/migrate.ts': { max: 326, phase: 'Phase 5 (storage)' },
  'src/storage/bundle.ts': { max: 297, phase: 'Phase 5 (storage)' },
  'src/storage/schema.ts': { max: 284, phase: 'Phase 5 (storage)' },
  'src/storage/activity-repository.ts': { max: 274, phase: 'Phase 5 (storage)' },
  'src/storage/sqlite-repository.ts': { max: 258, phase: 'Phase 5 (storage)' },
};

const files = tsFiles('src');

test('the scan sees the source tree', () => expect(files.length).toBeGreaterThan(50));

test(`no source file is over ${MAX_LINES} lines`, () => {
  const over = files.filter((f) => !(f in ALLOWED) && lineCount(f) > MAX_LINES).map((f) => `${f}: ${lineCount(f)}`);
  expect(over).toEqual([]);
});

test.each(Object.entries(ALLOWED))('%s does not grow, and leaves the list when it is small enough', (file, { max }) => {
  expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
  const lines = lineCount(file);
  expect(lines).toBeLessThanOrEqual(max);
  expect(lines).toBeGreaterThan(MAX_LINES);
});
