// Expressive Code plugin. Makes every code block keyboard focusable without client JS,
// so keyboard users can scroll wide code. WCAG 2.1.1 and axe "scrollable-region-focusable".
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
        pre.properties = pre.properties ?? {};
        pre.properties.tabindex = '0';
        const language = codeBlock.language && codeBlock.language !== 'plaintext' ? `${codeBlock.language} ` : '';
        pre.properties.ariaLabel = `${language}code`;
        pre.properties.role = 'region';
      }
    }
  };
}
