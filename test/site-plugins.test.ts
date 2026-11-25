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

test('code block names carry the nearest heading and stay unique', () => {
  const mod = moduleUrl('ec-focusable.mjs');
  const result = runModule(
    `import { codeLabelMeta } from ${JSON.stringify(mod)};` +
      `const v = codeLabelMeta()().element;` +
      `const metas = [];` +
      `const ctx = (t, title) => ({ textContent: () => t, data: { astro: { frontmatter: { title } } }, setField: (n, k, d) => metas.push(d.meta) });` +
      `const pre = (lang, meta) => ({ tagName: 'pre', children: [{ type: 'element', tagName: 'code', data: { lang, meta } }] });` +
      `v.visit(pre('json'), ctx('', 'Page title'));` +
      `v.visit({ tagName: 'h2' }, ctx('Options'));` +
      `v.visit(pre('bash', 'title="x"'), ctx('', 'Page title'));` +
      `v.visit(pre('bash'), ctx('', 'Page title'));` +
      `v.visit(pre('plaintext'), ctx('', 'Page title'));` +
      `v.visit({ tagName: 'h2' }, ctx('Say "hi"'));` +
      `v.visit(pre('bash'), ctx('', 'Page title'));` +
      `console.log(JSON.stringify(metas));`
  );
  const names = (result as string[]).map((m) => decodeURIComponent(m.match(/glabel="([^"]+)"/)![1]));
  expect(names).toEqual(['Page title, json code', 'Options, bash code', 'Options, bash code 2', 'Options, text code', 'Say "hi", bash code']);
  expect((result as string[])[1]).toMatch(/^title="x" glabel=/);
});

test('the Expressive Code hook turns the block name into a focusable region', () => {
  const mod = moduleUrl('ec-focusable.mjs');
  const result = runModule(
    `import { ecFocusable } from ${JSON.stringify(mod)};` +
      `const hook = ecFocusable().hooks.postprocessRenderedBlock;` +
      `const label = (language, name) => {` +
      `  const pre = { type: 'element', tagName: 'pre', children: [] };` +
      `  const metaOptions = { getString: () => name && encodeURIComponent(name) };` +
      `  hook({ codeBlock: { language, metaOptions }, renderData: { blockAst: { type: 'root', children: [{ type: 'element', tagName: 'div', children: [pre] }] } } });` +
      `  return [pre.properties.tabindex, pre.properties.role, pre.properties.ariaLabel];` +
      `};` +
      `console.log(JSON.stringify([label('json', 'Options, json code'), label('plaintext', undefined)]));`
  );
  expect(result).toEqual([
    ['0', 'region', 'Options, json code'],
    ['0', 'region', 'text code']
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
