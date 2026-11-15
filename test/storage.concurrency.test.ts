import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { readEntries } from '../src/storage';

const fixture = path.join(__dirname, 'fixtures', 'concurrent-writer.ts');

function runWriter(file: string, id: number, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', fixture, file, String(id), String(count)],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('exit', code =>
      code === 0 ? resolve() : reject(new Error(`writer ${id} exited with ${code}: ${stderr}`))
    );
  });
}

async function runWriters(file: string, writers: number, count: number): Promise<void> {
  await Promise.all(Array.from({ length: writers }, (_, id) => runWriter(file, id, count)));
}

describe('concurrent writers', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-'));
    file = path.join(dir, 'entries.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('no entry is lost under concurrent writers', async () => {
    await runWriters(file, 8, 25);
    const entries = await readEntries(file);
    expect(entries).toHaveLength(200);
    expect(new Set(entries.map(e => e.message)).size).toBe(200);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  }, 60_000);
});
