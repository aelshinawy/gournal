import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const siteSrc = path.join(root, 'site/src');
const builtHome = path.join(root, 'site/dist/index.html');
const PLACEHOLDER = "A Developer's Command-Line Journal with Git Integration";

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : [full];
  });
}

test('the pitch line appears once and is the placeholder value', () => {
  const pitch = fs.readFileSync(path.join(siteSrc, 'pitch.ts'), 'utf8');
  expect(pitch).toContain(`export const PITCH_LINE = ${JSON.stringify(PLACEHOLDER)};`);

  // No other source file defines the pitch line or repeats its text.
  const others = walk(siteSrc).filter((f) => /\.(astro|ts|tsx|js|mjs|md|mdx|css)$/.test(f) && !f.endsWith('pitch.ts'));
  for (const f of others) {
    const text = fs.readFileSync(f, 'utf8');
    expect(text).not.toContain(PLACEHOLDER);
    expect(text).not.toMatch(/PITCH_LINE\s*=/);
  }

  // The homepage imports the constant and renders it as the hero headline.
  const home = fs.readFileSync(path.join(siteSrc, 'pages/index.astro'), 'utf8');
  expect(home).toMatch(/import \{ PITCH_LINE \} from '\.\.\/pitch'/);
  expect(walk(path.join(siteSrc, 'components/home')).some((f) => /<h1[^>]*>\s*\{PITCH_LINE\}\s*<\/h1>/.test(fs.readFileSync(f, 'utf8')))
    || /<h1[^>]*>\s*\{PITCH_LINE\}\s*<\/h1>/.test(home)).toBe(true);
});

const describeBuilt = fs.existsSync(builtHome) ? describe : describe.skip;
if (!fs.existsSync(builtHome)) {
  // eslint-disable-next-line no-console
  console.log('site-home: skipping the built page checks because site/dist/index.html does not exist. Run npm --prefix site run build first.');
}

describeBuilt('built homepage', () => {
  const html = fs.existsSync(builtHome) ? fs.readFileSync(builtHome, 'utf8') : '';

  test('homepage links and assets carry the base path', () => {
    const urls = [...html.matchAll(/\s(?:href|src|poster|srcset)="([^"]*)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    const rooted = urls.filter((u) => u.startsWith('/') && !u.startsWith('//'));
    expect(rooted.length).toBeGreaterThan(0);
    for (const u of rooted) expect(u.startsWith('/gournal/')).toBe(true);
  });

  test('the built page shows the pitch line once, as the h1', () => {
    const text = PLACEHOLDER.replace("'", '(?:\'|&#39;|&apos;)');
    expect(html.match(new RegExp(text, 'g'))?.length).toBe(1);
    expect(html).toMatch(new RegExp(`<h1[^>]*>\\s*${text}\\s*</h1>`));
  });

  test('the demo video has a poster, WebM then MP4, and a transcript', () => {
    const video = /<video[^>]*>[\s\S]*?<\/video>/.exec(html)?.[0] ?? '';
    for (const attr of ['muted', 'loop', 'playsinline']) expect(video).toMatch(new RegExp(`\\s${attr}[\\s>=]`));
    // No autoplay in markup: the script starts the loop together with its pause control (WCAG 2.2.2).
    expect(video).not.toMatch(/\sautoplay[\s>=]/);
    expect(video).toContain('poster="/gournal/demo/standup-poster.png"');
    expect(video.indexOf('standup.webm')).toBeGreaterThan(-1);
    expect(video.indexOf('standup.webm')).toBeLessThan(video.indexOf('standup.mp4'));
    expect(html).toContain('Standup: Today');
  });
  test('the demo comes after the hero actions in document order', () => {
    const hero = /<section class="g-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const order = ['<h1', 'g-hero__lede', 'g-install"', 'g-hero__req', 'g-actions', 'g-demo"'].map((m) => hero.indexOf(m));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('the hero has no ledger margin column', () => {
    const hero = /<section class="g-hero"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(hero).toContain('g-hero__intro');
    expect(hero).not.toContain('g-ledger');
    expect(hero).not.toContain('g-hero__margin');
    expect(hero).not.toContain('g-hero__specimen');
  });
  test('the head has the title, canonical link, social tags, and sitemap link', () => {
    expect(html).toContain('<title>gournal: a command-line work journal</title>');
    expect(html).toContain('<link rel="canonical" href="https://aelshinawy.github.io/gournal/"');
    for (const prop of ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name']) {
      expect(html).toMatch(new RegExp(`<meta property="${prop}" content="[^"]+"`));
    }
    expect(html).toMatch(/<meta name="twitter:card" content="[^"]+"/);
    expect(html).toMatch(/<link rel="sitemap" href="\/gournal\/sitemap-index\.xml"/);
    const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(desc.length).toBeGreaterThan(0);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(html).toContain(`<meta property="og:description" content="${desc}"`);
    expect(desc).toBe('Gournal is a local-first command-line work journal. It keeps all data in SQLite on your machine, needs no account, and stores no tokens.');
  });

  test('the demo video has an accessible label', () => {
    const video = /<video[^>]*>/.exec(html)?.[0] ?? '';
    expect(video).toMatch(/\saria-label="[^"]+"/);
  });

  test('the page preloads a latin Newsreader font that the built CSS references', () => {
    const tag = /<link[^>]*rel="preload"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toMatch(/as="font"/);
    expect(tag).toMatch(/type="font\/woff2"/);
    expect(tag).toMatch(/\scrossorigin/);
    const href = /href="([^"]+)"/.exec(tag)?.[1] ?? '';
    expect(href).toMatch(/^\/gournal\/_astro\/newsreader-latin-wght-normal\..+\.woff2$/);
    const astroDir = path.join(root, 'site/dist/_astro');
    const css = fs.readdirSync(astroDir).filter((f) => f.endsWith('.css')).map((f) => fs.readFileSync(path.join(astroDir, f), 'utf8')).join('\n');
    expect(css).toContain(href);
  });
});

