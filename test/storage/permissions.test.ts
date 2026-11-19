import fs from 'fs';
import path from 'path';
import { openJournal } from '../../src/storage/journal';
import { backupDbIfNeeded, snapshotDb } from '../../src/storage/backup';
import { stopHook } from '../../src/adapters/setup/hook';
import { ensurePrivateFile, tightenFile } from '../../src/storage/private-files';
import { makeTmp, rmTmp } from '../helpers/tmp';

const posix = process.platform === 'win32' ? describe.skip : describe;
const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const oct = (p: string): string => mode(p).toString(8);

let tmp: string;
let oldUmask: number;
beforeEach(() => {
  tmp = makeTmp('gournal-perm-');
  oldUmask = process.umask();
});
afterEach(() => {
  process.umask(oldUmask);
  rmTmp(tmp);
});

const addRow = (db: { prepare(sql: string): { run(...a: unknown[]): unknown } }): void => {
  db.prepare('INSERT INTO entries (id, created_at, updated_at, device_id, summary, details) VALUES (?, 1, 1, ?, ?, ?)').run('E1', 'D', 'row', null);
};

posix('file modes in a new home', () => {
  test.each([[0o022], [0o000]])('home, db, wal, shm, backups, and config are private (umask %i)', (umask) => {
    process.umask(umask);
    const home = path.join(tmp, 'new-home');
    const j = openJournal(home);
    try {
      addRow(j.db);
      backupDbIfNeeded(j.db, path.join(home, 'gournal.db'), new Date(2026, 10, 15));
      snapshotDb(j.db, path.join(home, 'gournal.db'), new Date(2026, 10, 15, 10, 0, 0));
      expect({
        home: oct(home),
        db: oct(path.join(home, 'gournal.db')),
        wal: oct(path.join(home, 'gournal.db-wal')),
        shm: oct(path.join(home, 'gournal.db-shm')),
        config: oct(path.join(home, 'config.json')),
        backups: oct(path.join(home, 'backups')),
      }).toEqual({ home: '700', db: '600', wal: '600', shm: '600', config: '600', backups: '700' });
      const files = fs.readdirSync(path.join(home, 'backups'));
      expect(files.length).toBe(2);
      for (const f of files) expect(oct(path.join(home, 'backups', f))).toBe('600');
    } finally {
      j.close();
    }
  });

  test('hook-state.json is private', async () => {
    process.umask(0o022);
    const home = path.join(tmp, 'hook-home');
    const t = path.join(tmp, 't.jsonl');
    fs.writeFileSync(t, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }) + '\n');
    const out = await stopHook(JSON.stringify({ session_id: 's1', transcript_path: t }), home, new Date());
    expect(out).not.toBeNull();
    expect(oct(path.join(home, 'hook-state.json'))).toBe('600');
    expect(oct(home)).toBe('700');
  });

  test('a custom GOURNAL_HOME that already exists keeps its mode', () => {
    process.umask(0o022);
    const home = path.join(tmp, 'shared');
    fs.mkdirSync(home, { mode: 0o755 });
    fs.chmodSync(home, 0o755);
    const j = openJournal(home);
    j.close();
    expect(oct(home)).toBe('755');
  });

  test('a custom GOURNAL_HOME keeps the mode of an existing db and backups folder', () => {
    process.umask(0o022);
    const home = path.join(tmp, 'shared');
    const j0 = openJournal(home);
    backupDbIfNeeded(j0.db, path.join(home, 'gournal.db'), new Date(2026, 10, 15));
    j0.close();
    fs.chmodSync(path.join(home, 'gournal.db'), 0o644);
    fs.chmodSync(path.join(home, 'backups'), 0o755);
    const b = path.join(home, 'backups', 'gournal-2026-11-15.db');
    fs.chmodSync(b, 0o644);
    openJournal(home).close();
    expect(oct(path.join(home, 'gournal.db'))).toBe('644');
    expect(oct(path.join(home, 'backups'))).toBe('755');
    expect(oct(b)).toBe('644');
  });
});

