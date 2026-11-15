import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_DEFAULTS, normalizeConfig } from '../../src/core/config';
import { CONFIG_KEY_DOCS, ENV_VAR_DOCS } from '../../src/core/docs-meta';

const EM_DASH = String.fromCharCode(0x2014);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Descend only into objects that are nested objects in CONFIG_DEFAULTS.
// Other values (including empty string maps) are leaves.
function flatten(value: Record<string, unknown>, defaults: unknown, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    const path = prefix + k;
    const def = isPlainObject(defaults) ? defaults[k] : undefined;
    if (isPlainObject(v) && isPlainObject(def)) keys.push(...flatten(v, def, `${path}.`));
    else keys.push(path);
  }
  return keys;
}

// A sentence ends with ". " or with a final period.
function sentenceCount(text: string): number {
  return text.split(/\.(?: |$)/).filter((s) => s.trim() !== '').length;
}

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isPlainObject(o) ? o[k] : undefined), CONFIG_DEFAULTS);
}

test('every config key has a descriptor and no descriptor is extra', () => {
  const { config } = normalizeConfig('x', {}, () => {});
  const actual = flatten(config as unknown as Record<string, unknown>, CONFIG_DEFAULTS).sort();
  expect(CONFIG_KEY_DOCS.map((d) => d.key).sort()).toEqual(actual);
});

test('descriptor defaults match CONFIG_DEFAULTS', () => {
  for (const doc of CONFIG_KEY_DOCS) {
    const value = lookup(doc.key);
    if (value !== undefined) expect(doc.default).toBe(JSON.stringify(value));
    else expect(doc.default).not.toBe('');
  }
  expect(CONFIG_KEY_DOCS.some((d) => lookup(d.key) !== undefined)).toBe(true);
});

test('env descriptors cover the supported variables only', () => {
  const used = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(/process\.env\.(GOURNAL_\w+)|['"](GOURNAL_\w+)['"]/g)) used.add(m[1] ?? m[2]);
      }
    }
  };
  walk(path.join(__dirname, '..', '..', 'src'));
  for (const testOnly of ['GOURNAL_REAL_HOME', 'GOURNAL_TEST_HOME_ROOT', 'GOURNAL_DISABLE_FTS5']) used.delete(testOnly);
  expect(used.size).toBeGreaterThan(0);
  expect(ENV_VAR_DOCS.map((v) => v.name).sort()).toEqual([...used].sort());
});

test('descriptions are one or two sentences with no em dash', () => {
  const texts = [
    ...CONFIG_KEY_DOCS.flatMap((d) => [d.description, d.validation ?? '', d.default, d.type]),
    ...ENV_VAR_DOCS.flatMap((v) => [v.description, v.default]),
  ];
  for (const t of texts) expect(t).not.toContain(EM_DASH);
  for (const d of CONFIG_KEY_DOCS) {
    expect(sentenceCount(d.description)).toBeGreaterThanOrEqual(1);
    expect(sentenceCount(d.description)).toBeLessThanOrEqual(2);
  }
  for (const v of ENV_VAR_DOCS) {
    expect(sentenceCount(v.description)).toBeGreaterThanOrEqual(1);
    expect(sentenceCount(v.description)).toBeLessThanOrEqual(2);
  }
});
