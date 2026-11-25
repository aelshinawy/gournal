import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { writeFakeNode } from '../helpers/fake-node';
import { renderPosixLauncher, type NodeCandidates } from '../../src/adapters/setup/launcher';
import { renderWindowsLauncher } from '../../src/adapters/setup/launcher-windows';

const posixTest = process.platform === 'win32' ? test.skip : test;
const windowsTest = process.platform === 'win32' ? test : test.skip;
const none: NodeCandidates = { files: [], globs: [], system: [] };

const roots: string[] = [];
afterAll(() => roots.forEach(rmTmp));

/** A gournal home with a copy (runtime/app-x) and a launcher, and no source record. */
function fixture(appJs: string, win = false, candidates: NodeCandidates = none) {
  const root = makeRealTmp('gournal-launcher-');
  roots.push(root);
  const home = path.join(root, 'h');
  fs.mkdirSync(path.join(home, 'runtime', 'app-x', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(home, 'bin'));
  fs.writeFileSync(path.join(home, 'runtime', 'app-x', 'dist', 'cli.js'), appJs);
  fs.writeFileSync(path.join(home, 'runtime', 'current'), 'app-x\n');
  const launcher = path.join(home, 'bin', win ? 'gournal.cmd' : 'gournal');
  const text = win ? renderWindowsLauncher({ bakeHome: false, candidates }) : renderPosixLauncher({ home, bakeHome: false, candidates });
  fs.writeFileSync(launcher, text, { mode: 0o755 });
  return { root, home, launcher, rec: path.join(home, 'runtime', 'node') };
}

const sh = (f: { root: string; launcher: string }, args: string[], pathEnv = '', shell = '/bin/sh') =>
  spawnSync(shell, [f.launcher, ...args], { env: { HOME: f.root, PATH: pathEnv }, cwd: f.root, input: '', encoding: 'utf8' });

describe('POSIX launcher', () => {
  posixTest('a gone recorded node and a node below the floor are skipped, and the working one is recorded', () => {
    const f = fixture('');
    const old = path.join(f.root, 'old', 'node');
    const good = path.join(f.root, 'new', 'node');
    writeFakeNode(old, false);
    writeFakeNode(good, true);
    fs.writeFileSync(f.rec, `${path.join(f.root, 'gone', 'node')}\n`);
    const out = sh(f, ['x'], `${path.dirname(old)}:${path.dirname(good)}`);
    expect(out.stdout).toContain(`node=${good}\n`);
    expect(fs.readFileSync(f.rec, 'utf8')).toBe(`${good}\n`);
  });

  posixTest('the installed package runs when it exists, else the copy', () => {
    const f = fixture('');
    const node = path.join(f.root, 'n', 'node');
    writeFakeNode(node, true);
    fs.writeFileSync(f.rec, `${node}\n`);
    const source = path.join(f.root, 'src');
    fs.mkdirSync(path.join(source, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(source, 'dist', 'cli.js'), '');
    fs.writeFileSync(path.join(f.home, 'runtime', 'source'), `${source}\n`);
    expect(sh(f, ['x']).stdout).toContain(`args=${path.join(source, 'dist', 'cli.js')} x\n`);
    fs.rmSync(source, { recursive: true });
    expect(sh(f, ['x']).stdout).toContain(`args=${path.join(f.home, 'runtime', 'app-x', 'dist', 'cli.js')} x\n`);
  });

  posixTest.each(['/bin/sh', '/bin/bash'])('a node that aborts in the probe is skipped without job-control text under %s', (shell) => {
    const f = fixture('');
    const bad = path.join(f.root, 'bad', 'node');
    fs.mkdirSync(path.dirname(bad));
    fs.writeFileSync(bad, '#!/bin/sh\nif [ "$1" = -e ]; then kill -ABRT $$; fi\n', { mode: 0o755 });
    const good = path.join(f.root, 'bin', 'node');
    writeFakeNode(good, true);
    fs.writeFileSync(f.rec, `${bad}\n`);
    const out = sh(f, ['hook', 'stop'], path.dirname(good), shell);
    expect([out.status, out.stderr]).toEqual([0, '']);
  });
});

describe('Windows launcher', () => {
  windowsTest('a gone recorded node.exe falls back to a candidate, and the copy runs when the source is gone', () => {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    const node = path.join(makeRealTmp('gournal-node-'), 'node.exe');
    roots.push(path.dirname(node));
    fs.copyFileSync(process.execPath, node);
    const f = fixture('process.stdout.write(JSON.stringify(process.argv.slice(2)));process.exit(3)', true, { files: [`"${node}"`], globs: [], system: [] });
    fs.writeFileSync(f.rec, `${path.join(f.root, 'gone', 'node.exe')}\r\n`);
    fs.writeFileSync(path.join(f.home, 'runtime', 'source'), `${path.join(f.root, 'gone')}\r\n`);
    const out = spawnSync(process.env.ComSpec ?? `${sys}\\System32\\cmd.exe`, ['/d', '/c', f.launcher, 'a'], {
      env: { SystemRoot: sys, USERPROFILE: f.root, PATH: `${sys}\\System32` },
      encoding: 'utf8',
    });
    expect({ status: out.status, stdout: out.stdout, stderr: out.stderr }).toEqual({ status: 3, stdout: '["a"]', stderr: '' });
    expect(fs.readFileSync(f.rec, 'utf8').trim()).toBe(node);
  });
});
