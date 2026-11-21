// Expressive Code plugin. Makes every code block keyboard focusable in the static HTML,
// so keyboard users can scroll wide code. WCAG 2.1.1 and axe "scrollable-region-focusable".
// The built-in tabindex needs client JS. Expressive Code's script later removes tabindex from blocks that do not scroll.
// The name is "<language> code <n>". The number is the block position in the page, so names stay unique.
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
        const { language } = codeBlock;
        const index = codeBlock.parentDocument?.positionInDocument?.groupIndex;
        pre.properties = pre.properties ?? {};
        pre.properties.tabindex = '0';
        pre.properties.role = 'region';
        pre.properties.ariaLabel = `${language && language !== 'plaintext' ? language : 'text'} code${index === undefined ? '' : ` ${index + 1}`}`;
      }
    }
  };
}
