// Expressive Code plugin. Makes every code block keyboard focusable without client JS,
// so keyboard users can scroll wide code. WCAG 2.1.1 and axe "scrollable-region-focusable".
// Each block gets a unique name: "<nearest heading>, <language> code", plus a counter on repeats.
import fs from 'node:fs';

function findPre(node) {
  if (node.type === 'element' && node.tagName === 'pre') return node;
  for (const child of node.children ?? []) {
    const found = findPre(child);
    if (found) return found;
  }
  return undefined;
}

// Expressive Code gives the hook no heading context, only the source path and the block index.
// So read the Markdown source and list the nearest preceding heading for each fenced block.
function headingsPerBlock(source) {
  const lines = source.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const title = source.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ?? '';
  const out = [];
  let heading = title;
  let fence = null;
  for (const line of lines) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) {
        fence = f[1];
        out.push(heading);
      } else if (f[1][0] === fence[0] && f[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;
    const h = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) heading = h[1].replace(/[`*_]/g, '');
  }
  return out;
}

export function ecFocusable() {
  const headings = new Map();
  const names = new Map();
  return {
    name: 'gournal-focusable-code',
    hooks: {
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const pre = findPre(renderData.blockAst);
        if (!pre) return;
        const file = codeBlock.parentDocument?.sourceFilePath;
        let heading = '';
        if (file) {
          if (!headings.has(file)) {
            try {
              headings.set(file, headingsPerBlock(fs.readFileSync(file, 'utf8')));
            } catch {
              headings.set(file, []);
            }
          }
          heading = headings.get(file)[codeBlock.parentDocument.positionInDocument?.groupIndex ?? -1] ?? '';
        }
        const language = codeBlock.language && codeBlock.language !== 'plaintext' ? codeBlock.language : 'text';
        const base = heading ? `${heading}, ${language} code` : `${language} code`;
        const key = `${file ?? ''}|${base}`;
        const n = (names.get(key) ?? 0) + 1;
        names.set(key, n);
        pre.properties = pre.properties ?? {};
        pre.properties.tabindex = '0';
        pre.properties.role = 'region';
        pre.properties.ariaLabel = n === 1 ? base : `${base} ${n}`;
      }
    }
  };
}
