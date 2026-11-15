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
    for (const attr of ['autoplay', 'muted', 'loop', 'playsinline']) expect(video).toMatch(new RegExp(`\\s${attr}[\\s>=]`));
    expect(video).toContain('poster="/gournal/demo/standup-poster.png"');
    expect(video.indexOf('standup.webm')).toBeGreaterThan(-1);
    expect(video.indexOf('standup.webm')).toBeLessThan(video.indexOf('standup.mp4'));
    expect(html).toContain('Standup: Today');
  });
});
