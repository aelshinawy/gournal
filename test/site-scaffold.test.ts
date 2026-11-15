import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const root = path.resolve(__dirname, '..');
const docsRoot = path.join(root, 'site/src/content/docs/docs');

const SINGLE_PAGES = [
  'start-here/introduction',
  'start-here/install',
  'start-here/quickstart',
  'start-here/core-concepts',
  'guides/logging-with-ai-agents',
  'guides/standups-and-work-logs',
  'guides/github-activity',
  'guides/claude-code-setup',
  'guides/configuration',
  'guides/data-safety-and-backups',
  'guides/migrating-from-0x',
  'reference/configuration',
  'reference/environment',
  'resources/changelog',
  'resources/faq'
];

test('package tarball stays dist only', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8', cwd: root });
  const parsed = JSON.parse(out);
  // Some npm versions return an array, others an object keyed by package name.
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const files = (info as { files: { path: string }[] }).files.map((f) => f.path);
  expect(files.length).toBeGreaterThan(0);
  expect(
    files.every((p: string) => p.startsWith('dist/') || ['package.json', 'README.md', 'LICENSE'].includes(p))
  ).toBe(true);
});

test('every page in the spec sidebar has a file', () => {
  for (const slug of SINGLE_PAGES) {
    expect(fs.existsSync(path.join(docsRoot, `${slug}.md`))).toBe(true);
  }
  for (const dir of ['reference/cli', 'reference/mcp']) {
    const full = path.join(docsRoot, dir);
    expect(fs.existsSync(full)).toBe(true);
    expect(fs.readdirSync(full).some((f) => f.endsWith('.md'))).toBe(true);
  }
});

describe('check-dashes', () => {
  const script = path.join(root, 'scripts/check-dashes.mjs');
  const run = (dir: string) =>
    spawnSync(process.execPath, [script, dir], { encoding: 'utf8', cwd: root });

  test('check-dashes fails on an em dash and passes on a clean tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashes-'));
    try {
      fs.writeFileSync(path.join(dir, 'clean.md'), 'Clean text, with a comma.\n');
      expect(run(dir).status).toBe(0);
      fs.writeFileSync(path.join(dir, 'bad.md'), `Bad ${String.fromCharCode(0x2014)} text.\n`);
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toContain('bad.md');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('check-dashes skips node_modules and dist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashes-'));
    try {
      for (const skip of ['node_modules', 'dist']) {
        fs.mkdirSync(path.join(dir, skip));
        fs.writeFileSync(path.join(dir, skip, 'x.md'), String.fromCharCode(0x2014));
      }
      expect(run(dir).status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test('astro config keeps smartypants off', () => {
  const config = fs.readFileSync(path.join(root, 'site/astro.config.mjs'), 'utf8');
  // Smartypants turns "--" into an en dash. A flag such as --format would render wrong in the docs.
  expect(config).toMatch(/smartypants:\s*false/);
});
