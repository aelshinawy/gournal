import { CONFIG_KEY_DOCS, ENV_VAR_DOCS } from './docs-meta';
import type { GeneratedPage } from './cli';
import { GENERATED_NOTE, code, firstSentence, frontmatter, table } from './markdown';

const NOTE = `<!-- ${GENERATED_NOTE} Edit descriptors in site/scripts/reference/docs-meta.ts. -->`;

function tablePage(path: string, title: string, intro: string, head: string[], rows: string[][]): GeneratedPage {
  const content = [frontmatter(title, firstSentence(intro)).trimEnd(), NOTE, '', intro, '', table(head, rows)].join('\n');
  return { path, content: `${content}\n` };
}

export function configPage(): GeneratedPage {
  const rows = CONFIG_KEY_DOCS.map((k) => [
    code(k.key),
    k.type,
    k.default,
    k.validation ? `${k.description} **Validation:** ${k.validation}` : k.description,
  ]);
  return tablePage(
    'configuration.md',
    'Configuration keys',
    'The config file is `config.json` in the gournal home folder. These keys are supported.',
    ['Key', 'Type', 'Default', 'Description'],
    rows,
  );
}

export function environmentPage(): GeneratedPage {
  const rows = ENV_VAR_DOCS.map((v) => [code(v.name), v.default, v.description]);
  return tablePage(
    'environment.md',
    'Environment variables',
    'Gournal reads these environment variables.',
    ['Name', 'Default', 'Description'],
    rows,
  );
}
