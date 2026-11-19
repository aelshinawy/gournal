import fs from 'fs';
import path from 'path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import type { Command } from 'commander';
import { buildProgram } from '../src/adapters/cli';
import { createServer } from '../src/adapters/mcp';

// The frozen surface: CLI command names and flags, and MCP tool names, schemas, and instructions.
// To accept an intended change, run: UPDATE_CONTRACT=1 npx jest test/contract.test.ts
const FIXTURE = path.join(__dirname, 'fixtures', 'contract', 'surface.json');

interface CliCommand { name: string; hidden: boolean; args: { name: string; required: boolean; variadic: boolean }[]; options: { flags: string; negate: boolean; mandatory: boolean; defaultValue: unknown }[] }

function cliSurface(parent: Command, prefix: string[] = []): CliCommand[] {
  return parent.commands.flatMap((cmd) => {
    const names = [...prefix, cmd.name()];
    const self: CliCommand = {
      name: names.join(' '),
      hidden: (cmd as unknown as { _hidden: boolean })._hidden === true,
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
  const instructions = client.getInstructions() ?? null;
  await client.close();
  return { instructions, tools };
}

test('the CLI and MCP surface matches the committed contract', async () => {
  const program = buildProgram({ out: () => undefined, err: () => undefined, cwd: '/', home: '/nonexistent/gournal-contract', isTTY: false });
  const surface = { cli: cliSurface(program), mcp: await mcpSurface() };
  expect(surface.cli).toHaveLength(22);
  expect(surface.mcp.tools).toHaveLength(12);
  expect(surface.mcp.instructions).not.toBeNull();
  const text = `${JSON.stringify(surface, null, 2)}\n`;
  if (process.env.UPDATE_CONTRACT === '1') {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, text);
  }
  expect(text).toBe(fs.readFileSync(FIXTURE, 'utf8'));
});
