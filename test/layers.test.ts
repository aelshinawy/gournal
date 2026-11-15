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
  for (const rule of ['core-no-io', 'layer-order', 'storage-sources-apart', 'index-only', 'no-chalk-in-plain-renderers']) {
    expect(r.stdout + r.stderr).toContain(rule);
  }
});

test('src has only the layer folders and the bin shim', () =>
  expect(fs.readdirSync(path.join(root, 'src')).sort()).toEqual(['adapters', 'cli.ts', 'core', 'render', 'sources', 'storage']));

test.each(['core', 'storage', 'sources', 'render', 'adapters'])('layer %s has an index.ts', (layer) =>
  expect(fs.existsSync(path.join(root, 'src', layer, 'index.ts'))).toBe(true));
