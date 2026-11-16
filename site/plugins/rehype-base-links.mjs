// Hast plugin. Adds the site base to root-relative links and images in Markdown content.
// Astro does not prefix `base` in Markdown. Authors write /docs/guides/x/ and this plugin makes it /<base>docs/guides/x/.
// With base "/", it changes nothing.
// Astro 7 renders Markdown with Satteri, so this is a Satteri hast plugin (same hast tree as rehype).

const ATTRS = { a: 'href', img: 'src', source: 'src', video: 'poster' };

// Prefix a root-relative URL. Leave absolute URLs, protocol-relative URLs, anchors, and already-prefixed URLs alone.
export function withBase(url, base) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return url;
  const prefix = base.replace(/\/$/, '');
  if (prefix === '') return url;
  if (url === prefix || url.startsWith(`${prefix}/`)) return url;
  return prefix + url;
}

export function rehypeBaseLinks(base) {
  return () => ({
    name: 'gournal-base-links',
    element: {
      filter: Object.keys(ATTRS),
      // Satteri ignores direct changes to node.properties. Changes go through ctx.setProperty.
      visit(node, ctx) {
        const attr = ATTRS[node.tagName];
        const value = node.properties?.[attr];
        const next = withBase(value, base);
        if (next !== value) ctx.setProperty(node, attr, next);
      }
    }
  });
}
