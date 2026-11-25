// Two plugins that make every code block keyboard focusable in the static HTML,
// so keyboard users can scroll wide code. WCAG 2.1.1 and axe "scrollable-region-focusable".
// The built-in tabindex needs client JS. Expressive Code's script later removes tabindex from blocks that do not scroll.
// The name is "<nearest heading>, <language> code". A repeat of the same name gets " 2", " 3", and so on.
//
// Expressive Code gives its hook no heading, so the two plugins work as a pair.
// 1. codeLabelMeta is a Satteri hast plugin. It runs before Expressive Code in the same tree.
//    It tracks the nearest heading, builds the name, and adds it to the fence meta as glabel="<encoded name>".
// 2. ecFocusable is the Expressive Code plugin. It reads glabel from the block meta and sets the attributes.

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const META_KEY = 'glabel';

const languageName = (language) => (language && language !== 'plaintext' ? language : 'text');

export function codeLabelMeta() {
  return () => {
    let heading = '';
    const seen = new Map();
    return {
      name: 'gournal-code-label',
      element: {
        filter: [...HEADINGS, 'pre'],
        visit(node, ctx) {
          if (node.tagName !== 'pre') {
            heading = ctx.textContent(node).trim();
            return;
          }
          const code = node.children?.find((c) => c.type === 'element' && c.tagName === 'code');
          if (!code) return;
          const name = heading || ctx.data.astro?.frontmatter?.title;
          const language = `${languageName(code.data?.lang)} code`;
          const base = name ? `${name}, ${language}` : language;
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          const label = encodeURIComponent(n === 1 ? base : `${base} ${n}`);
          ctx.setField(code, 'data', { ...code.data, meta: `${code.data?.meta ?? ''} ${META_KEY}="${label}"`.trim() });
        }
      }
    };
  };
}

function findPre(node) {
  if (node.type === 'element' && node.tagName === 'pre') return node;
  for (const child of node.children ?? []) {
    const found = findPre(child);
    if (found) return found;
  }
  return undefined;
}

export function ecFocusable() {
  return {
    name: 'gournal-focusable-code',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const pre = findPre(renderData.blockAst);
        if (!pre) return;
        const label = codeBlock.metaOptions?.getString(META_KEY);
        pre.properties = pre.properties ?? {};
        pre.properties.tabindex = '0';
        pre.properties.role = 'region';
        pre.properties.ariaLabel = label ? decodeURIComponent(label) : `${languageName(codeBlock.language)} code`;
      }
    }
  };
}
