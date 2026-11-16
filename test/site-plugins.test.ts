import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const plugins = path.resolve(__dirname, '../site/plugins');

// An import specifier must be a file URL. A bare Windows path such as D:\a\x reads as a URL scheme.
const moduleUrl = (name: string): string => pathToFileURL(path.join(plugins, name)).href;

// A fake page path as a file URL. A file URL needs a drive letter on Windows, so build it from a real absolute path.
const pageUrl = (rel: string): string => pathToFileURL(path.resolve('/site', rel)).href;

// The plugins are ES modules, so run them in a node child process.
function runModule(script: string): unknown {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('code block headings keep underscores', () => {
  const src = '---\ntitle: T\n---\n\n## `update_entry` tool\n\n```json\n{}\n```\n';
  const mod = moduleUrl('ec-focusable.mjs');
  const result = runModule(
    `import { headingsPerBlock } from ${JSON.stringify(mod)};` +
      `console.log(JSON.stringify(headingsPerBlock(${JSON.stringify(src)})));`
  );
  expect(result).toEqual(['update_entry tool']);
});

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

test('overview class comes from the page path, not the header', () => {
  const mod = moduleUrl('rehype-table-region.mjs');
  const result = runModule(
    `import { rehypeTableRegion } from ${JSON.stringify(mod)};` +
      `const classes = [];` +
      `const ctx = (t, url) => ({ textContent: () => t, data: {}, fileURL: url && new URL(url), wrapNode: (n, w) => classes.push(w.properties.className) });` +
      `const visit = (t, c) => rehypeTableRegion()().element.visit(t, c);` +
      `const overview = ${JSON.stringify(pageUrl('src/content/docs/docs/reference/index.md'))};` +
      `const other = ${JSON.stringify(pageUrl('src/content/docs/docs/reference/cli.md'))};` +
      `visit({ tagName: 'table' }, ctx('OptionMeaning', overview));` +
      `visit({ tagName: 'table' }, ctx('Task\\nCLI\\nMCP tool', other));` +
      `visit({ tagName: 'table' }, ctx('Task\\nCLI\\nMCP tool'));` +
      `console.log(JSON.stringify(classes));`
  );
  expect(result).toEqual([['g-table', 'g-table--overview'], ['g-table'], ['g-table']]);
});

test('overview match is anchored to docs/reference/index.md', () => {
  const mod = moduleUrl('rehype-table-region.mjs');
  const result = runModule(
    `import { rehypeTableRegion } from ${JSON.stringify(mod)};` +
      `const classOf = (url) => {` +
      `  const v = rehypeTableRegion()().element;` +
      `  let cls;` +
      `  v.visit({ tagName: 'table' }, { textContent: () => '', data: {}, fileURL: new URL(url), wrapNode: (n, w) => { cls = w.properties.className; } });` +
      `  return cls;` +
      `};` +
      `console.log(JSON.stringify([` +
      `  classOf(${JSON.stringify(pageUrl('src/content/docs/docs/guides/reference/index.md'))}),` +
      `  classOf('file:///C:/site/src/content/docs/docs/reference/index.md'),` +
      `  classOf(${JSON.stringify(pageUrl('src/content/docs/docs/reference/index.md'))})` +
      `]));`
  );
  const overview = ['g-table', 'g-table--overview'];
  // The C: URL is a drive path on Windows and a plain path on POSIX. The plugin matches both.
  expect(result).toEqual([['g-table'], overview, overview]);
});

test('the overview check runs once per document', () => {
  const mod = moduleUrl('rehype-table-region.mjs');
  const result = runModule(
    `import { rehypeTableRegion } from ${JSON.stringify(mod)};` +
      `const v = rehypeTableRegion()().element;` +
      `let reads = 0;` +
      `const ctx = { textContent: () => '', data: {}, get fileURL() { reads++; return new URL(${JSON.stringify(pageUrl('x/docs/reference/index.md'))}); }, wrapNode: () => {} };` +
      `v.visit({ tagName: 'table' }, ctx);` +
      `v.visit({ tagName: 'table' }, ctx);` +
      `v.visit({ tagName: 'table' }, ctx);` +
      `console.log(JSON.stringify(reads));`
  );
  expect(result).toBe(1);
});

// Run the focusable plugin hook over a Markdown source: one render pass per entry in `passes`.
function renderNames(source: string, blocks: number, passes: number): string[][] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecf-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, source);
  const mod = moduleUrl('ec-focusable.mjs');
  try {
    return runModule(
      `import { ecFocusable } from ${JSON.stringify(mod)};` +
        `const hook = ecFocusable().hooks.postprocessRenderedBlock;` +
        `const passes = [];` +
        `for (let p = 0; p < ${passes}; p++) {` +
        `  const names = [];` +
        `  for (let i = 0; i < ${blocks}; i++) {` +
        `    const pre = { type: 'element', tagName: 'pre', children: [] };` +
        `    hook({ codeBlock: { language: 'json', parentDocument: { sourceFilePath: ${JSON.stringify(file)}, positionInDocument: { groupIndex: i } } }, renderData: { blockAst: pre } });` +
        `    names.push(pre.properties.ariaLabel);` +
        `  }` +
        `  passes.push(names);` +
        `}` +
        `console.log(JSON.stringify(passes));`
    ) as string[][];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rendering the same document twice gives the same names', () => {
  const src = '---\ntitle: T\n---\n\n## Setup\n\n```json\n{}\n```\n\n```json\n{}\n```\n';
  const [first, second] = renderNames(src, 2, 2);
  expect(first).toEqual(['Setup, json code', 'Setup, json code 2']);
  expect(second).toEqual(first);
});

test('a title line outside frontmatter is ignored', () => {
  const mod = moduleUrl('ec-focusable.mjs');
  const src = '---\ntitle: Real\n---\n\n```json\n{}\n```\n\ntitle: Fake\n\n```json\n{}\n```\n';
  const noFront = 'Intro\n\ntitle: Fake\n\n```json\n{}\n```\n';
  const result = runModule(
    `import { headingsPerBlock } from ${JSON.stringify(mod)};` +
      `console.log(JSON.stringify([headingsPerBlock(${JSON.stringify(src)}), headingsPerBlock(${JSON.stringify(noFront)})]));`
  );
  expect(result).toEqual([['Real', 'Real'], ['']]);
});

test('frontmatter with CRLF line endings is read', () => {
  const mod = moduleUrl('ec-focusable.mjs');
  const src = '---\r\ntitle: Real\r\n---\r\n\r\n```json\r\n{}\r\n```\r\n';
  const result = runModule(
    `import { headingsPerBlock } from ${JSON.stringify(mod)};` +
      `console.log(JSON.stringify(headingsPerBlock(${JSON.stringify(src)})));`
  );
  expect(result).toEqual(['Real']);
});
