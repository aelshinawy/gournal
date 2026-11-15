import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { runIn } from './helpers/run-cli';

describe('gournal migrate', () => {
  let home: string;
  const entry = { timestamp: '2026-07-28T14:35:23.997Z', message: 'Shipped it. More text here.', project: 'tcb', tags: [] as string[] };
  const run = (...args: string[]) => runIn(home, args);
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

  test('plain migrate reports the import counts', async () => {
    const r = await run('migrate');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Imported 0 entries (1 already present).');
  });

  test('dry run writes the diff and leaves the database alone', async () => {
    const plan = writePlan('Reviewed summary');
    const diff = path.join(home, 'd.md');
    const r = await run('migrate', '--plan', plan, '--dry-run', '--diff', diff);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Dry run: 1 entries would change. Diff written to ${diff}.`);
    expect(fs.readFileSync(diff, 'utf8')).toContain('Reviewed summary');
    expect(summaries()).toEqual(['Shipped it.']);
  });

  test('dry run without a diff file fails', async () => {
    const r = await run('migrate', '--plan', writePlan('x'), '--dry-run');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--dry-run needs --diff <file>');
  });

  test('flag combinations are checked', async () => {
    const diff = await run('migrate', '--diff', path.join(home, 'd.md'));
    expect(diff.status).toBe(1);
    expect(diff.stderr).toContain('--diff only applies with --dry-run');
    const noPlan = await run('migrate', '--dry-run', '--diff', path.join(home, 'd.md'));
    expect(noPlan.status).toBe(1);
    expect(noPlan.stderr).toContain('--dry-run needs --plan <file>');
  });

  test('a plan file that is not JSON fails cleanly', async () => {
    const p = path.join(home, 'bad.json');
    fs.writeFileSync(p, '{nope');
    const r = await run('migrate', '--plan', p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`Plan file ${p} is not valid JSON:`);
  });

  test('a failed diff write leaves no temp file', async () => {
    const r = await run('migrate', '--plan', writePlan('x'), '--dry-run', '--diff', path.join(home, 'nodir', 'd.md'));
    expect(r.status).toBe(1);
    expect(fs.readdirSync(home).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  test('a real run updates the summary', async () => {
    const r = await run('migrate', '--plan', writePlan('Reviewed summary'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Updated 1 entries.');
    expect(r.stdout).toMatch(new RegExp(`Snapshot: ${fs.realpathSync(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/backups/gournal-pre-plan-\\d{8}-\\d{6}(-\\d+)?\\.db`));
    expect(summaries()).toEqual(['Reviewed summary']);
  });

  test('a plan that would lose text fails through the single printer and writes nothing', async () => {
    const p = path.join(home, 'lose.json');
    fs.writeFileSync(p, JSON.stringify({
      format: 'gournal-migration-plan', version: 1,
      items: [{ index: 0, timestamp: entry.timestamp, messageHash: crypto.createHash('sha256').update(entry.message).digest('hex'), summary: 'Short', details: 'unrelated' }],
    }));
    const r = await run('migrate', '--plan', p);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Plan item 0 would lose text: summary plus details must contain the original message');
    expect(r.stdout).toBe('');
    expect(summaries()).toEqual(['Shipped it.']);
  });

  test('a plan summary with a newline is rejected', async () => {
    const r = await run('migrate', '--plan', writePlan('Line one\nLine two'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Plan item 0 summary must be one line, max 120. Put the rest in details.');
  });
});
