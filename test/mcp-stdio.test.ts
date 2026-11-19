import { spawn } from 'child_process';
import path from 'path';
import { makeTmp, rmTmp } from './helpers/tmp';

const ROOT = path.resolve(__dirname, '..');

const hasId2 = (line: string): boolean => {
  try {
    return JSON.parse(line).id === 2;
  } catch {
    return false;
  }
};

test('gournal mcp writes only JSON-RPC lines to stdout', async () => {
  const home = makeTmp('gournal-stdio-');
  const gournalHome = makeTmp('gournal-stdio-');
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', path.join(ROOT, 'src/cli.ts'), 'mcp'],
    { env: { ...process.env, HOME: home, USERPROFILE: home, GOURNAL_HOME: gournalHome }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  try {
    let out = '';
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8'); });
    child.stdin.on('error', () => undefined);
    const exited = new Promise<void>(resolve => child.on('close', () => resolve()));
    const gotResult = new Promise<void>(resolve => {
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.split('\n').some(hasId2)) resolve();
      });
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const early = await Promise.race([gotResult.then(() => false), exited.then(() => true)]);
    if (early) throw new Error(`gournal mcp exited before answering tools/list. stdout: ${out}\nstderr: ${err}`);
    child.stdin.end();
    await exited;

    const lines = out.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const msgs = lines.map(l => JSON.parse(l));
    for (const m of msgs) expect(m.jsonrpc).toBe('2.0');
    const list = msgs.find(m => m.id === 2);
    expect(list.result.tools).toHaveLength(12);
  } finally {
    child.kill();
    rmTmp(home);
    rmTmp(gournalHome);
  }
}, 30000);
