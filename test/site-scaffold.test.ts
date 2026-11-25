import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { npmCli, npmCommand } from './helpers/npm';
import { CAPABILITIES } from '../site/scripts/reference/capabilities';
import { siteConfig } from './helpers/site-config';
import { makeTmp } from './helpers/tmp';

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
  'reference/configuration',
  'reference/environment',
  'resources/faq',
  'resources/troubleshooting'
];

// Windows has no runnable `npm`, only `npm.cmd`. Without the npm script the test cannot run there.
const canRunNpm = process.platform !== 'win32' || npmCli() !== null;

(canRunNpm ? test : test.skip)('package tarball stays dist only', () => {
  const npm = npmCommand(['pack', '--dry-run', '--json']);
  const out = execFileSync(npm.command, npm.args, { encoding: 'utf8', cwd: root });
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
  const slugs = [...CAPABILITIES.map((c) => `docs/reference/${c.slug}`), 'docs/reference/output-shapes', 'docs/reference'];
  for (const slug of slugs) {
    const rel = slug.replace(/^docs\//, '');
    const file = rel === 'reference' ? 'reference/index' : rel;
    expect(fs.existsSync(path.join(docsRoot, `${file}.md`))).toBe(true);
  }
});

test('README.md and site/src contain no link to reference/cli/ or reference/mcp/', () => {
  const files = [path.join(root, 'README.md')];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|mdx|astro|ts|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'site/src'));
  const bad = files.filter((f) => /reference\/(cli|mcp)\//.test(fs.readFileSync(f, 'utf8')));
  expect(bad).toEqual([]);
});

test('package.json homepage matches the site config', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  expect(pkg.homepage).toBe(siteConfig.canonical);
});

test('every docs link in README.md resolves to a page in site/src/content/docs', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  const origin = siteConfig.SITE_URL;
  const links = [...readme.matchAll(/https:\/\/[^)\s"'#]*/g)].map((m) => m[0]).filter((l) => l.startsWith(`${origin}/docs`)).map((l) => l.slice(origin.length));
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    const rel = link.replace(/^\//, '').replace(/\/$/, '');
    const exists = ['.md', '.mdx', '/index.md', '/index.mdx'].some((ext) =>
      fs.existsSync(path.join(root, 'site/src/content/docs', `${rel}${ext}`))
    );
    // The docs root has a redirect in the Astro config instead of a content page.
    const isDocsRoot = rel === 'docs' && /redirects:\s*\{\s*'\/docs'/.test(fs.readFileSync(path.join(root, 'site/astro.config.mjs'), 'utf8'));
    expect(exists || isDocsRoot).toBe(true);
  }
});

describe('check-dashes', () => {
  const script = path.join(root, 'scripts/check-dashes.mjs');
  const run = (dir: string) =>
    spawnSync(process.execPath, [script, dir], { encoding: 'utf8', cwd: root });

  test('check-dashes fails on an em dash and passes on a clean tree', () => {
    const dir = makeTmp('dashes-');
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
    const dir = makeTmp('dashes-');
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

test('astro config keeps smart punctuation off', () => {
  const config = fs.readFileSync(path.join(root, 'site/astro.config.mjs'), 'utf8');
  // Smartypants turns "--" into an en dash. A flag such as --format would render wrong in the docs.
  expect(config).toMatch(/smartPunctuation:\s*false/);
});
