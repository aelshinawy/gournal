import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../../src/adapters/mcp';
import type { GeneratedPage } from './cli';
import { GENERATED_NOTE, code, frontmatter, firstSentence, table } from './markdown';

export interface JSONSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  default?: unknown;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
}

interface Tool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

const BASE = '/gournal/docs/reference/mcp';

/**
 * Names for output shapes that two or more tools share. The key is the sorted tool names of the
 * group, joined with a comma. The value is the shape slug. The page heading and the anchor come
 * from the slug: `entry-result` gives `## Entry result` and `#entry-result`.
 */
export const SHAPE_NAMES: Readonly<Record<string, string>> = {
  'add_entry,delete_entry,resolve_entry,update_entry': 'entry-result',
  'find_entries,list_entries': 'entry-list',
};

/**
 * A server for docs only. The journal stub throws on any access, so a tools/list run can never open
 * a journal. `touched()` tells whether the stub was hit.
 */
export function createDocsServer() {
  let hit = false;
  const trap = (): never => {
    hit = true;
    throw new Error('docs generator must not open a journal');
  };
  const journal = new Proxy({}, { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, set: trap });
  const server = createServer({
    journal: journal as never,
    identity: () => ({ project: 'docs', repo: null, branch: null }),
    processCwd: () => '/',
  });
  return { server, touched: () => hit };
}

async function listTools(): Promise<Tool[]> {
  const { server, touched } = createDocsServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'docs-generator', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const { tools } = await client.listTools();
    if (touched()) throw new Error('docs generator must not open a journal');
    return tools as unknown as Tool[];
  } finally {
    await client.close();
    await server.close();
  }
}

// ---- schema rendering ----

function resolveRef(schema: JSONSchema, root: JSONSchema): JSONSchema {
  let cur = schema;
  for (let i = 0; cur.$ref && i < 20; i++) {
    const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(cur.$ref);
    const target = m ? (root[m[1] as '$defs' | 'definitions'] ?? {})[m[2]] : undefined;
    if (!target) throw new Error(`Cannot resolve schema reference ${cur.$ref}`);
    cur = target;
  }
  return cur;
}

/** The variants of a schema: anyOf/oneOf branches, or the schema itself. A type array splits into one variant per type. */
function variants(schema: JSONSchema, root: JSONSchema): JSONSchema[] {
  const s = resolveRef(schema, root);
  const union = s.anyOf ?? s.oneOf;
  if (union) return union.flatMap((v) => variants(v, root));
  if (Array.isArray(s.type)) return s.type.map((t) => ({ ...s, type: t }));
  return [s];
}

function atom(v: JSONSchema, root: JSONSchema): string {
  if (v.const !== undefined) return JSON.stringify(v.const);
  if (v.enum) return v.enum.map((e) => JSON.stringify(e)).join(' | ');
  switch (v.type) {
    case 'integer': return 'integer';
    case 'array': {
      const inner = v.items ? typeText(v.items, root) : 'any';
      return `${inner.includes(' | ') ? `(${inner})` : inner}[]`;
    }
    case undefined: return v.properties || v.additionalProperties ? 'object' : 'any';
    default: return v.type;
  }
}

function typeText(schema: JSONSchema, root: JSONSchema): string {
  const seen: string[] = [];
  for (const v of variants(schema, root)) {
    const t = atom(v, root);
    if (!seen.includes(t)) seen.push(t);
  }
  // A null variant goes last, so `string | null` reads the same for every nullable field.
  const nonNull = seen.filter((t) => t !== 'null');
  return (seen.length > nonNull.length ? [...nonNull, 'null'] : nonNull).join(' | ');
}

function describe(schema: JSONSchema, root: JSONSchema): string {
  const s = resolveRef(schema, root);
  const base = s.description ?? '';
  if (s.default === undefined) return base;
  const def = `Default: ${code(JSON.stringify(s.default))}.`;
  return base ? `${base} ${def}` : def;
}

/** The first object variant, or the item schema of an array of objects, whose fields get child rows. */
function childSchema(schema: JSONSchema, root: JSONSchema): { props?: Record<string, JSONSchema>; required: string[]; extra?: JSONSchema } {
  for (const v of variants(schema, root)) {
    if (v.type === 'array' && v.items) {
      const inner = childSchema(v.items, root);
      if (inner.props || inner.extra) return inner;
    }
    if (v.properties) return { props: v.properties, required: v.required ?? [] };
    if (typeof v.additionalProperties === 'object' && Object.keys(v.additionalProperties).length > 0) {
      return { required: [], extra: v.additionalProperties };
    }
  }
  return { required: [] };
}

function rowsFor(props: Record<string, JSONSchema>, required: string[], prefix: string, root: JSONSchema, out: string[][]): void {
  // Schema property order is the zod declaration order. JS keeps string keys in insertion order,
  // so the output is byte-stable on every Node version.
  for (const [name, prop] of Object.entries(props)) {
    const field = `${prefix}${name}`;
    out.push([code(field), code(typeText(prop, root)), required.includes(name) ? 'yes' : 'no', describe(prop, root)]);
    descend(prop, field, root, out);
  }
}

