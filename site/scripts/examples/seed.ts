// Fill a temp gournal home with the one journal state that every docs example uses.
// Usage: node -r ts-node/register/transpile-only site/scripts/examples/seed.ts <dir>
// Set HOME and GOURNAL_HOME to <dir> before you run a command against it.
// The data is synthetic. The owner `acme` is fake.
// Entry ids are random ULIDs. The counts below are fixed, and the example test checks them.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openJournal } from '../../../src/storage';

const dir = process.argv[2];
if (!dir) {
  process.stderr.write('usage: seed.ts <dir>\n');
  process.exit(2);
}
const home = path.resolve(dir);
const realHome = os.userInfo().homedir;
if (home === path.join(realHome, '.gournal') || home === realHome) {
  process.stderr.write(`seed: refusing to write to ${home}\n`);
  process.exit(2);
}
if (fs.existsSync(path.join(home, 'gournal.db'))) {
  process.stderr.write(`seed: ${home} already has a journal\n`);
  process.exit(2);
}

fs.mkdirSync(home, { recursive: true });
fs.writeFileSync(
  path.join(home, 'config.json'),
  JSON.stringify({ github: { owners: { include: ['acme', 'octo'], exclude: [] } } }, null, 2) + '\n',
);

// A clone of acme/billing-api. A command that runs here logs to the billing-api project.
const repoDir = path.join(home, 'dev', 'billing-api');
fs.mkdirSync(repoDir, { recursive: true });
const git = (...args: string[]): void => {
  execFileSync('git', ['-C', repoDir, ...args], { stdio: 'ignore' });
};
git('init', '-q', '-b', 'fix/invoice-rounding');
git('remote', 'add', 'origin', 'https://github.com/acme/billing-api.git');

const journal = openJournal(home);
try {
  const { repo } = journal;
  const billing = { project: 'billing-api', repo: 'acme/billing-api', branch: 'fix/invoice-rounding', source: 'mcp' as const };
  const worker = { project: 'worker', repo: 'acme/worker', branch: 'main', source: 'mcp' as const };

  // billing-api: 5 entries. Tags: review 2, ui 1, docs 1.
  repo.add({ ...billing, summary: 'Fix rounding error in invoice totals', tags: ['review'],
    details: 'Totals were off by one cent when a discount applied after tax.' });
  repo.add({ ...billing, summary: 'Add keyboard focus styles to the invoice date picker', tags: ['ui'] });
  repo.add({ ...billing, summary: 'Document the invoice export endpoint', tags: ['docs'] });
  // worker: 3 entries. Tags: ui 2, docs 1, review 1.
  repo.add({ ...worker, summary: 'Move the settings page to the new form components', tags: ['ui'] });
  repo.add({ ...worker, summary: 'Document the retry policy for webhooks', tags: ['docs'] });
  repo.add({ ...worker, summary: 'Review the queue backoff change', tags: ['review', 'ui'] });
  // One open blocker and one open next item, both in billing-api.
  repo.add({ ...billing, summary: 'Cannot reproduce the failing webhook retry in staging', kind: 'blocker' });
  repo.add({ ...billing, summary: 'Add a regression test for tax rounding', kind: 'next', tags: ['review'] });
} finally {
  journal.close();
}
process.stdout.write(`seed: wrote the example journal to ${home}\n`);