posix('the default home', () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GOURNAL_HOME: process.env.GOURNAL_HOME };
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
    delete process.env.GOURNAL_HOME;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  test('a fresh default home is created 0700 under umask 022', async () => {
    process.umask(0o022);
    const { gournalHome } = await import('../../src/storage/home');
    const home = gournalHome();
    expect(home).toBe(path.join(tmp, '.gournal'));
    const j = openJournal(home);
    j.close();
    expect(oct(home)).toBe('700');
    expect(oct(path.join(home, 'gournal.db'))).toBe('600');
  });

  test('an old loose default home is tightened on open', () => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    // Build the layout that an older gournal made under umask 022.
    const j0 = openJournal(home);
    addRow(j0.db);
    backupDbIfNeeded(j0.db, path.join(home, 'gournal.db'), new Date(2026, 10, 15));
    j0.close();
    const b = path.join(home, 'backups', 'gournal-2026-11-15.db');
    const loose: Array<[string, number]> = [
      [home, 0o755], [path.join(home, 'gournal.db'), 0o644], [path.join(home, 'backups'), 0o755], [b, 0o644], [path.join(home, 'config.json'), 0o644],
    ];
    for (const [p, m] of loose) fs.chmodSync(p, m);
    openJournal(home).close();
    expect(Object.fromEntries(loose.map(([p]) => [path.relative(tmp, p), oct(p)]))).toEqual({
      '.gournal': '700', '.gournal/gournal.db': '600', '.gournal/backups': '700', '.gournal/backups/gournal-2026-11-15.db': '600', '.gournal/config.json': '600',
    });
  });

  test.each(['EACCES', 'EIO'])('a %s from chmod is not hidden', (code) => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    openJournal(home).close();
    const spy = jest.spyOn(fs, 'chmodSync').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    try {
      expect(() => openJournal(home)).toThrow(code);
    } finally {
      spy.mockRestore();
    }
  });

  test.each(['ENOTSUP', 'EINVAL', 'EROFS', 'ENOENT'])('a %s from chmod does not crash the open', (code) => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    openJournal(home).close();
    const spy = jest.spyOn(fs, 'chmodSync').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    try {
      expect(() => openJournal(home).close()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  test('a file that vanishes before it is tightened is not an error (the WAL and SHM race)', () => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    fs.mkdirSync(home, { recursive: true });
    expect(() => tightenFile(path.join(home, 'gournal.db-wal'))).not.toThrow();
  });

  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (asRoot ? test.skip : test)('a read-only default home reaches the friendly message, not a raw errno', () => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    openJournal(home).close();
    for (const f of fs.readdirSync(home)) if (/-(wal|shm)$/.test(f)) fs.rmSync(path.join(home, f), { force: true });
    expect(fs.existsSync(path.join(home, 'config.json'))).toBe(true);
    fs.chmodSync(home, 0o500);
    // The default home tightens itself, so a plain 0500 folder would be made writable again. A read-only mount
    // refuses the chmod with EROFS and stays read-only. Mock that refusal on a folder that is really not writable.
    const spy = jest.spyOn(fs, 'chmodSync').mockImplementation(() => { throw Object.assign(new Error('EROFS: read-only file system, chmod'), { code: 'EROFS' }); });
    try {
      expect(() => openJournal(home)).toThrow(`gournal home ${home} is not writable. Fix its permissions or set GOURNAL_HOME.`);
    } finally {
      spy.mockRestore();
      fs.chmodSync(home, 0o700);
    }
  });

  test('a mode error does not crash the open', () => {
    process.umask(0o022);
    const home = path.join(tmp, '.gournal');
    openJournal(home).close();
    const spy = jest.spyOn(fs, 'chmodSync').mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
    try {
      expect(() => openJournal(home).close()).not.toThrow();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

posix('ensurePrivateFile', () => {
  test('it creates a missing file with mode 0600 and leaves an existing file alone', () => {
    process.umask(0o022);
    const f = path.join(tmp, 'a.db');
    ensurePrivateFile(f);
    expect(oct(f)).toBe('600');
    fs.writeFileSync(f, 'data');
    ensurePrivateFile(f);
    expect(fs.readFileSync(f, 'utf8')).toBe('data');
  });

  test('a missing folder is a real error and is not hidden', () => {
    expect(() => ensurePrivateFile(path.join(tmp, 'missing', 'a.db'))).toThrow(/ENOENT/);
  });

  test.each(['EACCES', 'EIO'])('a %s error from the create call is not hidden', (code) => {
    const spy = jest.spyOn(fs, 'openSync').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    try {
      expect(() => ensurePrivateFile(path.join(tmp, 'a.db'))).toThrow(code);
    } finally {
      spy.mockRestore();
    }
  });

  test.each(['ENOTSUP', 'EPERM', 'EINVAL', 'EROFS'])('a %s error from the create call is ignored', (code) => {
    const spy = jest.spyOn(fs, 'openSync').mockImplementation(() => { throw Object.assign(new Error(code), { code }); });
    try {
      expect(() => ensurePrivateFile(path.join(tmp, 'a.db'))).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
