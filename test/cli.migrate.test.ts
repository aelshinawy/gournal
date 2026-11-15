import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

describe('gournal migrate', () => {
  let home: string;
  const entry = { timestamp: '2026-07-28T14:35:23.997Z', message: 'Shipped it. More text here.', project: 'tcb', tags: [] as string[] };
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/cli.ts', ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, GOURNAL_HOME: home, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });
  const summaries = () => {
    const db = new DatabaseSync(path.join(home, 'gournal.db'));
    try { return (db.prepare('SELECT summary FROM entries').all() as { summary: string }[]).map((r) => r.summary); }
    finally { db.close(); }
  };
  const writePlan = (summary: string) => {
    const p = path.join(home, 'plan.json');
    fs.writeFileSync(p, JSON.stringify({
      format: 'gournal-migration-plan', version: 1,
      items: [{ index: 0, timestamp: entry.timestamp, messageHash: crypto.createHash('sha256').update(entry.message).digest('hex'), summary }],
    }));
    return p;
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-cli-migrate-'));
    fs.writeFileSync(path.join(home, 'entries.json'), JSON.stringify([entry]));
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  test('plain migrate reports the import counts', () => {
    const r = run('migrate');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Imported 0 entries (1 already present).');
  });

  test('dry run writes the diff and leaves the database alone', () => {
    const plan = writePlan('Reviewed summary');
    const diff = path.join(home, 'd.md');
    const r = run('migrate', '--plan', plan, '--dry-run', '--diff', diff);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Dry run: 1 entries would change. Diff written to ${diff}.`);
    expect(fs.readFileSync(diff, 'utf8')).toContain('Reviewed summary');
    expect(summaries()).toEqual(['Shipped it.']);
  });

  test('dry run without a diff file fails', () => {
    const r = run('migrate', '--plan', writePlan('x'), '--dry-run');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--dry-run needs --diff <file>');
  });

  test('a real run updates the summary', () => {
    const r = run('migrate', '--plan', writePlan('Reviewed summary'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Updated 1 entries.');
    expect(summaries()).toEqual(['Reviewed summary']);
  });
});
