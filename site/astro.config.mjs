import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
import referenceSidebar from './src/generated/reference-sidebar.json' with { type: 'json' };

export default defineConfig({
  site: 'https://aelshinawy.github.io',
  base: '/gournal/',
  markdown: { smartypants: false },
  integrations: [
    starlight({
      title: 'gournal',
      customCss: ['./src/styles/tokens.css', './src/styles/fonts.css', './src/styles/docs.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/aelshinawy/gournal' }],
      expressiveCode: {
        styleOverrides: {
          codeFontFamily: 'var(--g-font-mono)',
          codeFontSize: '0.875rem',
          codeBackground: 'var(--g-code-bg)',
          borderColor: 'var(--g-rule-strong)',
          borderRadius: '8px'
        }
      },
      head: [
        {
          // Code blocks that scroll need keyboard focus, so keyboard users can read the cut-off text.
          tag: 'script',
          content:
            "addEventListener('DOMContentLoaded',()=>{document.querySelectorAll('.expressive-code pre').forEach((p)=>{if(p.scrollWidth>p.clientWidth){p.tabIndex=0;}});});"
        }
      ],
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
