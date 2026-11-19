import fs from 'fs';
import path from 'path';
import { ROOT, tsFiles } from './helpers/source-files';

const indexes = tsFiles('src').filter((f) => path.posix.basename(f) === 'index.ts');

test('the scan sees every layer index', () => {
  for (const layer of ['core', 'storage', 'sources', 'render', 'adapters']) expect(indexes).toContain(`src/${layer}/index.ts`);
});

test.each(indexes)('%s lists its exports by name', (file) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  expect(text).not.toMatch(/export\s+(type\s+)?\*/);
});
