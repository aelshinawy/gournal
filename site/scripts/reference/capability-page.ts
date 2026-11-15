import fs from 'fs';
import path from 'path';
import { CAPABILITIES, type Capability } from './capabilities';
import type { CliSection, GeneratedPage } from './cli';
import { baseShapes, fieldTable, shapeHeading, type SharedShape, type ToolSection } from './mcp';
import { GENERATED_NOTE, code, firstSentence, frontmatter } from './markdown';

const DOCS_ROOT = '/gournal/docs';
const GUIDES_DIR = path.resolve(__dirname, '../../src/content/docs/docs/guides');

function guideTitle(name: string): string {
  const text = fs.readFileSync(path.join(GUIDES_DIR, `${name}.md`), 'utf8');
  const m = /^title:\s*(.+)$/m.exec(text.split(/^---$/m)[1] ?? '');
  if (!m) throw new Error(`Guide ${name} has no title in its frontmatter.`);
  return m[1].trim().replace(/^(["'])(.*)\1$/, '$2');
}

function relatedLink(entry: string): string {
  if (entry.startsWith('guides/')) {
    const name = entry.slice('guides/'.length);
    return `- [${guideTitle(name)}](${DOCS_ROOT}/guides/${name}/)`;
  }
  const target = CAPABILITIES.find((c) => c.slug === entry);
  if (!target) throw new Error(`Related entry "${entry}" is not a capability or a guide.`);
  return `- [${target.title}](${DOCS_ROOT}/reference/${target.slug}/)`;
}

/** Examples of one kind. With more than one example, each gets a heading with its command or tool name. */
function exampleBlock(items: Array<{ name: string; example: string }>): string {
  const withExample = items.filter((i) => i.example !== '');
  if (items.length === 1) return withExample.map((i) => i.example).join('');
  return withExample.map((i) => `#### ${i.name}\n\n${i.example}`).join('\n\n');
}

function cliBlock(s: CliSection): string {
  const parts = [`### ${s.title}`, s.description, `\`\`\`text\n${s.usage}\n\`\`\``];
  if (s.args) parts.push(`#### Arguments\n\n${s.args}`);
  if (s.options) parts.push(`#### Options\n\n${s.options}`);
  return parts.join('\n\n');
}

function toolBlock(s: ToolSection): string {
  return [`### ${s.name}`, s.description, `#### Input\n\n${s.input}`, `#### Output\n\n${s.output}`].join('\n\n');
}

export function capabilityPage(cap: Capability, cli: CliSection[], mcp: ToolSection[]): GeneratedPage {
  const blocks: string[] = [
    frontmatter(cap.title, firstSentence(cap.summary)).trimEnd(),
    `<!-- ${GENERATED_NOTE} Edit examples in site/src/content/examples/. -->`,
    cap.summary,
  ];
  if (cap.caution) blocks.push(`:::caution\n${cap.caution}\n:::`);
  if (cli.length > 0) blocks.push(`## CLI\n\n${cli.map(cliBlock).join('\n\n')}`);
  if (mcp.length > 0) blocks.push(`## MCP tool\n\n${mcp.map(toolBlock).join('\n\n')}`);

  const cliExamples = exampleBlock(cli.map((s) => ({ name: s.title, example: s.example })));
  const mcpExamples = exampleBlock(mcp.map((s) => ({ name: s.name, example: s.example })));
  const examples: string[] = [];
  if (cliExamples) examples.push(`### CLI\n\n${cliExamples}`);
  if (mcpExamples) examples.push(`### MCP\n\n${mcpExamples}`);
  if (examples.length > 0) blocks.push(`## Examples\n\n${examples.join('\n\n')}`);

  if (cap.related.length > 0) blocks.push(`## Related\n\n${cap.related.map(relatedLink).join('\n')}`);
  return { path: `${cap.slug}.md`, content: `${blocks.join('\n\n')}\n` };
}

const BASE_INTRO: Record<string, string> = {
  entry: 'Tool outputs use this object for each journal entry. Their tables link here.',
  activity: 'Tool outputs use this object for each GitHub activity item. Their tables link here.',
};

function toolLink(tool: string): string {
  const cap = CAPABILITIES.find((c) => c.mcp.includes(tool));
  if (!cap) throw new Error(`MCP tool ${tool} has no capability.`);
  return `[${code(tool)}](${DOCS_ROOT}/reference/${cap.slug}/#${tool})`;
}

/** The shared output shapes: the base shapes Entry and Activity, then the shapes that tools share. */
export function outputShapesPage(shared: SharedShape[]): GeneratedPage {
  const lines: string[] = [
    '---',
    'title: Output shapes',
    'description: Output shapes that several MCP tools share.',
    '---',
    `<!-- ${GENERATED_NOTE} -->`,
    '',
    'Several MCP tools return the same structured output. This page lists each shared shape once.',
  ];
  const sections = [
    ...baseShapes().map((s) => ({ slug: s.slug, intro: BASE_INTRO[s.slug], schema: s.schema })),
    ...shared.map((s) => ({
      slug: s.slug,
      intro: `Tools that return this shape: ${s.tools.map(toolLink).join(', ')}.`,
      schema: s.schema,
    })),
  ].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const s of sections) lines.push('', `## ${shapeHeading(s.slug)}`, '', s.intro, '', fieldTable(s.schema));
  return { path: 'output-shapes.md', content: `${lines.join('\n')}\n` };
}
