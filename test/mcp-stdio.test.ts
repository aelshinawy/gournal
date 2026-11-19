import { spawn } from 'child_process';
import path from 'path';
import { makeTmp, rmTmp } from './helpers/tmp';

const ROOT = path.resolve(__dirname, '..');

test('gournal mcp writes only JSON-RPC lines to stdout', async () => {
  const home = makeTmp('gournal-stdio-');
  const gournalHome = makeTmp('gournal-stdio-');
  try {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', path.join(ROOT, 'src/cli.ts'), 'mcp'],
      { env: { ...process.env, HOME: home, USERPROFILE: home, GOURNAL_HOME: gournalHome }, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let out = '';
    const exited = new Promise<void>(resolve => child.on('close', () => resolve()));
    const gotResult = new Promise<void>(resolve => {
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.split('\n').some(l => l.includes('"id":2'))) resolve();
      });
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await gotResult;
    child.stdin.end();
    await exited;

    const lines = out.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const msgs = lines.map(l => JSON.parse(l));
    for (const m of msgs) expect(m.jsonrpc).toBe('2.0');
    const list = msgs.find(m => m.id === 2);
    expect(list.result.tools).toHaveLength(12);
  } finally {
    rmTmp(home);
    rmTmp(gournalHome);
  }
}, 30000);
