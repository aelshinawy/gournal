import fs from 'fs';
import path from 'path';
import { CAPABILITIES, GROUPS, type Capability } from './capabilities';
import { demoteHeadings, type CliSection, type GeneratedPage } from './cli';
import { baseShapes, fieldTable, shapeHeading, type SharedShape, type ToolSection } from './mcp';
import { GENERATED_NOTE, code, firstSentence, frontmatter, table } from './markdown';

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

/**
 * Examples of one kind. With more than one example, each gets a heading with its command or tool name.
 * Their own headings then move below that heading.
 */
function exampleBlock(items: Array<{ name: string; example: string }>): string {
  const withExample = items.filter((i) => i.example !== '');
  if (items.length === 1) return withExample.map((i) => i.example).join('');
  return withExample.map((i) => `#### ${i.name}\n\n${demoteHeadings(i.example, 5)}`).join('\n\n');
}

/**
 * One command. A page with one command has no per-command heading, so its sub-headings sit at `###`.
 * With several commands, each has a `###` heading and its sub-headings sit at `####`.
 */
function cliBlock(s: CliSection, single: boolean): string {
  const sub = single ? '###' : '####';
  const parts = single ? [] : [`### ${s.title}`];
  parts.push(s.description, `\`\`\`text\n${s.usage}\n\`\`\``);
  if (s.args) parts.push(`${sub} Arguments\n\n${s.args}`);
  if (s.options) parts.push(`${sub} Options\n\n${s.options}`);
  return parts.join('\n\n');
}

function toolBlock(s: ToolSection, single: boolean): string {
  const sub = single ? '###' : '####';
  const parts = single ? [] : [`### ${s.name}`];
  parts.push(s.description, `${sub} Input\n\n${s.input}`, `${sub} Output\n\n${s.output}`);
  return parts.join('\n\n');
}

/** The id Starlight gives a heading: lowercase, punctuation dropped except `_` and `-`, spaces to hyphens. */
function headingId(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9_\s-]/g, '').replace(/ /g, '-');
}

/** The anchor of a CLI command, or of an MCP tool, on its capability page. */
function surfaceAnchor(cap: Capability, name: string, cli: boolean): string {
  const count = cli ? cap.cli.length : cap.mcp.length;
  const text = cli ? `gournal ${name}` : name;
  if (count === 1) return headingId(cli ? `CLI: ${text}` : `MCP tool: ${text}`);
  return headingId(text);
}

export function capabilityPage(cap: Capability, cli: CliSection[], mcp: ToolSection[]): GeneratedPage {
  const blocks: string[] = [
    frontmatter(cap.title, firstSentence(cap.summary)).trimEnd(),
    `<!-- ${GENERATED_NOTE} Edit examples in site/src/content/examples/. -->`,
    cap.summary,
  ];
  if (cap.caution) blocks.push(`:::caution\n${cap.caution}\n:::`);
  if (cli.length === 1) blocks.push(`## CLI: ${cli[0].title}\n\n${cliBlock(cli[0], true)}`);
  else if (cli.length > 1) blocks.push(`## CLI\n\n${cli.map((s) => cliBlock(s, false)).join('\n\n')}`);
  if (mcp.length === 1) blocks.push(`## MCP tool: ${mcp[0].name}\n\n${toolBlock(mcp[0], true)}`);
  else if (mcp.length > 1) blocks.push(`## MCP tool\n\n${mcp.map((s) => toolBlock(s, false)).join('\n\n')}`);

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
  return `[${code(tool)}](${referenceLink(cap, `#${surfaceAnchor(cap, tool, false)}`)})`;
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

const referenceLink = (cap: Capability, anchor = ''): string => `${DOCS_ROOT}/reference/${cap.slug}/${anchor}`;

/** Links for the names of one kind. The anchor follows the heading of the name on its page. */
function nameLinks(cap: Capability, names: string[], cli: boolean): string {
  if (names.length === 0) return 'None';
  return names.map((n) => {
    const text = cli ? `gournal ${n}` : n;
    return `[${code(text)}](${referenceLink(cap, `#${surfaceAnchor(cap, n, cli)}`)})`;
  }).join(', ');
}

/** The overview page: one table for each group, with a link for each task, command, and tool. */
export function overviewPage(): GeneratedPage {
  const lines: string[] = [
    frontmatter('Reference overview', 'Every gournal task, with its CLI command and MCP tool.').trimEnd(),
    `<!-- ${GENERATED_NOTE} -->`,
    '',
    'Each task has one page. The page shows the CLI command and the MCP tool for that task. Some tasks have only one of the two.',
    '',
    'The CLI has no edit command. The MCP `update_entry` tool fills that gap. Use it to change an entry that exists.',
  ];
  for (const g of GROUPS) {
    const rows = CAPABILITIES.filter((c) => c.group === g.id).map((c) => [
      `[${c.title}](${referenceLink(c)})`,
      nameLinks(c, c.cli, true),
      nameLinks(c, c.mcp, false),
    ]);
    lines.push('', `## ${g.label}`, '', table(['Task', 'CLI', 'MCP tool'], rows));
  }
  lines.push(
    '',
    '## More reference',
    '',
    `- [Output shapes](${DOCS_ROOT}/reference/output-shapes/)`,
    `- [Configuration keys](${DOCS_ROOT}/reference/configuration/)`,
    `- [Environment variables](${DOCS_ROOT}/reference/environment/)`,
  );
  return { path: 'index.md', content: `${lines.join('\n')}\n` };
}
