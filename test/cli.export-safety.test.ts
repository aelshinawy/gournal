import fs from 'fs';
import path from 'path';
import { runIn } from './helpers/run-cli';
import { makeTmp, rmTmp } from './helpers/tmp';

const posix = process.platform === 'win32' ? test.skip : test;
const mode = (p: string): string => (fs.statSync(p).mode & 0o777).toString(8);

describe('gournal export -o safety', () => {
  let home: string;
  let out: string;
  let oldUmask: number;
  const run = (...args: string[]) => runIn(home, args);
  const leftovers = () => fs.readdirSync(out).filter((n) => n.endsWith('.tmp'));

  beforeEach(async () => {
    oldUmask = process.umask();
    home = makeTmp('gournal-export-home-');
    out = makeTmp('gournal-export-out-');
    expect((await run('add', 'Exported thing')).status).toBe(0);
  });
  afterEach(() => {
    process.umask(oldUmask);
    rmTmp(home);
    rmTmp(out);
  });

  test('a new file is written and reported', async () => {
    const target = path.join(out, 'e.md');
    const r = await run('export', '-o', target);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`to ${target}`);
    expect(fs.readFileSync(target, 'utf8')).toContain('Exported thing');
    expect(leftovers()).toEqual([]);
  });

  test('an existing file is not overwritten without --force', async () => {
    const target = path.join(out, 'e.md');
    fs.writeFileSync(target, 'precious');
    const r = await run('export', '-o', target);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${target} already exists. Use --force to overwrite it.`);
    expect(fs.readFileSync(target, 'utf8')).toBe('precious');
    expect(leftovers()).toEqual([]);
  });

  test('--force replaces an existing file', async () => {
    const target = path.join(out, 'e.md');
    fs.writeFileSync(target, 'precious');
    const r = await run('export', '-o', target, '--force');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toContain('Exported thing');
    expect(leftovers()).toEqual([]);
  });

  posix('a symlink target is refused, with and without --force, and the link target is untouched', async () => {
    const real = path.join(out, 'real.txt');
    const link = path.join(out, 'link.md');
    fs.writeFileSync(real, 'precious');
    fs.symlinkSync(real, link);
    for (const extra of [[], ['--force']]) {
      const r = await run('export', '-o', link, ...extra);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('refusing to write through a symlink');
    }
    expect(fs.readFileSync(real, 'utf8')).toBe('precious');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  posix('a dangling symlink target is refused', async () => {
    const link = path.join(out, 'dangling.md');
    fs.symlinkSync(path.join(out, 'nowhere'), link);
    const r = await run('export', '-o', link);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing to write through a symlink');
    expect(fs.existsSync(path.join(out, 'nowhere'))).toBe(false);
  });

  test('a missing directory gets a plain message', async () => {
    const dir = path.join(out, 'nodir');
    const r = await run('export', '-o', path.join(dir, 'e.md'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`directory does not exist: ${dir}`);
    expect(r.stderr).not.toContain('ENOENT');
  });

  test('a relative -o path is written in the current folder', async () => {
    const cwd = process.cwd();
    process.chdir(out);
    try {
      const r = await run('export', '-o', 'rel.md');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('to rel.md');
      expect(fs.readFileSync(path.join(out, 'rel.md'), 'utf8')).toContain('Exported thing');
      expect(leftovers()).toEqual([]);
      const again = await run('export', '-o', 'rel.md');
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('rel.md already exists. Use --force to overwrite it.');
    } finally {
      process.chdir(cwd);
    }
  });

  test('a directory target is refused even with --force', async () => {
    const r = await run('export', '-o', out, '--force');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a regular file');
  });

  posix.each([['md'], ['csv'], ['bundle']])('the %s output file has mode 0600 under umask 022', async (format) => {
    process.umask(0o022);
    const target = path.join(out, `e.${format}`);
    expect((await run('export', '-f', format, '-o', target)).status).toBe(0);
    expect(mode(target)).toBe('600');
    // --force replaces the file and keeps it private.
    fs.chmodSync(target, 0o644);
    expect((await run('export', '-f', format, '-o', target, '--force')).status).toBe(0);
    expect(mode(target)).toBe('600');
  });

  test('the output goes to the terminal when -o is absent', async () => {
    const r = await run('export');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Exported thing');
  });
});
