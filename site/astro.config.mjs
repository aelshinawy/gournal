import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import { satteri } from '@astrojs/markdown-satteri';
import { ecFocusable } from './plugins/ec-focusable.mjs';
import { rehypeTableRegion } from './plugins/rehype-table-region.mjs';
import referenceSidebar from './src/generated/reference-sidebar.json' with { type: 'json' };

const OG_IMAGE = 'https://aelshinawy.github.io/gournal/og.png';
const OG_ALT = 'A gournal standup in the terminal: done work by project, blockers, next items, and linked GitHub activity.';

export default defineConfig({
  site: 'https://aelshinawy.github.io',
  base: '/gournal/',
  markdown: {
    processor: satteri({ features: { smartPunctuation: false }, hastPlugins: [rehypeTableRegion()] })
  },
  integrations: [
    starlight({
      title: 'gournal',
      head: [
        { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
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
            'docs/guides/data-safety-and-backups',
            'docs/guides/migrating-from-0x'
          ]
        },
        {
          label: 'Reference',
          items: [
            { slug: 'docs/reference', label: 'Overview' },
            ...referenceSidebar,
            'docs/reference/output-shapes',
            'docs/reference/configuration',
            'docs/reference/environment'
          ]
        },
        {
          label: 'Resources',
          items: ['docs/resources/changelog', 'docs/resources/faq', 'docs/resources/troubleshooting']
        }
      ]
    })
  ]
});
