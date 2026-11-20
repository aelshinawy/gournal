import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '..');
const bin = path.join(root, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs');

const depcruise = (target: string) =>
  spawnSync(
    process.execPath,
    [bin, target, '--config', '.dependency-cruiser.cjs', '--output-type', 'err'],
    { encoding: 'utf8', cwd: root }
  );

test('src follows the layer rules', () => {
  const r = depcruise('src');
  expect(r.stdout + r.stderr).not.toMatch(/error/i);
  expect(r.status).toBe(0);
});

test('the rules catch each violation', () => {
  const r = depcruise('test/fixtures/layers/src');
  expect(r.status).not.toBe(0);
  for (const rule of ['core-allowlist', 'layer-order', 'storage-sources-apart', 'index-only', 'no-style-in-plain-renderers']) {
    expect(r.stdout + r.stderr).toContain(rule);
  }
});

test('each fixture line hits the expected rule', () => {
  const out = depcruise('test/fixtures/layers/src').stdout;
  const F = 'test/fixtures/layers/src';
  expect(out).toContain(`error core-allowlist: ${F}/core/bad.ts → fs`);
  expect(out).toMatch(new RegExp(`error core-allowlist: ${F}/core/cli\\.ts → node_modules/commander/`));
  expect(out).toContain(`error index-only: ${F}/core/entries/entry.ts → ${F}/storage/db.ts`);
  expect(out).toContain(`error index-only: ${F}/render/deep.ts → ${F}/core/entries/index.ts`);
  expect(out).toContain(`error no-style-in-plain-renderers: ${F}/render/markdown.ts → util`);
  expect(out).toContain(`error no-style-in-plain-renderers: ${F}/render/markdown.ts → ${F}/render/style.ts`);
  expect(out).toContain(`error no-style-in-plain-renderers: ${F}/render/json.ts → util`);
  expect(out).not.toContain(`→ ${F}/core/group.ts`);
});

test('src has only the layer folders and the bin shim', () =>
  expect(fs.readdirSync(path.join(root, 'src')).sort()).toEqual(['adapters', 'cli.ts', 'core', 'render', 'sources', 'storage']));

test.each(['core', 'storage', 'sources', 'render', 'adapters'])('layer %s has an index.ts', (layer) =>
  expect(fs.existsSync(path.join(root, 'src', layer, 'index.ts'))).toBe(true));
