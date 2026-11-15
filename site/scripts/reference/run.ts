// Entry for `npm run docs:gen`. It sets a fresh temp home before any src/ module loads,
// so no generator path reads or writes the real ~/.gournal or ~/.claude.
import fs from 'fs';
import os from 'os';
import path from 'path';

async function main(): Promise<number> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-docs-gen-'));
  process.env.GOURNAL_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GOURNAL_NO_AUTOSYNC = '1';
  try {
    // A dynamic import runs after the env is set. A static import would hoist above it.
    const { orphanExamples, writeReference } = await import('./generate');
    const siteRoot = path.resolve(__dirname, '../..');
    const examplesDir = path.join(siteRoot, 'src/content/examples');
    const orphans = await orphanExamples(examplesDir);
    if (orphans.length > 0) {
      console.error(`Example files with no matching page:\n${orphans.map((o) => `  ${o}`).join('\n')}`);
      return 1;
    }
    const { written, deleted } = await writeReference(siteRoot);
    console.log(`Wrote ${written.length} pages. Deleted ${deleted.length}.`);
    return 0;
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
