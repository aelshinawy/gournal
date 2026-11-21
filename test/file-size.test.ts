import { lineCount, tsFiles } from './helpers/source-files';

const MAX_LINES = 250;

test(`no source file is over ${MAX_LINES} lines`, () => {
  const over = tsFiles('src').filter((f) => lineCount(f) > MAX_LINES).map((f) => `${f}: ${lineCount(f)} lines`);
  expect(over).toEqual([]);
});