function descend(prop: JSONSchema, field: string, root: JSONSchema, out: string[][]): void {
  const child = childSchema(prop, root);
  if (child.props) rowsFor(child.props, child.required, `${field}.`, root, out);
  else if (child.extra) {
    const key = `${field}.<key>`;
    out.push([code(key), code(typeText(child.extra, root)), 'yes', describe(child.extra, root)]);
    descend(child.extra, key, root, out);
  }
}

/** Rows of [field, type, required, description] for the fields of an object schema. Nested fields use `a.b`. */
export function schemaRows(schema: JSONSchema): string[][] {
  const out: string[][] = [];
  const child = childSchema(schema, schema);
  if (child.props) rowsFor(child.props, child.required, '', schema, out);
  return out;
}

const FIELD_HEADERS = ['Field', 'Type', 'Required', 'Description'];

// ---- pages ----

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function shapeHeading(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fieldTable(schema: JSONSchema): string {
  return table(FIELD_HEADERS, schemaRows(schema));
}

/**
 * Starlight sorts pages that have a sidebar order before pages without one. Every page here carries an
 * order, so the tools stay alphabetical and `output-shapes` comes last.
 */
function withOrder(front: string, order: number): string {
  return front.replace(/\n---$/, `\nsidebar:\n  order: ${order}\n---`);
}

function toolPage(tool: Tool, order: number, shapeSlug: string | undefined, example: string | undefined): GeneratedPage {
  const description = tool.description ?? '';
  const lines: string[] = [
    withOrder(frontmatter(tool.name, firstSentence(description)).trimEnd(), order),
    `<!-- ${GENERATED_NOTE} Edit examples in site/src/content/examples/mcp/${tool.name}.md. -->`,
    '',
    description,
    '',
    '## Input',
    '',
  ];
  const inputRows = schemaRows(tool.inputSchema);
  lines.push(inputRows.length > 0 ? fieldTable(tool.inputSchema) : 'This tool takes no input.');
  lines.push('', '## Output', '');
  if (!tool.outputSchema) {
    lines.push('This tool returns text content. It has no structured output.');
  } else if (shapeSlug) {
    lines.push(`This tool returns structured output. The shape is the [${shapeHeading(shapeSlug)}](${BASE}/output-shapes/#${shapeSlug}).`);
  } else {
    lines.push(fieldTable(tool.outputSchema));
  }
  if (example !== undefined && example.trim() !== '') {
    lines.push('', '## Examples', '', example.trim());
  }
  return { path: `mcp/${tool.name}.md`, content: `${lines.join('\n')}\n` };
}

function shapesPage(shapes: Array<{ slug: string; tools: string[]; schema: JSONSchema }>, order: number): GeneratedPage {
  const lines: string[] = [
    '---',
    'title: Output shapes',
    'description: Output shapes that several MCP tools share.',
    'sidebar:',
    `  order: ${order}`,
    '---',
    `<!-- ${GENERATED_NOTE} -->`,
    '',
    'Several MCP tools return the same structured output. This page lists each shared shape once.',
  ];
  for (const s of shapes) {
    lines.push('', `## ${shapeHeading(s.slug)}`, '', `Tools that return this shape: ${s.tools.map((t) => `[${code(t)}](${BASE}/${t}/)`).join(', ')}.`, '', fieldTable(s.schema));
  }
  return { path: 'mcp/output-shapes.md', content: `${lines.join('\n')}\n` };
}

/** One page per MCP tool, plus `mcp/output-shapes.md`. `examples` maps a tool name to its example text. */
export async function mcpPages(examples: Map<string, string>): Promise<GeneratedPage[]> {
  const tools = (await listTools()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const groups = new Map<string, { schema: JSONSchema; tools: string[] }>();
  for (const t of tools) {
    if (!t.outputSchema) continue;
    const key = canonical(t.outputSchema);
    const g = groups.get(key) ?? { schema: t.outputSchema, tools: [] };
    g.tools.push(t.name);
    groups.set(key, g);
  }
  const shapes: Array<{ slug: string; tools: string[]; schema: JSONSchema }> = [];
  const slugByTool = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.tools.length < 2) continue;
    const slug = SHAPE_NAMES[g.tools.join(',')];
    if (!slug) {
      throw new Error(`These MCP tools share one output shape and it has no name: ${g.tools.join(', ')}. Add '${g.tools.join(',')}': '<name>' to SHAPE_NAMES in site/scripts/reference/mcp.ts.`);
    }
    shapes.push({ slug, tools: g.tools, schema: g.schema });
    for (const t of g.tools) slugByTool.set(t, slug);
  }
  shapes.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  return [
    ...tools.map((t, i) => toolPage(t, i + 1, slugByTool.get(t.name), examples.get(t.name))),
    shapesPage(shapes, tools.length + 1),
  ];
}
