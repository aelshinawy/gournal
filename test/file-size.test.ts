import { lineCount, tsFiles } from './helpers/source-files';

const MAX_LINES = 250;

/**
 * The allowlist is empty. A file over the limit needs a new row here with a phase name and a max.
 * The phase names the part of the slim-and-DRY plan that brings the file under the limit.
 * A row must go when its file is at or under the limit.
 * max is the line count on the day the row was added. A file on the list must not grow.
 */
const ALLOWED: Record<string, { max: number; phase: string }> = {};

const files = tsFiles('src');

test('the scan sees the source tree', () => expect(files.length).toBeGreaterThan(50));

test(`no source file is over ${MAX_LINES} lines`, () => {
  const over = files.filter((f) => !(f in ALLOWED) && lineCount(f) > MAX_LINES).map((f) => `${f}: ${lineCount(f)}`);
  expect(over).toEqual([]);
});

test('the allowlist is empty', () => expect(ALLOWED).toEqual({}));
