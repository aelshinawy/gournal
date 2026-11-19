import fs from 'fs';
import path from 'path';
import { ROOT, tsFiles } from './helpers/source-files';

/**
 * Facts that one file owns. A fact is a pattern. Only the owner file may contain it.
 * Each phase of the slim-and-DRY plan adds the rows for the facts that it merges.
 */
const FACTS: { fact: string; pattern: RegExp; owner: string }[] = [
  { fact: 'temp folder creation in tests', pattern: /\bmkdtemp(Sync)?\(/, owner: 'test/helpers/tmp.ts' },
];

const self = path.relative(ROOT, __filename).split(path.sep).join('/');
const files = [...tsFiles('src'), ...tsFiles('test', ['test/fixtures'])].filter((f) => f !== self);

test('the scan sees src and test', () => expect(files.length).toBeGreaterThan(100));

test.each(FACTS)('only $owner holds $fact', ({ pattern, owner }) => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  expect(pattern.test(read(owner))).toBe(true);
  expect(files.filter((f) => f !== owner && pattern.test(read(f)))).toEqual([]);
});
