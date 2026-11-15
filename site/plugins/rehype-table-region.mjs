// Hast plugin. Wraps each content table in a focusable, labelled scroll region,
// so keyboard users can scroll wide tables.
// Astro 7 renders Markdown with Satteri, so this is a Satteri hast plugin (same hast tree as rehype).
// It sees Markdown content only. Expressive Code blocks are not tables, so they are never wrapped.
import { fileURLToPath } from 'node:url';

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export function rehypeTableRegion() {
  return () => {
    let heading = '';
    const seen = new Map();
    return {
      name: 'gournal-table-region',
      element: {
        filter: [...HEADINGS, 'table'],
        visit(node, ctx) {
          if (node.tagName !== 'table') {
            heading = ctx.textContent(node).trim();
            return;
          }
          const name = heading || ctx.data.astro?.frontmatter?.title;
          const base = name ? `${name} table` : 'Table';
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          // Every table on the reference overview page shares one layout. Mark them by page path so CSS can give them equal proportions.
          const file = ctx.fileURL ? fileURLToPath(ctx.fileURL).replace(/\\/g, '/') : '';
          const overview = file.endsWith('reference/index.md');
          ctx.wrapNode(node, {
            type: 'element',
            tagName: 'div',
            properties: {
              className: overview ? ['g-table', 'g-table--overview'] : ['g-table'],
              role: 'region',
              tabIndex: 0,
              ariaLabel: n === 1 ? base : `${base} ${n}`
            },
            children: []
          });
        }
      }
    };
  };
}
