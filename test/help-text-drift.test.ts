import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Command, Option } from 'commander';
import { buildProgram } from '../src/adapters/cli';
import { createServer } from '../src/adapters/mcp';
import { EXPORT_FORMATS, KINDS, STATUSES } from '../src/core';
import { OPTION_TEXT } from '../src/core/option-text';

interface Schema { type?: string; description?: string; enum?: string[]; default?: unknown; items?: Schema; properties?: Record<string, Schema> }
interface Tool { name: string; description?: string; inputSchema: Schema }

/** The program build never opens a journal, so the home path is never used. */
const program = buildProgram({ out: () => undefined, err: () => undefined, cwd: '/', home: '/nonexistent/gournal-drift', isTTY: false });

let tools: Tool[];
beforeAll(async () => {
  const server = createServer({ journal: {} as never, identity: () => ({ project: 'p', repo: null, branch: null }), processCwd: () => '/' });
  const client = new Client({ name: 'drift', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  tools = (await client.listTools()).tools as Tool[];
});

function leaves(parent: Command, prefix: string[] = []): { name: string; cmd: Command }[] {
  return parent.commands.flatMap((cmd) => {
    const names = [...prefix, cmd.name()];
    return cmd.commands.length > 0 ? leaves(cmd, names) : [{ name: names.join(' '), cmd }];
  });
}

interface Field { where: string; field: string; text: string; schema?: Schema; option?: Option }

const cliFields = (): Field[] =>
  leaves(program).flatMap(({ name, cmd }) =>
    cmd.options.map((option) => ({
      where: `gournal ${name}`, field: option.long?.replace(/^--/, '') ?? option.short ?? '', text: option.description, option,
    })));

const mcpFields = (): Field[] =>
  tools.flatMap((tool) =>
    Object.entries(tool.inputSchema.properties ?? {}).map(([field, schema]) => ({
      where: tool.name, field, text: schema.description ?? '', schema,
    })));

const words = (text: string): Set<string> => new Set(text.match(/[a-z]+/g) ?? []);
const named = (text: string, vocab: readonly string[]): string[] => vocab.filter((w) => words(text).has(w)).sort();

const VOCAB: Record<string, readonly string[]> = { kind: KINDS, status: STATUSES, format: EXPORT_FORMATS };

test('enum lists in help text match the code', () => {
  const checked: string[] = [];
  for (const f of [...cliFields(), ...mcpFields()]) {
    const vocab = VOCAB[f.field];
    if (!vocab) continue;
    // The MCP export tool has no bundle format. Its own enum is the truth there.
    const expected = f.schema ? (f.schema.items?.enum ?? f.schema.enum ?? [...vocab]) : [...vocab];
    expect({ at: `${f.where} ${f.field}`, named: named(f.text, vocab) }).toEqual({ at: `${f.where} ${f.field}`, named: [...expected].sort() });
    checked.push(`${f.where} ${f.field}`);
  }
  expect(checked.length).toBeGreaterThanOrEqual(8);
  const mcpKind = mcpFields().filter((f) => f.field === 'kind').map((f) => f.schema?.items?.enum ?? f.schema?.enum);
  for (const e of mcpKind) expect(e).toEqual([...KINDS]);
});

test('stated defaults match real defaults', () => {
  let claims = 0;
  for (const f of cliFields()) {
    if (!/\(default\)|Default:/.test(f.text)) continue;
    claims++;
    const real = f.option?.defaultValueDescription ?? f.option?.defaultValue;
    expect({ at: `${f.where} ${f.field}`, real }).not.toEqual({ at: `${f.where} ${f.field}`, real: undefined });
    const stated = /(\w+) \(default\)/.exec(f.text)?.[1];
    if (stated) expect(String(real)).toBe(stated);
  }
  for (const f of mcpFields()) {
    if (!/\(default\)|Default:/.test(f.text)) continue;
    claims++;
    expect({ at: `${f.where} ${f.field}`, real: f.schema?.default }).not.toEqual({ at: `${f.where} ${f.field}`, real: undefined });
    const stated = /(\w+) \(default\)/.exec(f.text)?.[1];
    if (stated) expect(String(f.schema?.default)).toBe(stated);
  }
  expect(claims).toBeGreaterThanOrEqual(2);
});

test('CLI and MCP date wording match', () => {
  const cliCommands = ['log', 'standup', 'find', 'export'];
  const mcpTools = ['list_entries', 'find_entries', 'export_entries', 'get_standup', 'get_work_log'];
  for (const name of cliCommands) {
    const cmd = program.commands.find((c) => c.name() === name)!;
    for (const key of ['from', 'to'] as const) {
      expect(cmd.options.find((o) => o.long === `--${key}`)?.description).toBe(OPTION_TEXT[key]);
    }
  }
  for (const name of mcpTools) {
    const tool = tools.find((t) => t.name === name)!;
    for (const key of ['from', 'to'] as const) {
      expect(tool.inputSchema.properties?.[key]?.description).toBe(OPTION_TEXT[key]);
    }
  }
});
