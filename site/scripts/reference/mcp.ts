import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../../../src/adapters/mcp';
import { z } from 'zod';
import { ActivitySchema, EntrySchema } from '../../../src/core';
import { demoteHeadings } from './cli';
import { code, table } from './markdown';

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

export interface Tool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

const SHAPES_URL = '/docs/reference/output-shapes/';

/**
 * Names for output shapes that two or more tools share. The key is the sorted tool names of the
 * group, joined with a comma. The value is the shape slug. The page heading and the anchor come
 * from the slug: `entry-result` gives `## Entry result` and `#entry-result`.
 */
const SHAPE_NAMES: Readonly<Record<string, string>> = {
  'add_entry,delete_entry,resolve_entry,update_entry': 'entry-result',
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

export async function listTools(): Promise<Tool[]> {
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
    default: return String(v.type);
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

function defaultCell(schema: JSONSchema, root: JSONSchema): string {
  const s = resolveRef(schema, root);
  return s.default === undefined ? '' : code(JSON.stringify(s.default));
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

/**
 * JSON Schema of a zod schema that tools share, without the description of the outer object. It uses the
 * converter and the 2020-12 target that the MCP SDK uses, so the result compares equal to the schema in a tool listing.
 */
function sharedSchema(schema: z.ZodType): JSONSchema {
  return withoutMeta(z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as JSONSchema);
}

function withoutMeta(schema: JSONSchema): JSONSchema {
  const { description: _description, ...rest } = schema as JSONSchema & { $schema?: string };
  delete (rest as { $schema?: string }).$schema;
  return rest;
}

/** Shapes that get one section on the output shapes page. Tool tables link to them and do not repeat the fields. */
const BASE_SHAPES = [
  { slug: 'entry', schema: EntrySchema },
  { slug: 'activity', schema: ActivitySchema },
].map((s) => ({ slug: s.slug, schema: sharedSchema(s.schema) }));

const BASE_BY_CANON = new Map(BASE_SHAPES.map((s) => [canonical(s.schema), s.slug]));

/** The link cell for a field that is one base shape or an array of it, or undefined. */
function shapeLink(schema: JSONSchema, root: JSONSchema): string | undefined {
  const s = resolveRef(schema, root);
  if (s.type === 'array' && s.items) {
    const inner = shapeLink(s.items, root);
    return inner ? inner.replace('`](', '[]`](') : undefined;
  }
  const slug = BASE_BY_CANON.get(canonical(withoutMeta(s)));
  return slug ? `[${code(shapeHeading(slug))}](${SHAPES_URL}#${slug})` : undefined;
}

function typeCell(schema: JSONSchema, root: JSONSchema): string {
  return shapeLink(schema, root) ?? code(typeText(schema, root));
}

function rowsFor(props: Record<string, JSONSchema>, required: string[], prefix: string, root: JSONSchema, out: string[][]): void {
  // Schema property order is the zod declaration order. JS keeps string keys in insertion order,
  // so the output is byte-stable on every Node version.
  for (const [name, prop] of Object.entries(props)) {
    const field = `${prefix}${name}`;
    out.push([code(field), typeCell(prop, root), required.includes(name) ? 'yes' : 'no', resolveRef(prop, root).description ?? '', defaultCell(prop, root)]);
    descend(prop, field, root, out);
  }
}

function descend(prop: JSONSchema, field: string, root: JSONSchema, out: string[][]): void {
  if (shapeLink(prop, root)) return;
  const child = childSchema(prop, root);
  if (child.props) rowsFor(child.props, child.required, `${field}.`, root, out);
  else if (child.extra) {
    const key = `${field}.<key>`;
    out.push([code(key), typeCell(child.extra, root), 'yes', resolveRef(child.extra, root).description ?? '', defaultCell(child.extra, root)]);
    descend(child.extra, key, root, out);
  }
}

/** Rows of [field, type, required, description, default] for the fields of an object schema. Nested fields use `a.b`. */
export function schemaRows(schema: JSONSchema): string[][] {
  const out: string[][] = [];
  const child = childSchema(schema, schema);
  if (child.props) rowsFor(child.props, child.required, '', schema, out);
  return out;
}

// ---- pages ----

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function shapeHeading(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldTable(schema: JSONSchema): string {
  const rows = schemaRows(schema);
  // The Default column goes last, like the CLI options table. It is dropped when every cell is empty.
  const keep = rows.every((r) => r[4] === '') ? 4 : 5;
  return table(['Field', 'Type', 'Required', 'Description', 'Default'].slice(0, keep), rows.map((r) => r.slice(0, keep)));
}

/** The rendered Markdown parts of one MCP tool. */
export interface ToolSection {
  name: string;
  description: string;
  input: string;
  output: string;
  example: string;
}

export function toolSection(tool: Tool, shapeSlug: string | undefined, example: string | undefined): ToolSection {
  const input = schemaRows(tool.inputSchema).length > 0 ? fieldTable(tool.inputSchema) : 'This tool takes no input.';
  let output: string;
  if (!tool.outputSchema) output = 'This tool returns text content. It has no structured output.';
  else if (shapeSlug) output = `This tool returns structured output. The shape is the [${shapeHeading(shapeSlug)}](${SHAPES_URL}#${shapeSlug}).`;
  else output = fieldTable(tool.outputSchema);
  return {
    name: tool.name,
    description: tool.description ?? '',
    input,
    output,
    example: example === undefined || example.trim() === '' ? '' : demoteHeadings(example.trim()),
  };
}

export interface SharedShape { slug: string; tools: string[]; schema: JSONSchema }

/** Output shapes that two or more tools share, sorted by slug, and the shape slug of each tool that uses one. */
export function sharedShapes(tools: Tool[]): { shapes: SharedShape[]; slugByTool: Map<string, string> } {
  const groups = new Map<string, { schema: JSONSchema; tools: string[] }>();
  for (const t of [...tools].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!t.outputSchema) continue;
    const key = canonical(t.outputSchema);
    const g = groups.get(key) ?? { schema: t.outputSchema, tools: [] };
    g.tools.push(t.name);
    groups.set(key, g);
  }
  const shapes: SharedShape[] = [];
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
  return { shapes, slugByTool };
}

/** The Entry and Activity shapes, with the title of each. */
export function baseShapes(): Array<{ slug: string; schema: JSONSchema }> {
  return BASE_SHAPES;
}
