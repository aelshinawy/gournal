import { CONFIG_KEY_DOCS, ENV_VAR_DOCS } from '../../../src/core';
import type { GeneratedPage } from './cli';
import { GENERATED_NOTE, code, firstSentence, frontmatter, table } from './markdown';

const NOTE = `<!-- ${GENERATED_NOTE} Edit descriptors in src/core/docs-meta.ts. -->`;

export function configPage(): GeneratedPage {
  const rows = CONFIG_KEY_DOCS.map((k) => [
    code(k.key),
    k.type,
    k.default,
    k.validation ? `${k.description} **Validation:** ${k.validation}` : k.description,
  ]);
  const intro = 'The config file is `config.json` in the gournal home folder. These keys are supported.';
  const content = [
    frontmatter('Configuration keys', firstSentence(intro)).trimEnd(),
    NOTE,
    '',
    intro,
    '',
    table(['Key', 'Type', 'Default', 'Description'], rows),
  ].join('\n');
  return { path: 'configuration.md', content: `${content}\n` };
}

export function environmentPage(): GeneratedPage {
  const rows = ENV_VAR_DOCS.map((v) => [code(v.name), v.default, v.description]);
  const intro = 'Gournal reads these environment variables.';
  const content = [
    frontmatter('Environment variables', firstSentence(intro)).trimEnd(),
    NOTE,
    '',
    intro,
    '',
    table(['Name', 'Default', 'Description'], rows),
  ].join('\n');
  return { path: 'environment.md', content: `${content}\n` };
}
