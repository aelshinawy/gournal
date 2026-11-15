import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

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
            { label: 'CLI', items: [{ autogenerate: { directory: 'docs/reference/cli' } }] },
            { label: 'MCP tools', items: [{ autogenerate: { directory: 'docs/reference/mcp' } }] },
            'docs/reference/configuration',
            'docs/reference/environment'
          ]
        },
        {
          label: 'Resources',
          items: ['docs/resources/changelog', 'docs/resources/faq']
        }
      ]
    })
  ]
});
