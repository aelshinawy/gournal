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

test('the rules catch each violation', () => {
  const r = depcruise('test/fixtures/layers/src');
  expect(r.status).not.toBe(0);
  for (const rule of ['core-allowlist', 'layer-order', 'storage-sources-apart', 'index-only', 'no-style-in-plain-renderers', 'cli-stays-in-cli']) {
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
  expect(out).toContain(`error cli-stays-in-cli: ${F}/adapters/mcp/bad.ts → ${F}/adapters/cli/spinner.ts`);
  expect(out).not.toContain(`→ ${F}/core/group.ts`);
});