describeBuilt('share image and social cards', () => {
  const OG_URL = 'https://aelshinawy.github.io/gournal/og.png';
  const OG_ALT = 'A gournal standup in the terminal: done work by project, blockers, next items, and linked GitHub activity.';
  const docsPage = path.join(root, 'site/dist/docs/start-here/introduction/index.html');
  const pages: Record<string, string> = {
    homepage: fs.readFileSync(builtHome, 'utf8'),
    'docs page': fs.existsSync(docsPage) ? fs.readFileSync(docsPage, 'utf8') : ''
  };

  for (const [name, html] of Object.entries(pages)) {
    test(`the ${name} has one absolute og:image and a large twitter card`, () => {
      expect(html).not.toBe('');
      const og = [...html.matchAll(/<meta\s+property="og:image"\s+content="([^"]*)"/g)].map((m) => m[1]);
      expect(og).toEqual([OG_URL]);
      expect(html).toMatch(/<meta\s+name="twitter:card"\s+content="summary_large_image"/);
      expect([...html.matchAll(/name="twitter:card"/g)].length).toBe(1);
      const tw = [...html.matchAll(/<meta\s+name="twitter:image"\s+content="([^"]*)"/g)].map((m) => m[1]);
      expect(tw).toEqual([OG_URL]);
      const one = (prop: string): string[] => [...html.matchAll(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'g'))].map((m) => m[1]);
      expect(one('og:image:width')).toEqual(['1200']);
      expect(one('og:image:height')).toEqual(['630']);
      expect(one('og:image:alt')).toEqual([OG_ALT]);
    });
  }

  test('the homepage has og:locale', () => {
    expect(pages.homepage).toMatch(/<meta\s+property="og:locale"\s+content="en"/);
  });

  test('og.png ships at 1200 x 630', () => {
    const buf = fs.readFileSync(path.join(root, 'site/dist/og.png'));
    expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
  });
});
