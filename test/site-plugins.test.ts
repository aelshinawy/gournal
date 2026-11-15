import path from 'path';
import { execFileSync } from 'child_process';

const plugins = path.resolve(__dirname, '../site/plugins');

// The plugins are ES modules, so run them in a node child process.
function runModule(script: string): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('code block headings keep underscores', () => {
  const src = '---\ntitle: T\n---\n\n## `update_entry` tool\n\n```json\n{}\n```\n';
  const mod = path.join(plugins, 'ec-focusable.mjs');
  const result = runModule(
    `import { headingsPerBlock } from ${JSON.stringify(mod)};` +
      `console.log(JSON.stringify(headingsPerBlock(${JSON.stringify(src)})));`
  );
  expect(result).toEqual(['update_entry tool']);
});

test('two tables under one heading get distinct region names', () => {
  const mod = path.join(plugins, 'rehype-table-region.mjs');
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

test('overview class comes from the page path, not the header', () => {
  const mod = path.join(plugins, 'rehype-table-region.mjs');
  const result = runModule(
    `import { rehypeTableRegion } from ${JSON.stringify(mod)};` +
      `const v = rehypeTableRegion()().element;` +
      `const classes = [];` +
      `const ctx = (t, url) => ({ textContent: () => t, data: {}, fileURL: url && new URL(url), wrapNode: (n, w) => classes.push(w.properties.className) });` +
      `const overview = 'file:///site/src/content/docs/docs/reference/index.md';` +
      `const other = 'file:///site/src/content/docs/docs/reference/cli.md';` +
      `v.visit({ tagName: 'table' }, ctx('OptionMeaning', overview));` +
      `v.visit({ tagName: 'table' }, ctx('Task\\nCLI\\nMCP tool', other));` +
      `v.visit({ tagName: 'table' }, ctx('Task\\nCLI\\nMCP tool'));` +
      `console.log(JSON.stringify(classes));`
  );
  expect(result).toEqual([['g-table', 'g-table--overview'], ['g-table'], ['g-table']]);
});
