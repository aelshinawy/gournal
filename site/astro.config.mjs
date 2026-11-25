import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { satteri } from '@astrojs/markdown-satteri';
import { codeLabelMeta, ecFocusable } from './plugins/ec-focusable.mjs';
import { rehypeTableRegion } from './plugins/rehype-table-region.mjs';
import { OG_ALT, OG_HEIGHT, OG_WIDTH, SITE_URL, siteUrl } from './site.config.mjs';
import { CAPABILITIES, GROUPS } from './scripts/reference/capabilities.ts';

const OG_IMAGE = siteUrl('og.png');
const referenceGroups = GROUPS.map((g) => ({
  label: g.label,
  collapsed: true,
  items: CAPABILITIES.filter((c) => c.group === g.id).map((c) => `docs/reference/${c.slug}`)
}));

export default defineConfig({
  site: SITE_URL,
  redirects: { '/docs': '/docs/start-here/introduction/' },
  markdown: {
    processor: satteri({ features: { smartPunctuation: false }, hastPlugins: [rehypeTableRegion(), codeLabelMeta()] })
  },
  integrations: [
    starlight({
      title: 'gournal',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: String(OG_WIDTH) } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: String(OG_HEIGHT) } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: OG_ALT } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } }
      ],
      customCss: ['./src/styles/tokens.css', './src/styles/fonts.css', './src/styles/docs.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/aelshinawy/gournal' }],
      expressiveCode: {
        plugins: [ecFocusable()],
        defaultProps: { frame: 'none' },
        styleOverrides: {
          codeFontFamily: 'var(--g-font-mono)',
          codeFontSize: '0.875rem',
          codeBackground: 'var(--g-code-bg)',
          borderColor: 'var(--g-rule-strong)',
          borderRadius: '8px'
        }
      },
      plugins: [starlightLinksValidator()],
      sidebar: [
        {
          label: 'Start here',
          items: [
            'docs/start-here/introduction',
            'docs/start-here/install',
            'docs/start-here/quickstart',
            'docs/start-here/core-concepts'
          ]
        },
        {
          label: 'Guides',
          items: [
            'docs/guides/logging-with-ai-agents',
            'docs/guides/standups-and-work-logs',
            'docs/guides/github-activity',
            'docs/guides/claude-code-setup',
            'docs/guides/configuration',
            'docs/guides/data-safety-and-backups'
          ]
        },
        {
          label: 'Reference',
          items: [
            { slug: 'docs/reference', label: 'Overview' },
            ...referenceGroups,
            'docs/reference/output-shapes',
            'docs/reference/configuration',
            'docs/reference/environment'
          ]
        },
        {
          label: 'Resources',
          items: ['docs/resources/faq', 'docs/resources/troubleshooting']
        }
      ]
    })
  ]
});
