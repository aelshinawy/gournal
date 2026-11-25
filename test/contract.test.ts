import fs from 'fs';
import path from 'path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { Command } from 'commander';
import { buildProgram } from '../src/adapters/cli';
import { createServer } from '../src/adapters/mcp';

// The frozen surface: CLI command names, arguments and flags, and MCP tool names, annotations, input fields (type, enum, default) and output field names.
// Descriptions are not pinned. The generated reference docs show them, and site.yml checks that diff.
// To accept an intended change, run: UPDATE_CONTRACT=1 npx jest test/contract.test.ts
const FIXTURE = path.join(__dirname, 'fixtures', 'contract', 'surface.json');

interface CliCommand { name: string; args: { name: string; required: boolean; variadic: boolean }[]; options: { flags: string; negate: boolean; mandatory: boolean; defaultValue: unknown }[] }

function cliSurface(parent: Command, prefix: string[] = []): CliCommand[] {
  return parent.commands.flatMap((cmd) => {
    const names = [...prefix, cmd.name()];
    const self: CliCommand = {
      name: names.join(' '),
      args: cmd.registeredArguments.map((a) => ({ name: a.name(), required: a.required, variadic: a.variadic })),
      options: cmd.options.map((o) => ({ flags: o.flags, negate: o.negate, mandatory: o.mandatory, defaultValue: o.defaultValue ?? null })),
    };
    return [self, ...cliSurface(cmd, names)];
  });
}

async function mcpSurface() {
  const server = createServer({ journal: {} as never, identity: () => ({ project: 'p', repo: null, branch: null }), processCwd: () => '/' });
  const client = new Client({ name: 'contract', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => {
    const { properties = {}, required = [] } = t.inputSchema as { properties?: Record<string, { type?: string; enum?: unknown[]; default?: unknown }>; required?: string[] };
    const inputs = Object.entries(properties).map(([name, p]) => ({ name, type: p.type ?? null, required: required.includes(name), enum: p.enum, default: p.default }));
    return { name: t.name, annotations: t.annotations ?? null, inputs, outputs: Object.keys(t.outputSchema?.properties ?? {}).sort() };
  });
}

test('the CLI and MCP surface matches the committed contract', async () => {
  const program = buildProgram({ out: () => undefined, err: () => undefined, cwd: '/', home: '/nonexistent/gournal-contract', isTTY: false });
  const surface = { cli: cliSurface(program), mcp: await mcpSurface() };
  expect(surface.cli).toHaveLength(21);
  expect(surface.mcp).toHaveLength(11);
  const text = `${JSON.stringify(surface, null, 2)}\n`;
  if (process.env.UPDATE_CONTRACT === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, text);
  }
  expect(text).toBe(fs.readFileSync(FIXTURE, 'utf8'));
});
