import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'site/dist');
const hasBuild = fs.existsSync(path.join(dist, 'docs'));

function htmlFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'pagefind' ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

function parseBlock(css: string, selector: RegExp): Record<string, string> {
  const m = css.match(selector);
  if (!m) throw new Error(`block not found: ${selector}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1].matchAll(/--g-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[k] = v;
  return out;
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('built pages', () => {
  const run = hasBuild ? test : test.skip;
  if (!hasBuild) console.log('site-a11y: skipping built page checks. Run npm --prefix site run build first.');
  const pages = hasBuild ? htmlFiles(dist) : [];

  run('every content table is inside a focusable labelled region', () => {
    const bad: string[] = [];
    let tables = 0;
    for (const f of pages) {
      const html = fs.readFileSync(f, 'utf8');
      for (const m of html.matchAll(/<table\b/g)) {
        tables++;
        const before = html.slice(0, m.index);
        const open = before.lastIndexOf('<div class="g-table');
        const wrapper = html.slice(open, before.length);
        const ok = open !== -1 && /role="region"/.test(wrapper) && /tabindex="0"/.test(wrapper) && /aria-label="[^"]+"/.test(wrapper) && !wrapper.includes('</div>');
        if (!ok) bad.push(path.relative(dist, f));
      }
    }
    // Exact count: add a table to a page and update this number.
    expect(tables).toBe(43);
    expect(bad).toEqual([]);
  });

  run('every table on the built reference overview has g-table--overview', () => {
    const file = path.join(dist, 'docs/reference/index.html');
    expect(fs.existsSync(file)).toBe(true);
    const html = fs.readFileSync(file, 'utf8');
    const tables = [...html.matchAll(/<table\b/g)];
    expect(tables.length).toBe(5);
    for (const m of tables) {
      const before = html.slice(0, m.index);
      const wrapper = before.slice(before.lastIndexOf('<div class="g-table'));
      expect(wrapper).toMatch(/^<div class="[^"]*g-table--overview/);
    }
  });

  run('content tables fill their wrapper (display: table, width 100%)', () => {
    const css = fs.readFileSync(path.join(__dirname, '../site/src/styles/docs.css'), 'utf8');
    const rule = css.match(/\.sl-markdown-content \.g-table table\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/display:\s*table\s*;/);
    expect(rule![1]).toMatch(/width:\s*100%/);
  });

  run('every code pre has tabindex 0', () => {
    const bad: string[] = [];
    let count = 0;
    for (const f of pages) {
      const html = fs.readFileSync(f, 'utf8');
      for (const m of html.matchAll(/<pre\b[^>]*>/g)) {
        count++;
        if (!/tabindex="0"/.test(m[0])) bad.push(`${path.relative(dist, f)} ${m[0].slice(0, 60)}`);
      }
    }
    expect(count).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  run('no page loads a resource from another host', () => {
    const bad: string[] = [];
    for (const f of pages) {
      const html = fs.readFileSync(f, 'utf8');
      const tags = html.match(/<(script|link|img|source|video|audio|iframe)\b[^>]*>/gi) ?? [];
      for (const tag of tags) {
        if (/<link\b/i.test(tag) && !/rel="(stylesheet|preload|prefetch|modulepreload|icon)"/i.test(tag)) continue;
        const url = tag.match(/\b(?:src|href)="(https?:)?\/\/[^"]+"/i);
        if (url) bad.push(`${path.relative(dist, f)} ${url[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('design tokens', () => {
  const css = fs.readFileSync(path.join(root, 'site/src/styles/tokens.css'), 'utf8');
  const light = parseBlock(css, /^:root \{([\s\S]*?)^\}/m);
  const dark = { ...light, ...parseBlock(css, /:root\[data-theme='dark'\] \{([\s\S]*?)^\}/m) };

  const surfaces = ['paper', 'paper-raised', 'paper-sunk', 'code-bg', 'accent-wash'];
  const texts = ['ink', 'ink-soft', 'ink-muted', 'accent-text'];

  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    test(`text tokens meet 4.5:1 on every surface in ${name}`, () => {
      const fails: string[] = [];
      for (const s of surfaces) {
        for (const x of texts) {
          const r = contrast(t[x], t[s]);
          if (r < 4.5) fails.push(`${x} on ${s}: ${r.toFixed(2)}`);
        }
      }
      expect(fails).toEqual([]);
    });

    test(`on-accent text meets 4.5:1 on accent in ${name}`, () => {
      expect(contrast(t['on-accent'], t['accent'])).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('dark theme blocks', () => {
  test('data-theme dark and prefers-color-scheme blocks define the same values', () => {
    const css = fs.readFileSync(path.join(root, 'site/src/styles/tokens.css'), 'utf8');
    const explicit = parseBlock(css, /:root\[data-theme='dark'\] \{([\s\S]*?)^\}/m);
    const media = parseBlock(css, /:root:not\(\[data-theme\]\) \{([\s\S]*?)^  \}/m);
    expect(Object.keys(media).length).toBeGreaterThan(5);
    expect(media).toEqual(explicit);
    const light = parseBlock(css, /^:root \{([\s\S]*?)^\}/m);
    expect(Object.keys(explicit).sort()).toEqual(Object.keys(light).sort());
  });
});

describe('reduced motion coverage', () => {
  const css = fs.readFileSync(path.join(root, 'site/src/styles/docs.css'), 'utf8');
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  let depth = 0;
  let end = css.length;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) {
      end = i;
      break;
    }
  }
  const block = css.slice(start, end);

  // These Starlight elements can move: the sidebar caret (svg), the details summary marker,
  // the code copy button and its tooltip (button, div), and links. The block lists their tags.
  test('the reduced motion block covers the tags that move', () => {
    for (const tag of ['a', 'button', 'summary', 'details', 'svg', 'div', 'span']) {
      expect(block).toMatch(new RegExp(`[(,\\s]${tag}[,)]`));
    }
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto/);
  });

  const built = fs.existsSync(path.join(dist, '_astro'));
  const run = built ? test : test.skip;
  // Starlight's search dialog, its tabs, and its mobile menu have no transition or animation of their own.
  // If a future Starlight adds one, this test fails and the element joins the reduced motion block.
  run('dialog, site-search, starlight-tabs, and the mobile menu have no motion rules', () => {
    const files = fs.readdirSync(path.join(dist, '_astro')).filter((f) => f.endsWith('.css'));
    const rules = files.flatMap((f) => fs.readFileSync(path.join(dist, '_astro', f), 'utf8').match(/[^{}]+\{[^{}]*\}/g) ?? []);
    const moving = rules.filter((r) => /(^|[^-])(transition|animation)\s*[:-]/.test(r.slice(r.indexOf('{'))) && !/no-preference/.test(r));
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.some((r) => r.includes('.caret'))).toBe(true);
    const names = ['dialog', 'site-search', 'starlight-tabs', 'starlight-menu-button', 'mobile-starlight-toc'];
    const hits = moving.filter((r) => names.some((n) => new RegExp(`(^|[\\s,>+~])${n}([\\s,.:#\\[>+~{]|$)`).test(r.slice(0, r.indexOf('{')))));
    expect(hits).toEqual([]);
  });
});

describe('docs.css', () => {
  test('reduced motion block has no universal selector', () => {
    const css = fs.readFileSync(path.join(root, 'site/src/styles/docs.css'), 'utf8');
    const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let end = start;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    const block = css.slice(start, end);
    const selectors = [...block.matchAll(/([^{}]+)\{/g)].slice(1).map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) expect(sel).not.toMatch(/(^|[\s,>+~(])\*($|[\s,>+~):])/);
    expect(block).not.toMatch(/transition-duration|animation-duration/);
  });
});
