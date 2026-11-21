import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const plugins = path.resolve(__dirname, '../site/plugins');

// An import specifier must be a file URL. A bare Windows path such as D:\a\x reads as a URL scheme.
const moduleUrl = (name: string): string => pathToFileURL(path.join(plugins, name)).href;

// The plugins are ES modules, so run them in a node child process.
function runModule(script: string): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('two tables under one heading get distinct region names', () => {
  const mod = moduleUrl('rehype-table-region.mjs');
  const result = runModule(
    `import { rehypeTableRegion } from ${JSON.stringify(mod)};` +
      `const v = rehypeTableRegion()().element;` +
      `const labels = [];` +
      `const ctx = (t) => ({ textContent: () => t, data: {}, wrapNode: (n, w) => labels.push(w.properties.ariaLabel) });` +
      `v.visit({ tagName: 'h2' }, ctx('Options'));` +
      `v.visit({ tagName: 'table' }, ctx(''));` +
      `v.visit({ tagName: 'table' }, ctx(''));` +
      `v.visit({ tagName: 'h2' }, ctx('Other'));` +
      `v.visit({ tagName: 'table' }, ctx(''));` +
      `console.log(JSON.stringify(labels));`
  );
  expect(result).toEqual(['Options table', 'Options table 2', 'Other table']);
});

test('every code block gets a focusable region with a unique name', () => {
  const mod = moduleUrl('ec-focusable.mjs');
  const result = runModule(
    `import { ecFocusable } from ${JSON.stringify(mod)};` +
      `const hook = ecFocusable().hooks.postprocessRenderedBlock;` +
      `const label = (language, groupIndex) => {` +
      `  const pre = { type: 'element', tagName: 'pre', children: [] };` +
      `  hook({ codeBlock: { language, parentDocument: { positionInDocument: { groupIndex } } }, renderData: { blockAst: { type: 'root', children: [{ type: 'element', tagName: 'div', children: [pre] }] } } });` +
      `  return [pre.properties.tabindex, pre.properties.role, pre.properties.ariaLabel];` +
      `};` +
      `console.log(JSON.stringify([label('json', 0), label('json', 1), label('plaintext', 2)]));`
  );
  expect(result).toEqual([
    ['0', 'region', 'json code 1'],
    ['0', 'region', 'json code 2'],
    ['0', 'region', 'text code 3']
  ]);
});

test('site config builds absolute URLs from the site URL', () => {
  const mod = pathToFileURL(path.resolve(__dirname, '../site/site.config.mjs')).href;
  const result = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import { siteUrl } from ${JSON.stringify(mod)}; console.log(JSON.stringify([siteUrl(), siteUrl('og.png'), siteUrl('/og.png')]));`],
    { encoding: 'utf8', env: { ...process.env, SITE_URL: 'https://example.com' } }
  );
  expect(JSON.parse(result)).toEqual(['https://example.com/', 'https://example.com/og.png', 'https://example.com/og.png']);
});
