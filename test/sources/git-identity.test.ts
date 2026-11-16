import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { resolveIdentity } from '../../src/sources';

const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', [...GIT, '-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

let base: string;
beforeEach(() => { base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-git-'))); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

function makeRepo(name: string, origin: string | null = 'git@github.com:acme/collection-app.git'): string {
  const dir = path.join(base, name);
  fs.mkdirSync(dir);
  git(dir, 'init');
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'commit', '--allow-empty', '-m', 'init');
  return dir;
}

test('a repo resolves project, repo, and branch', () => {
  const dir = makeRepo('collection-app');
  expect(resolveIdentity(dir, {})).toEqual({ project: 'collection-app', repo: 'acme/collection-app', branch: 'main' });
});

test('a subfolder of a repo resolves to the repo', () => {
  const dir = makeRepo('collection-app');
  fs.mkdirSync(path.join(dir, 'sub'));
  expect(resolveIdentity(path.join(dir, 'sub'), {}).repo).toBe('acme/collection-app');
});

test('a worktree resolves to the main repo', () => {
  const dir = makeRepo('collection-app');
  const wt = path.join(base, 'wt');
  git(dir, 'worktree', 'add', wt, '-b', 'lane-b');
  expect(resolveIdentity(wt, {})).toEqual({ project: 'collection-app', repo: 'acme/collection-app', branch: 'lane-b' });
});

test('a folder that differs from the remote name resolves to the remote name', () => {
  const dir = makeRepo('local-checkout', 'git@github.com:acme/collection-app.git');
  expect(resolveIdentity(dir, {}).project).toBe('collection-app');
});

test('detached HEAD has no branch', () => {
  const dir = makeRepo('collection-app');
  git(dir, 'checkout', '--detach');
  expect(resolveIdentity(dir, {})).toEqual({ project: 'collection-app', repo: 'acme/collection-app', branch: null });
});

test('a repo without origin uses the folder name and keeps the branch', () => {
  const dir = makeRepo('scratch', null);
  expect(resolveIdentity(dir, {})).toEqual({ project: 'scratch', repo: null, branch: 'main' });
});

test('aliases apply', () => {
  const dir = makeRepo('collection-app');
  expect(resolveIdentity(dir, { 'acme/collection-app': 'Collection' }).project).toBe('Collection');
});

test('a folder outside git is uncategorized', () => {
  const dir = path.join(base, 'plain');
  fs.mkdirSync(dir);
  const old = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = base;
  try {
    expect(resolveIdentity(dir, {})).toEqual({ project: 'uncategorized', repo: null, branch: null });
  } finally {
    if (old === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = old;
  }
});

test('a missing folder is uncategorized', () => {
  expect(resolveIdentity('/no/such/dir', {}).project).toBe('uncategorized');
});

test('an empty repo with no commits still resolves the folder', () => {
  const dir = path.join(base, 'fresh');
  fs.mkdirSync(dir);
  git(dir, 'init');
  expect(resolveIdentity(dir, {})).toEqual({ project: 'fresh', repo: null, branch: 'main' });
});

test('a path with spaces and unicode resolves to the folder name', () => {
  const dir = makeRepo('mi proyecto \u00e9\u00e8 \u65e5\u672c', null);
  expect(resolveIdentity(dir, {}).project).toBe('mi proyecto \u00e9\u00e8 \u65e5\u672c');
});

// Git older than 2.31 does not know --path-format. It prints the unknown flag as the first output line.
// The shim emulates that: it prints each --path-format argument back, then runs the real git without it.
const shimTest = process.platform === 'win32' ? test.skip : test;
shimTest('old git that echoes --path-format does not produce a project that starts with --', () => {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const shimDir = path.join(base, 'shim');
  fs.mkdirSync(shimDir);
  // Old git prints the unknown flag, then relative paths. The shim strips the flag before it calls real git.
  fs.writeFileSync(
    path.join(shimDir, 'git'),
    `#!/bin/sh
for a in "$@"; do
  case "$a" in
    --path-format=*) echo "$a" ;;
  esac
done
for a in "$@"; do
  case "$a" in
    --path-format=*) ;;
    *) set -- "$@" "$a" ;;
  esac
  shift
done
exec "${realGit}" "$@"
`,
    { mode: 0o755 },
  );
  // No origin: the project comes from the folder name, which is where the bug shows.
  const dir = makeRepo('scratch', null);
  // Jest gives tests a copy of process.env that child processes do not see. Run the resolver in a child with the shim on PATH.
  const root = path.join(__dirname, '..', '..');
  const script = `const { resolveIdentity } = require(${JSON.stringify(path.join(root, 'src', 'sources'))});
    process.stdout.write(JSON.stringify(resolveIdentity(${JSON.stringify(dir)}, {})));`;
  const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', script], {
    cwd: root,
    env: { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8',
  });
  expect(r.status).toBe(0);
  const id = JSON.parse(r.stdout);
  expect(id.project.startsWith('--')).toBe(false);
  expect(id).toEqual({ project: 'scratch', repo: null, branch: 'main' });
});
