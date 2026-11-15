// Hast plugin. Wraps each content table in a focusable, labelled scroll region,
// so keyboard users can scroll wide tables.
// Astro 7 renders Markdown with Satteri, so this is a Satteri hast plugin (same hast tree as rehype).
// It sees Markdown content only. Expressive Code blocks are not tables, so they are never wrapped.
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

export function rehypeTableRegion() {
  return () => {
    let heading = '';
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
          ctx.wrapNode(node, {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['g-table'],
              role: 'region',
              tabIndex: 0,
              ariaLabel: name ? `${name} table` : 'Table'
            },
            children: []
          });
        }
      }
    };
  };
}
