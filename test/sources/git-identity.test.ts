import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
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
