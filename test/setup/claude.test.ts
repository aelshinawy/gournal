import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupClaude, SKILL_MD, SKILL_MARKER, type SetupIo, type CommandRunner } from '../../src/adapters/setup';
import { shellQuote, displayQuote } from '../../src/adapters/setup/command';
import { createExecFileRunner, buildCmdLine, type ExecOnce } from '../../src/adapters/setup/runner';
import { addStopHook, removeStopHook, isGournalHook } from '../../src/adapters/setup/settings';
import { VERSION } from '../../src/adapters/version';
import { runIn } from '../helpers/run-cli';
import { makeHarness, type Harness } from '../helpers/setup-harness';
import { canSymlink } from '../helpers/symlink';
import { makeRealTmp, rmTmp } from '../helpers/tmp';

// Windows needs a privilege to create a symlink. A test that needs one skips without it.
const symlinkTest = canSymlink() ? test : test.skip;

let h: Harness;
let root: string;
let home: string;
let gh: string;
let pkg: string;
let calls: string[][];
let out: string[];
let err: string[];
let confirmAnswers: Array<[string, boolean]>;
let checks: string[][];

const fakeExec = (code = 0): CommandRunner => h.fakeExec(code);
const makeIo: Harness['makeIo'] = (over) => h.makeIo(over);
const run: Harness['run'] = (opts, io) => h.run(opts, io);
const settingsFile = () => h.settingsFile();
const skillFile = () => h.skillFile();
const writeSettings = (v: unknown) => h.writeSettings(v);
const readSettings = () => h.readSettings();
const stopCommands: Harness['stopCommands'] = (s) => h.stopCommands(s);

const LAUNCHER = () => path.join(h.gh, 'bin', 'gournal');
const HOOK = () => `${shellQuote(LAUNCHER())} hook stop`;
const CMD_EXE = 'C:\\Windows\\System32\\cmd.exe';

beforeEach(() => {
  root = makeRealTmp('gournal-setup-');
  h = makeHarness(root);
  ({ home, gh, pkg, calls, out, err, confirmAnswers, checks } = h);
});
afterEach(() => rmTmp(root));

test('tests run inside the temp HOME', () => {
  expect(process.env.HOME).toBe(process.env.GOURNAL_TEST_HOME_ROOT);
  expect(home.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
});

test('setup registers MCP, installs the skill, and leaves the hook off by default', async () => {
  writeSettings({ model: 'x' });
  const before = fs.readFileSync(settingsFile(), 'utf8');
  expect(await run()).toBe(0);
  expect(calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', LAUNCHER(), 'mcp']]);
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before);
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(false);
});

test('setup is idempotent', async () => {
  writeSettings({});
  await run({ hook: true });
  calls.length = 0; out.length = 0;
  const skillMtime = fs.statSync(skillFile()).mtimeMs;
  const settingsBytes = fs.readFileSync(settingsFile(), 'utf8');
  expect(await run({ hook: true })).toBe(0);
  expect(calls).toEqual([]);
  expect(fs.statSync(skillFile()).mtimeMs).toBe(skillMtime);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(settingsBytes);
  expect(out.filter((l) => l.includes('already set up'))).toHaveLength(4);
  expect(out).toContain('Stop hook: already set up.');
  expect(out).not.toContain('Stop hook: added.');
});

test('existing different registration is replaced only on yes', async () => {
  h.writeReg({ command: '/opt/tools/run-gournal', args: ['serve'] });
  expect(await run({}, makeIo({ answer: false }))).toBe(0);
  expect(calls).toEqual([]);
  expect(confirmAnswers.some(([m, d]) => m.includes('Replace') && d === false)).toBe(true);
  expect(await run({}, makeIo({ answer: true }))).toBe(0);
  expect(calls.map((c) => c[2])).toEqual(['remove', 'add']);
  expect(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.gournal.command).toBe(LAUNCHER());
});

test('setup keeps other settings and hooks', async () => {
  const original = {
    model: 'opus',
    permissions: { allow: ['Bash(ls)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'afplay done.wav' }] }], PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
  };
  writeSettings(original);
  await run({ hook: true });
  const added = readSettings();
  expect(added.model).toBe('opus');
  expect(added.permissions).toEqual(original.permissions);
  expect(added.hooks.Stop[0]).toEqual(original.hooks.Stop[0]);
  expect(added.hooks.Stop).toHaveLength(2);
  expect(added.hooks.Stop[1].hooks[0]).toEqual({ type: 'command', command: HOOK() });
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(true);
  await run({ uninstall: true });
  expect(readSettings()).toEqual(original);
});

test('uninstall restores a settings file that had no hooks key', async () => {
  writeSettings({ model: 'x' });
  await run({ hook: true });
  await run({ uninstall: true });
  expect(readSettings()).toEqual({ model: 'x' });
});

test('settings.json is created with only hooks when missing', async () => {
  await run({ hook: true });
  expect(readSettings()).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: HOOK() }] }] } });
});

test('invalid settings.json is never changed', async () => {
  writeSettings('{ not json');
  expect(await run({ hook: true })).toBe(1);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe('{ not json');
  expect(err.join('\n')).toContain(settingsFile());
  expect(calls).toHaveLength(1);
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
  err.length = 0;
  expect(await run({ uninstall: true })).toBe(1);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe('{ not json');
  expect(err.join('\n')).toContain(settingsFile());
});

test('uninstall removes only gournal items', async () => {
  await run({ hook: true });
  expect(await run({ uninstall: true })).toBe(0);
  expect(fs.existsSync(skillFile())).toBe(false);
  expect(fs.existsSync(path.dirname(skillFile()))).toBe(false);
  expect(calls.at(-1)).toEqual(['claude', 'mcp', 'remove', '--scope', 'user', 'gournal']);

  fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
  fs.writeFileSync(skillFile(), '# my own skill\n');
  expect(await run({ uninstall: true })).toBe(0);
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe('# my own skill\n');
});

test('setup does not overwrite a skill file that gournal did not write', async () => {
  fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
  fs.writeFileSync(skillFile(), '# mine\n');
  await run();
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe('# mine\n');
});

test('setup updates an old managed skill', async () => {
  fs.mkdirSync(path.dirname(skillFile()), { recursive: true });
  fs.writeFileSync(skillFile(), `old\n${SKILL_MARKER}\n`);
  await run();
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
});

test('non-TTY without --yes prints the plan and exits 1', async () => {
  const io = makeIo({ isTTY: false });
  expect(await setupClaude(io, { uninstall: false, yes: false, hook: false })).toBe(1);
  expect(out.join('\n')).toContain(`claude mcp add --scope user gournal -- ${shellQuote(LAUNCHER())} mcp`);
  expect(calls).toEqual([]);
  expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  expect(err.join('\n')).toContain('--yes');
});

test('interactive: the hook prompt defaults to no and MCP and skill default to yes', async () => {
  const io = makeIo({ answer: undefined });
  io.confirm = async (m, d) => { confirmAnswers.push([m, d]); return d; };
  await setupClaude(io, { uninstall: false, yes: false, hook: false });
  const byTopic = (w: string) => confirmAnswers.find(([m]) => m.includes(w));
  expect(byTopic('MCP')?.[1]).toBe(true);
  expect(byTopic('skill')?.[1]).toBe(true);
  expect(byTopic('Stop hook')?.[1]).toBe(false);
  expect(fs.existsSync(settingsFile())).toBe(false);
  expect(fs.existsSync(skillFile())).toBe(true);
});

test('--yes without --hook does not touch settings', async () => {
  await run();
  expect(fs.existsSync(settingsFile())).toBe(false);
  expect(out.join('\n')).toContain('--hook');
});

test('claude CLI missing prints the manual command, still installs the skill, and exits 1', async () => {
  expect(await run({}, makeIo({ exec: fakeExec(127) }))).toBe(1);
  expect(out.join('\n')).toContain(`claude mcp add --scope user gournal -- ${shellQuote(LAUNCHER())} mcp`);
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
});

test('a failing claude CLI gives exit 1 with its message', async () => {
  expect(await run({}, makeIo({ exec: fakeExec(2) }))).toBe(1);
  expect(err.join('\n')).toContain('boom');
});

test('settings helpers', () => {
  expect(isGournalHook('gournal hook stop')).toBe(true);
  expect(isGournalHook('/x/node /y/gournal/dist/cli.js hook stop')).toBe(true);
  expect(isGournalHook('afplay done.wav')).toBe(false);
  expect(isGournalHook('other hook stop')).toBe(false);
  const a = addStopHook({}, 'gournal hook stop');
  expect(a.changed).toBe(true);
  expect(addStopHook(a.next, 'gournal hook stop').changed).toBe(false);
  expect(removeStopHook({ a: 1 }).changed).toBe(false);
});

test('the setup claude command is wired into the CLI (non-TTY without --yes exits 1)', async () => {
  const r = await runIn(path.join(root, 'gh'), ['setup', 'claude'], { isTTY: false });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('--yes');
  expect(fs.existsSync(path.join(os.homedir(), '.claude'))).toBe(false);
});

// A different registration, a pinned hook, a failed removal, and the settings backup

const differentReg = () => h.writeReg({ command: 'node', args: ['/old/cli.js', 'mcp'] });

test('non-TTY with --yes keeps a different registration without prompting', async () => {
  differentReg();
  const io = makeIo({ isTTY: false, answer: true });
  expect(await run({}, io)).toBe(0);
  expect(calls).toEqual([]);
  expect(confirmAnswers).toEqual([]);
  expect(out).toContain('MCP server: kept the existing registration. Run setup in a terminal to replace it.');
});

test('a failed removal of the old registration exits 1', async () => {
  differentReg();
  expect(await run({}, makeIo({ answer: true, exec: fakeExec(2) }))).toBe(1);
  expect(err.join('\n')).toContain('boom');
});

test('add failing after a good removal prints the old command', async () => {
  differentReg();
  const base = fakeExec();
  const exec: CommandRunner = async (file, args) =>
    args[1] === 'add' ? (calls.push([file, ...args]), { code: 2, stdout: '', stderr: 'boom' }) : base(file, args);
  expect(await run({}, makeIo({ answer: true, exec }))).toBe(1);
  expect(out.join('\n')).toContain('claude mcp add --scope user gournal -- node /old/cli.js mcp');
});

test('the first settings backup is kept and uninstall names it', async () => {
  writeSettings({ model: 'pristine' });
  const pristine = fs.readFileSync(settingsFile(), 'utf8');
  await run({ hook: true });
  out.length = 0;
  await run({ uninstall: true });
  expect(fs.readFileSync(`${settingsFile()}.gournal-backup`, 'utf8')).toBe(pristine);
  expect(out.join('\n')).toContain(`${settingsFile()}.gournal-backup`);
});

test('uninstall does not claim a backup when settings.json did not exist at install', async () => {
  await run({ hook: true });
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(false);
  out.length = 0;
  await run({ uninstall: true });
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(false);
  expect(out.join('\n')).not.toMatch(/backup|original file/i);
  expect(out.join('\n')).toContain('Stop hook: removed.');
});

test('uninstall names the backup that install took before its first write', async () => {
  writeSettings({ model: 'pristine' });
  await run({ hook: true });
  out.length = 0;
  await run({ uninstall: true });
  expect(out.join('\n')).toContain(`The original file is kept at ${settingsFile()}.gournal-backup`);
});

symlinkTest('a symlinked settings.json stays a link, the target holds the hook, and the mode is kept', async () => {
  const dotfiles = path.join(home, 'dotfiles');
  fs.mkdirSync(dotfiles, { recursive: true });
  const target = path.join(dotfiles, 'settings.json');
  fs.writeFileSync(target, JSON.stringify({ model: 'x' }));
  fs.chmodSync(target, 0o600);
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.symlinkSync(target, settingsFile());
  await run({ hook: true });
  expect(fs.lstatSync(settingsFile()).isSymbolicLink()).toBe(true);
  expect(fs.realpathSync(settingsFile())).toBe(fs.realpathSync(target));
  const stored = JSON.parse(fs.readFileSync(target, 'utf8'));
  expect(stored.model).toBe('x');
  expect(stored.hooks.Stop[0].hooks[0].command).toBe(HOOK());
  // Windows has no POSIX mode bits.
  if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(dotfiles).filter((n) => n.endsWith('.tmp'))).toEqual([]);
});

// Windows has no POSIX mode bits.
const posixTest = process.platform === 'win32' ? test.skip : test;

posixTest('an existing settings.json keeps a 0640 mode', async () => {
  const old = process.umask(0o022);
  try {
    writeSettings({ model: 'x' });
    fs.chmodSync(settingsFile(), 0o640);
    await run({ hook: true });
    expect(fs.statSync(settingsFile()).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(path.dirname(settingsFile())).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  } finally {
    process.umask(old);
  }
});

posixTest('a new settings.json gets the default file mode', async () => {
  const old = process.umask(0o022);
  try {
    expect(fs.existsSync(settingsFile())).toBe(false);
    await run({ hook: true });
    expect(fs.statSync(settingsFile()).mode & 0o777).toBe(0o644);
  } finally {
    process.umask(old);
  }
});

posixTest('the temp file for an existing settings.json is never readable by others', async () => {
  const old = process.umask(0o022);
  const realWrite = fs.writeFileSync;
  const modes: number[] = [];
  const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    const result = (realWrite as (...a: unknown[]) => void)(file, ...rest);
    if (typeof file === 'string' && file.endsWith('.tmp') && path.dirname(file) === path.dirname(settingsFile())) {
      modes.push(fs.statSync(file).mode & 0o777);
    }
    return result;
  }) as typeof fs.writeFileSync);
  try {
    writeSettings({});
    fs.chmodSync(settingsFile(), 0o600);
    await run({ hook: true });
    expect(modes).toEqual([0o600]);
    expect(fs.statSync(settingsFile()).mode & 0o777).toBe(0o600);
  } finally {
    spy.mockRestore();
    process.umask(old);
  }
});

// Foreign hooks (F4)

const FOREIGN = '/opt/my-gournal-notes/bin hook stop';
const foreignSettings = () => ({
  model: 'opus',
  hooks: { Stop: [{ hooks: [{ type: 'command', command: FOREIGN }] }], PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
});

test('isGournalHook recognizes only the shapes that setup writes', () => {
  expect(isGournalHook('gournal hook stop')).toBe(true);
  expect(isGournalHook('/usr/local/bin/node /usr/lib/gournal/dist/cli.js hook stop')).toBe(true);
  expect(isGournalHook('node /x/gournal/cli.js hook stop')).toBe(true);
  expect(isGournalHook('C:\\nodejs\\node.exe C:\\app\\cli.js hook stop')).toBe(false);
  expect(isGournalHook(`'C:\\Program Files\\nodejs\\node.exe' 'C:\\gournal\\cli.js' hook stop`)).toBe(true);
  expect(isGournalHook(`/opt/node/bin/node '/my lib/it's here/cli.js' hook stop`)).toBe(false);
  expect(isGournalHook(`/opt/node/bin/node '/my lib/gournal/it'\\''s here/cli.js' hook stop`)).toBe(true);
  expect(isGournalHook(`'/my node/node' '/my lib/gournal/cli.js' hook stop`)).toBe(true);
  // Foreign commands
  expect(isGournalHook(FOREIGN)).toBe(false);
  expect(isGournalHook('/opt/gournal/bin/run hook stop')).toBe(false);
  expect(isGournalHook('/opt/gournal/node /x/gournal.js hook stop')).toBe(false);
  expect(isGournalHook('/usr/bin/python /x/cli.js hook stop')).toBe(false);
  expect(isGournalHook('node /x/cli.js hook stop extra')).toBe(false);
  expect(isGournalHook('gournal hook stop; rm -rf x')).toBe(false);
  expect(isGournalHook('gournal hook stop && gournal')).toBe(false);
  expect(isGournalHook('echo gournal hook stop')).toBe(false);
  expect(isGournalHook('gournal hook stop ')).toBe(true);
  // The current command always counts.
  expect(isGournalHook('/opt/node/bin/node /srv/app/run.js hook stop', '/opt/node/bin/node /srv/app/run.js hook stop')).toBe(true);
});

test('a foreign hook whose path contains "gournal" survives install and uninstall unchanged', async () => {
  writeSettings(foreignSettings());
  expect(await run({ hook: true })).toBe(0);
  const added = readSettings();
  expect(stopCommands(added)).toEqual([FOREIGN, HOOK()]);
  expect(added.hooks.Stop[0]).toEqual(foreignSettings().hooks.Stop[0]);
  expect(out).toContain('Stop hook: added.');
  expect(await run({ uninstall: true })).toBe(0);
  expect(readSettings()).toEqual(foreignSettings());
});

test('uninstall leaves a foreign hook alone and says the gournal hook is not set up', async () => {
  writeSettings(foreignSettings());
  const before = fs.readFileSync(settingsFile(), 'utf8');
  expect(await run({ uninstall: true })).toBe(0);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before);
  expect(out).toContain('Stop hook: not set up.');
});

test('both gournal shapes from earlier versions are recognized and updated, never duplicated', async () => {
  const pinned = `/old/node/bin/node '/old lib/gournal/dist/cli.js' hook stop`;
  writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: pinned }] }] } });
  expect(await run({ hook: true })).toBe(0);
  expect(stopCommands(readSettings())).toEqual([HOOK()]);
  expect(out).toContain('Stop hook: updated.');

  writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
  out.length = 0;
  await run({ hook: true });
  expect(stopCommands(readSettings())).toEqual([HOOK()]);
  expect(out).toContain('Stop hook: updated.');
});

test('duplicate gournal hooks collapse to one and foreign hooks stay', async () => {
  writeSettings({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'gournal hook stop' }, { type: 'command', command: 'afplay done.wav' }] },
        { hooks: [{ type: 'command', command: FOREIGN }] },
        { hooks: [{ type: 'command', command: '/old/node /old/gournal/cli.js hook stop' }] },
        { hooks: [{ type: 'command', command: 'gournal hook stop' }] },
      ],
    },
  });
  await run({ hook: true });
  expect(readSettings().hooks.Stop).toEqual([
    { hooks: [{ type: 'command', command: HOOK() }, { type: 'command', command: 'afplay done.wav' }] },
    { hooks: [{ type: 'command', command: FOREIGN }] },
  ]);
  expect(out).toContain('Stop hook: updated.');
});

test('re-running setup reports "already set up" and does not write', async () => {
  writeSettings(foreignSettings());
  await run({ hook: true });
  const bytes = fs.readFileSync(settingsFile(), 'utf8');
  out.length = 0;
  expect(await run({ hook: true })).toBe(0);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(bytes);
  expect(out).toContain('Stop hook: already set up.');
  expect(out).not.toContain('Stop hook: added.');
  expect(out).not.toContain('Stop hook: updated.');
});

// A pinned hook runs a gournal bin symlink: node <path>/gournal hook stop

const SYMLINKED = 'node /x/node_modules/.bin/gournal hook stop';

test('a node command that runs a bin symlink named gournal is recognized, other tools are not', () => {
  expect(isGournalHook(SYMLINKED)).toBe(true);
  expect(isGournalHook(`'C:\\Program Files\\nodejs\\node.exe' 'C:\\p q\\gournal' hook stop`)).toBe(true);
  expect(isGournalHook('node /x/bin/other-tool hook stop')).toBe(false);
  expect(isGournalHook('/opt/my-gournal-notes/bin hook stop')).toBe(false);
  expect(isGournalHook('python /x/node_modules/.bin/gournal hook stop')).toBe(false);
  expect(isGournalHook('node /x/node_modules/.bin/gournal hook stop extra')).toBe(false);
});

test('a hook pinned through a gournal bin symlink is updated from another location, not duplicated', async () => {
  writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: SYMLINKED }] }] } });
  expect(await run({ hook: true })).toBe(0);
  expect(stopCommands(readSettings())).toEqual([HOOK()]);
  expect(out).toContain('Stop hook: updated.');
});

test('uninstall from another location removes a hook pinned through a gournal bin symlink', async () => {
  writeSettings({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: SYMLINKED }] }] } });
  expect(await run({ uninstall: true })).toBe(0);
  expect(readSettings()).toEqual({ model: 'x' });
  expect(out).toContain('Stop hook: removed.');
});

test('a hook for another tool named other-tool is left alone by install and uninstall', async () => {
  const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /x/bin/other-tool hook stop' }] }] } };
  writeSettings(other);
  await run({ hook: true });
  expect(stopCommands(readSettings())).toEqual(['node /x/bin/other-tool hook stop', HOOK()]);
  await run({ uninstall: true });
  expect(readSettings()).toEqual(other);
});

// Windows (every case injects the platform, so it runs on any OS)

const WIN_CMD = () => path.join(h.gh, 'bin', 'gournal.cmd');
const winIo = (over: Partial<SetupIo> = {}) => makeIo({ platform: 'win32', ...over });
const WIN_HOOK = () => ({ type: 'command', command: CMD_EXE, args: ['/d', '/c', WIN_CMD(), 'hook', 'stop'] });
const stopEntries = (settings: { hooks?: { Stop?: Array<{ hooks: unknown[] }> } }) =>
  (settings.hooks?.Stop ?? []).flatMap((g) => g.hooks);

describe('claude runner on Windows', () => {
  const ok = { code: 0, stdout: 'done', stderr: '' };
  const enoent = { code: 127, stdout: '', stderr: 'spawn claude ENOENT' };
  const seq = (...results: Array<typeof ok>) => {
    const log: Array<{ file: string; args: string[]; options: unknown }> = [];
    const once: ExecOnce = async (file, args, options) => {
      log.push({ file, args, options });
      return results[log.length - 1] ?? enoent;
    };
    return { log, once };
  };

  const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
  const WIN_CLI = 'C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\node_modules\\gournal\\dist\\cli.js';
  const SHIM = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
  const SHIM_PATH = 'C:\\Windows;C:\\Users\\x\\AppData\\Roaming\\npm';
  const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
  const shimDeps = { platform: 'win32' as const, cwd: 'C:\\work\\repo', env: { PATH: SHIM_PATH, ComSpec: COMSPEC }, exists: (f: string) => f === SHIM };

  test('an ENOENT is retried once through cmd.exe with the exact verbatim command line', async () => {
    const { log, once } = seq(enoent, ok);
    const run = createExecFileRunner({ ...shimDeps, once });
    const args = ['mcp', 'add', '--scope', 'user', 'gournal', '--', WIN_NODE, WIN_CLI, 'mcp'];
    expect(await run('claude', args)).toEqual(ok);
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual({ file: 'claude', args, options: { windowsHide: true } });
    // The inner line starts with the quoted shim path. The outer pair of quotes is for cmd.exe /s.
    const cmdline = `"${SHIM}" ${args.map((a) => `"${a}"`).join(' ')}`;
    expect(log[1]).toEqual({
      file: COMSPEC,
      args: ['/d', '/s', '/c', `"${cmdline}"`],
      options: { windowsVerbatimArguments: true, windowsHide: true, env: { ...shimDeps.env, NoDefaultCurrentDirectoryInExePath: '1' } },
    });
  });

  test('the cmd.exe child gets NoDefaultCurrentDirectoryInExePath=1 on top of the given env', async () => {
    const { log, once } = seq(enoent, ok);
    await createExecFileRunner({ ...shimDeps, env: { ...shimDeps.env, FOO: 'bar' }, once })('claude', ['x']);
    const env = (log[1]!.options as { env: NodeJS.ProcessEnv }).env;
    expect(env.NoDefaultCurrentDirectoryInExePath).toBe('1');
    expect(env.FOO).toBe('bar');
    expect(env.PATH).toBe(SHIM_PATH);
  });

  test('a claude.cmd or claude.bat planted in the current folder is never run', async () => {
    const cwd = 'C:\\work\\repo';
    const planted = (f: string): boolean => /^c:\\work\\repo\\claude\.(cmd|bat)$/i.test(f);
    for (const PATH of [`${cwd};C:\\Windows`, `.;C:\\Windows`, `${cwd}\\;C:\\Windows`, `"${cwd.toUpperCase()}";C:\\Windows`, `bin;C:\\Windows`]) {
      const { log, once } = seq(enoent, ok);
      const r = await createExecFileRunner({ platform: 'win32', cwd, env: { PATH }, once, exists: planted })('claude', ['mcp', 'list']);
      expect(r.code).toBe(127);
      // Only the first try ran. No cmd.exe started.
      expect(log).toHaveLength(1);
    }
  });

  test('no shim on PATH gives code 127 and never starts cmd.exe', async () => {
    const { log, once } = seq(enoent, ok);
    const r = await createExecFileRunner({ platform: 'win32', env: {}, once, resolveShim: () => null })('claude', ['x']);
    expect(r).toEqual(enoent);
    expect(log).toHaveLength(1);
  });

  test('a shim path that cmd.exe cannot quote is rejected with the manual command hint and no cmd.exe start', async () => {
    const bad = 'C:\\R&D\\npm\\claude.cmd';
    const { log, once } = seq(enoent, ok);
    const r = await createExecFileRunner({ platform: 'win32', env: {}, once, resolveShim: () => bad })('claude', ['mcp', 'list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot run');
    expect(r.stderr).toContain(bad);
    expect(r.stderr).toMatch(/Run the claude mcp add command yourself\.$/);
    expect(log).toHaveLength(1);
  });

  test('every character that cmd.exe acts on is rejected in the shim path', () => {
    for (const ch of ['%', '^', '&', '|', '<', '>', '!', '"', '\r', '\n', '\0']) {
      expect(() => buildCmdLine(`C:\\a${ch}b\\claude.cmd`, [])).toThrow('cannot run');
    }
    // A space and parentheses are fine inside quotes.
    expect(buildCmdLine('C:\\Program Files (x86)\\npm\\claude.cmd', [])).toBe('"C:\\Program Files (x86)\\npm\\claude.cmd"');
  });

  test('the first try uses the full path of claude.exe from PATH', async () => {
    const { log, once } = seq(enoent, ok);
    const exists = (f: string): boolean => f === 'C:\\Users\\x\\.local\\bin\\claude.exe' || f === SHIM;
    const env = { PATH: `C:\\Users\\x\\.local\\bin;${SHIM_PATH}`, ComSpec: COMSPEC };
    await createExecFileRunner({ platform: 'win32', cwd: 'C:\\work\\repo', env, once, exists })('claude', ['mcp', 'list']);
    expect(log[0]!.file).toBe('C:\\Users\\x\\.local\\bin\\claude.exe');
    expect(log[1]!.args).toEqual(['/d', '/s', '/c', `""${SHIM}" "mcp" "list""`]);
  });

  test('on Linux and macOS the first try keeps the bare name', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const { log, once } = seq(ok);
      await createExecFileRunner({ platform, env: { PATH: '/usr/bin' }, once, exists: () => true })('claude', ['x']);
      expect(log[0]!.file).toBe('claude');
    }
  });

  test('the cmd.exe path falls back to SystemRoot\\System32\\cmd.exe when ComSpec is not set', async () => {
    const run = async (env: NodeJS.ProcessEnv): Promise<string> => {
      const { log, once } = seq(enoent, ok);
      await createExecFileRunner({ ...shimDeps, env: { PATH: SHIM_PATH, ...env }, once })('claude', ['x']);
      return log[1]!.file;
    };
    expect(await run({ SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\cmd.exe');
    expect(await run({ SYSTEMROOT: 'E:\\W\\' })).toBe('E:\\W\\System32\\cmd.exe');
    expect(await run({})).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(await run({ ComSpec: 'F:\\x\\cmd.exe', SystemRoot: 'D:\\Win' })).toBe('F:\\x\\cmd.exe');
  });

  test('no retry when the first try works or fails for another reason', async () => {
    for (const first of [ok, { code: 2, stdout: '', stderr: 'bad' }]) {
      const { log, once } = seq(first);
      expect(await createExecFileRunner({ platform: 'win32', env: {}, once })('claude', ['x'])).toEqual(first);
      expect(log).toHaveLength(1);
    }
  });

  test('every first try asks for a hidden window', async () => {
    const { log, once } = seq(ok);
    await createExecFileRunner({ platform: 'win32', env: {}, once })('claude', ['x']);
    await createExecFileRunner({ platform: 'linux', env: {}, once })('claude', ['x']);
    expect(log.map((l) => l.options)).toEqual([{ windowsHide: true }, { windowsHide: true }]);
  });

  test('a result from the shim keeps its own code, so a missing inner program is not "claude not found"', async () => {
    for (const second of [
      { code: 9009, stdout: '', stderr: "'node' is not recognized as an internal or external command" },
      { code: 1, stdout: '', stderr: 'claude: bad option' },
    ]) {
      const { once } = seq(enoent, second);
      expect(await createExecFileRunner({ ...shimDeps, once })('claude', ['x'])).toEqual(second);
    }
  });

  test('linux and macOS never retry through cmd.exe', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const { log, once } = seq(enoent, ok);
      expect((await createExecFileRunner({ platform, env: {}, once, resolveShim: () => SHIM })('claude', ['x'])).code).toBe(127);
      expect(log).toHaveLength(1);
    }
  });

  test('an unsafe argument is rejected: code 1, a clear message, no cmd.exe start', async () => {
    for (const bad of ['C:\\100%\\cli.js', 'a^b', 'a&b', 'a|b', 'a<b', 'a>b', 'a!b', 'C:\\hi!\\cli.js', 'a"b', 'a\nb', 'a\rb', 'a\0b']) {
      const { log, once } = seq(enoent, ok);
      const r = await createExecFileRunner({ ...shimDeps, once })('claude', ['mcp', bad]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('cannot pass the argument');
      expect(log).toHaveLength(1);
      expect(() => buildCmdLine(SHIM, [bad])).toThrow('cannot pass the argument');
    }
  });

  test('buildCmdLine starts with the quoted program path, quotes each argument, and doubles a trailing backslash run', () => {
    expect(buildCmdLine(SHIM, ['mcp', 'C:\\Program Files\\x\\'])).toBe(`"${SHIM}" "mcp" "C:\\Program Files\\x\\\\"`);
  });

  test('the real runner reports a missing binary as code 127 on every system', async () => {
    const { execFileRunner } = await import('../../src/adapters/setup');
    const r = await execFileRunner('gournal-no-such-binary-xyz', []);
    expect(r.code).toBe(127);
    // On Windows the answer comes from resolveWinShim finding no shim, not from the text of cmd.exe.
    const win = await createExecFileRunner({ platform: 'win32', env: { PATH: '' } })('gournal-no-such-binary-xyz', []);
    expect(win.code).toBe(127);
  });
});

describe('setup on Windows', () => {
  test('a settings write survives one EPERM from the rename on win32, and fails at once on linux', async () => {
    const real = fs.renameSync.bind(fs);
    const failFirst = () => {
      let n = 0;
      const spy = jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
        if (String(b) === fs.realpathSync(settingsFile()) && n++ === 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        real(a, b);
      });
      return spy;
    };
    writeSettings({ model: 'x' });
    const win = failFirst();
    try {
      expect(await run({ hook: true }, winIo())).toBe(0);
      expect(win.mock.calls.filter(([, to]) => to === fs.realpathSync(settingsFile()))).toHaveLength(2);
    } finally { win.mockRestore(); }
    expect(readSettings()).toEqual({ model: 'x', hooks: { Stop: [{ hooks: [WIN_HOOK()] }] } });

    writeSettings({ model: 'x' });
    const posix = failFirst();
    try {
      await expect(run({ hook: true })).rejects.toThrow('EPERM');
      expect(posix.mock.calls.filter(([, to]) => to === fs.realpathSync(settingsFile()))).toHaveLength(1);
    } finally { posix.mockRestore(); }
    expect(readSettings()).toEqual({ model: 'x' });
  });

  test('registration runs the launcher through cmd.exe', async () => {
    expect(await run({}, winIo())).toBe(0);
    expect(calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', CMD_EXE, '/d', '/c', WIN_CMD(), 'mcp']]);
  });

  test('the manual line quotes each word with double quotes on Windows and single quotes on POSIX', async () => {
    await run({}, winIo({ exec: fakeExec(127) }));
    const win = out.join('\n');
    expect(win).toContain(`  claude mcp add --scope user gournal -- ${displayQuote(CMD_EXE, 'win32')} /d /c ${displayQuote(WIN_CMD(), 'win32')} mcp`);
    expect(win).not.toContain("'");
    out.length = 0;
    h.gh = path.join(root, 'my home', '.gournal');
    await run({}, makeIo({ exec: fakeExec(127) }));
    expect(out.join('\n')).toContain(`  claude mcp add --scope user gournal -- '${LAUNCHER()}' mcp`);
  });

  test('the hook is written in the exec form, is idempotent, and uninstall removes it', async () => {
    writeSettings({ model: 'x' });
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(readSettings()).toEqual({ model: 'x', hooks: { Stop: [{ hooks: [WIN_HOOK()] }] } });
    expect(out).toContain('Stop hook: added.');
    out.length = 0;
    const bytes = fs.readFileSync(settingsFile(), 'utf8');
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(out).toContain('Stop hook: already set up.');
    expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(bytes);
    out.length = 0;
    expect(await run({ uninstall: true }, winIo())).toBe(0);
    expect(readSettings()).toEqual({ model: 'x' });
    expect(out.join('\n')).toContain('Stop hook: removed.');
  });

  test('a POSIX string hook from an earlier run becomes the exec form, never a second hook', async () => {
    for (const old of ['gournal hook stop', `'C:\\old dir\\node.exe' 'C:\\old dir\\gournal\\cli.js' hook stop`, 'node /x/node_modules/.bin/gournal hook stop']) {
      writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: old }, { type: 'command', command: 'afplay done.wav' }] }] } });
      out.length = 0;
      expect(await run({ hook: true }, winIo())).toBe(0);
      expect(stopEntries(readSettings())).toEqual([WIN_HOOK(), { type: 'command', command: 'afplay done.wav' }]);
      expect(out).toContain('Stop hook: updated.');
    }
  });

  test('an exec hook from another install is updated in place, and duplicates collapse', async () => {
    const other = { type: 'command', command: 'C:\\old\\node.exe', args: ['C:\\old\\gournal', 'hook', 'stop'] };
    writeSettings({ hooks: { Stop: [{ hooks: [other] }, { hooks: [WIN_HOOK()] }, { hooks: [{ type: 'command', command: FOREIGN }] }] } });
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(readSettings().hooks.Stop).toEqual([{ hooks: [WIN_HOOK()] }, { hooks: [{ type: 'command', command: FOREIGN }] }]);
    expect(out).toContain('Stop hook: updated.');
  });

  test('uninstall removes any gournal hook form and keeps foreign hooks', async () => {
    const foreign = { type: 'command', command: 'C:\\tools\\gournal-notes\\run.exe', args: ['hook', 'stop'] };
    writeSettings({
      hooks: { Stop: [
        { hooks: [{ type: 'command', command: 'gournal hook stop' }, foreign] },
        { hooks: [{ type: 'command', command: 'C:\\old\\node.exe', args: ['C:\\old\\gournal\\cli.js', 'hook', 'stop'] }] },
      ] },
    });
    expect(await run({ uninstall: true }, winIo())).toBe(0);
    expect(readSettings()).toEqual({ hooks: { Stop: [{ hooks: [foreign] }] } });
  });

  test('a Linux run turns an exec-form hook back into the string form', async () => {
    writeSettings({ hooks: { Stop: [{ hooks: [WIN_HOOK()] }] } });
    await run({ hook: true });
    expect(stopEntries(readSettings())).toEqual([{ type: 'command', command: HOOK() }]);
  });

  test('a read-only mode is not copied to the temp file on Windows, and it is on POSIX', async () => {
    const chmod = jest.spyOn(fs, 'chmodSync');
    try {
      writeSettings({ model: 'x' });
      await run({ hook: true }, winIo());
      // The launcher write sets its own mode. Only the calls next to settings.json count here.
      const nearSettings = () => chmod.mock.calls.filter(([f]) => path.dirname(String(f)) === path.dirname(settingsFile()));
      expect(nearSettings()).toHaveLength(0);
      writeSettings({ model: 'x' });
      await run({ hook: true });
      expect(nearSettings().length).toBeGreaterThan(0);
    } finally {
      chmod.mockRestore();
    }
  });

  test('the Stop hook plan line shows the exec form with one pair of quotes per word', async () => {
    expect(await run({ hook: true }, winIo())).toBe(0);
    const text = out.join('\n');
    expect(text).toContain(`Stop hook: add ${displayQuote(CMD_EXE, 'win32')} /d /c ${displayQuote(WIN_CMD(), 'win32')} hook stop to ${settingsFile()}`);
    expect(text).not.toContain('""');
    out.length = 0;
    writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(out.join('\n')).toContain(`update the gournal hook in ${settingsFile()} to ${displayQuote(CMD_EXE, 'win32')} /d /c ${displayQuote(WIN_CMD(), 'win32')} hook stop`);
    expect(out.join('\n')).not.toContain('""');
  });

  test('the plan line for the hook shows the command with double quotes', async () => {
    const io = winIo({ isTTY: false });
    await setupClaude(io, { uninstall: false, yes: false, hook: false });
    expect(out.join('\n')).toContain(`add a Stop hook to ${settingsFile()}: ${displayQuote(CMD_EXE, 'win32')} /d /c ${displayQuote(WIN_CMD(), 'win32')} hook stop`);
  });
});

describe('isGournalHook exec form', () => {
  const exec = (command: string, args: unknown) => addStopHook({ hooks: { Stop: [{ hooks: [{ type: 'command', command, args }] }] } }, 'gournal hook stop');
  const recognized = (command: string, args: unknown) => exec(command, args).action === 'updated';

  test('accepts node or node.exe with a cli.js or gournal script', () => {
    expect(recognized('C:\\Program Files\\nodejs\\node.exe', ['C:\\gournal\\cli.js', 'hook', 'stop'])).toBe(true);
    expect(recognized('node', ['C:\\app\\node_modules\\.bin\\gournal', 'hook', 'stop'])).toBe(true);
    expect(recognized('/usr/bin/node', ['/x/gournal/cli.js', 'hook', 'stop'])).toBe(true);
  });

  test('compares the program name without regard to case', () => {
    expect(recognized('C:\\Program Files\\nodejs\\Node.exe', ['C:\\gournal\\cli.js', 'hook', 'stop'])).toBe(true);
    expect(recognized('NODE', ['C:\\gournal\\cli.js', 'hook', 'stop'])).toBe(true);
    expect(recognized('Nodejs.exe', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(false);
  });

  test('rejects look-alikes', () => {
    expect(recognized('node.exe', ['other.js', 'hook', 'stop'])).toBe(false);
    expect(recognized('C:\\tools\\gournal-notes\\run.exe', ['hook', 'stop'])).toBe(false);
    expect(recognized('C:\\tools\\gournal-notes\\run.exe', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(false);
    expect(recognized('python.exe', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(false);
    expect(recognized('node.exe', ['C:\\app\\cli.js', 'hook', 'stop', 'extra'])).toBe(false);
    expect(recognized('node.exe', ['C:\\app\\cli.js', 'hook'])).toBe(false);
    expect(recognized('node.exe', ['C:\\app\\cli.js', 'hook', 'start'])).toBe(false);
    expect(recognized('node.exe', ['--inspect', 'C:\\app\\cli.js', 'hook', 'stop'])).toBe(false);
    expect(recognized('node.exe', 'C:\\app\\cli.js hook stop')).toBe(false);
    expect(recognized('node.exe', ['C:\\app\\cli.js', 7, 'stop'])).toBe(false);
    expect(recognized('gournal hook stop', ['x'])).toBe(false);
  });

  test('the hook the current run writes always counts', () => {
    const hook = { command: 'C:\\x\\node.exe', args: ['C:\\x\\run.js', 'hook', 'stop'] };
    const added = addStopHook({}, hook);
    expect(added.next).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', ...hook }] }] } });
    expect(addStopHook(added.next, hook).changed).toBe(false);
    expect(removeStopHook(added.next, hook).changed).toBe(true);
    expect(removeStopHook(added.next).changed).toBe(false);
  });
});

describe('claude CLI missing is never a silent success', () => {
  const hasMissingNote = () => out.join('\n').includes('the claude CLI was not found on PATH');

  test('setup exits 1 on every platform and prints the manual command', async () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      out.length = 0;
      expect(await run({}, makeIo({ platform, exec: fakeExec(127) }))).toBe(1);
      expect(hasMissingNote()).toBe(true);
      expect(out.join('\n')).toContain('claude mcp add --scope user gournal --');
    }
  });

  test('uninstall exits 1 when the registration is there and claude is missing', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { gournal: { command: 'gournal', args: ['mcp'] } } }));
    expect(await run({ uninstall: true }, makeIo({ exec: fakeExec(127) }))).toBe(1);
    expect(hasMissingNote()).toBe(true);
  });

  test('replacing a registration exits 1 when claude is missing', async () => {
    differentReg();
    expect(await run({}, makeIo({ answer: true, exec: fakeExec(127) }))).toBe(1);
    expect(hasMissingNote()).toBe(true);
  });
});

describe('the launcher registration', () => {
  const readJson = (rel: string) => fs.readFileSync(path.join(h.gh, rel), 'utf8');

  test('a fresh setup registers the launcher, not bare gournal (root cause 1)', async () => {
    expect(await run({ hook: true })).toBe(0);
    expect(calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', LAUNCHER(), 'mcp']]);
    expect(readSettings().hooks.Stop[0].hooks[0].command).toBe(HOOK());
    expect(readJson('runtime/node')).toBe('/opt/node/bin/node\n');
    expect(checks).toEqual([[LAUNCHER(), '--version']]);
    expect(out).toContain('Check: Claude Code can start gournal without your shell PATH.');
    expect(out.join('\n')).not.toContain(VERSION);
  });

  symlinkTest('no registration, hook, or record holds the package path, and the copy survives the link (root cause 3)', async () => {
    fs.mkdirSync(path.join(root, 'ms'));
    const pkgLink = path.join(root, 'ms', 'bin');
    fs.symlinkSync(pkg, pkgLink);
    expect(await run({ hook: true }, makeIo({ packageRoot: pkgLink }))).toBe(0);
    const current = readJson('runtime/current').trim();
    const seen = [JSON.stringify(calls), fs.readFileSync(settingsFile(), 'utf8'), readJson('runtime/node'), readJson('runtime/current'), readJson('bin/gournal')];
    for (const text of seen) {
      expect(text).not.toContain(pkgLink);
      expect(text).not.toContain(pkg);
    }
    fs.rmSync(pkgLink);
    expect(fs.existsSync(path.join(h.gh, 'runtime', current, 'dist', 'cli.js'))).toBe(true);
  });

  test('a bare 0.9 registration moves to the launcher under --yes without a terminal (migration)', async () => {
    h.writeReg({ command: 'gournal', args: ['mcp'] });
    expect(await run({}, makeIo({ isTTY: false }))).toBe(0);
    expect(calls.map((c) => c[2])).toEqual(['remove', 'add']);
    expect(out.join('\n')).toContain('That command depends on the PATH and the Node.js version of the shell that ran setup.');
    expect(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.gournal.command).toBe(LAUNCHER());
  });

  test('a pinned node registration moves on a terminal, and the prompt defaults to yes', async () => {
    h.writeReg({ command: '/opt/node/bin/node', args: ['/usr/lib/node_modules/gournal/dist/cli.js', 'mcp'] });
    expect(await run({ yes: false }, makeIo())).toBe(0);
    expect(confirmAnswers).toContainEqual(['Move the gournal MCP registration to the launcher?', true]);
    expect(calls.map((c) => c[2])).toEqual(['remove', 'add']);
  });

  test('declining the move keeps the old registration and installs no launcher for it', async () => {
    h.writeReg({ command: 'gournal', args: ['mcp'] });
    expect(await run({ yes: false }, makeIo({ answer: false }))).toBe(0);
    expect(calls).toEqual([]);
    expect(out).toContain('MCP server: kept the existing registration.');
  });

  test('a foreign registration is still kept under --yes', async () => {
    h.writeReg({ command: '/opt/tools/run-gournal', args: ['serve'] });
    expect(await run({}, makeIo({ isTTY: false }))).toBe(0);
    expect(calls).toEqual([]);
    expect(confirmAnswers).toEqual([]);
    expect(out).toContain('MCP server: kept the existing registration. Run setup in a terminal to replace it.');
  });

  test('a legacy hook is updated under --yes without --hook', async () => {
    writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
    expect(await run({})).toBe(0);
    expect(stopCommands(readSettings())).toEqual([HOOK()]);
    expect(out).toContain('Stop hook: updated.');
  });

  test('a current registration with a failing check exits 1 (root cause 5)', async () => {
    expect(await run({})).toBe(0);
    err.length = 0;
    const check = async () => ({ code: 1, stdout: '', stderr: 'gournal: found no Node.js 22.13 or newer.\nmore' });
    expect(await run({}, makeIo({ check }))).toBe(1);
    expect(err).toContain('Check: the launcher did not start gournal (exit 1). gournal: found no Node.js 22.13 or newer.');
  });

  test('a check that prints another version fails', async () => {
    const check = async () => ({ code: 0, stdout: '0.0.0-other\n', stderr: '' });
    expect(await run({}, makeIo({ check }))).toBe(1);
    expect(err.join('\n')).toContain('Check: the launcher did not start gournal (exit 0). 0.0.0-other');
  });

  test('a deleted launcher is installed again when the registration is current', async () => {
    await run({});
    fs.rmSync(LAUNCHER());
    out.length = 0;
    expect(await run({})).toBe(0);
    expect(fs.existsSync(LAUNCHER())).toBe(true);
    expect(out).toContain(`Launcher: updated in ${path.join(h.gh, 'runtime')}.`);
    expect(out).toContain('MCP server: already set up.');
  });

  test('declining the MCP and hook steps installs no launcher and runs no check', async () => {
    expect(await run({ yes: false }, makeIo({ answer: false }))).toBe(0);
    expect(fs.existsSync(path.join(h.gh, 'bin'))).toBe(false);
    expect(fs.existsSync(path.join(h.gh, 'runtime'))).toBe(false);
    expect(checks).toEqual([]);
    expect(err).toEqual([]);
  });

  test('a launcher install that throws exits 1 and skips the steps that need it', async () => {
    fs.writeFileSync(h.gh, 'a file, not a folder');
    expect(await run({ hook: true })).toBe(1);
    expect(err.join('\n')).toContain('Launcher: could not install in');
    expect(out).toContain('MCP server: skipped, because the launcher is not installed.');
    expect(out).toContain('Stop hook: skipped, because the launcher is not installed.');
    expect(calls).toEqual([]);
    expect(checks).toEqual([]);
  });

  test.each([['a space', 'Ann Lee'], ['a quote', "O'Neil"]])('a home with %s gives a quoted hook and one registration', async (_name, dir) => {
    h.gh = path.join(root, dir, '.gournal');
    expect(await run({ hook: true })).toBe(0);
    expect(calls[0]!.slice(-2)).toEqual([LAUNCHER(), 'mcp']);
    expect(stopCommands(readSettings())).toEqual([HOOK()]);
    expect(HOOK()).toContain("'");
    expect(await run({ hook: true })).toBe(0);
    expect(stopCommands(readSettings())).toEqual([HOOK()]);
    expect(out).toContain('Stop hook: already set up.');
    expect(await run({ uninstall: true })).toBe(0);
    expect(readSettings().hooks).toBeUndefined();
  });

  test('a custom home is baked into the launcher when bakeHome is on', async () => {
    await run({}, makeIo({ bakeHome: true }));
    expect(readJson('bin/gournal')).toContain(h.gh);
  });

  test('uninstall removes the launcher and the runtime and keeps the journal', async () => {
    await run({ hook: true });
    fs.writeFileSync(path.join(h.gh, 'gournal.db'), 'journal');
    out.length = 0;
    expect(await run({ uninstall: true })).toBe(0);
    expect(fs.existsSync(LAUNCHER())).toBe(false);
    expect(fs.existsSync(path.join(h.gh, 'runtime'))).toBe(false);
    expect(fs.readFileSync(path.join(h.gh, 'gournal.db'), 'utf8')).toBe('journal');
    expect(out).toContain('Launcher: removed.');
    out.length = 0;
    expect(await run({ uninstall: true })).toBe(0);
    expect(out).toContain('Launcher: not set up.');
  });

  test('uninstall keeps the launcher when the user says no', async () => {
    await run({});
    out.length = 0;
    expect(await run({ uninstall: true, yes: false }, makeIo({ answer: false }))).toBe(0);
    expect(fs.existsSync(LAUNCHER())).toBe(true);
    expect(out).toContain('Launcher: kept.');
  });

  test('the non-terminal plan lists the launcher step', async () => {
    const io = makeIo({ isTTY: false });
    expect(await setupClaude(io, { uninstall: false, yes: false, hook: false })).toBe(1);
    const text = out.join('\n');
    expect(text).toContain(`  1. Install the launcher ${LAUNCHER()} and a copy of gournal in ${path.join(h.gh, 'runtime')}`);
    expect(text).toContain(`  2. Register the MCP server: claude mcp add --scope user gournal -- ${shellQuote(LAUNCHER())} mcp`);
    expect(text).toContain(`  4. Optional, with --hook: add a Stop hook to ${settingsFile()}: ${HOOK()}`);
    out.length = 0;
    await setupClaude(io, { uninstall: true, yes: false, hook: false });
    expect(out.join('\n')).toContain(`  4. Remove the launcher ${LAUNCHER()} and ${path.join(h.gh, 'runtime')}`);
    expect(fs.existsSync(h.gh)).toBe(false);
  });

  test('win32 refuses a launcher path that cmd.exe cannot keep quoted', async () => {
    h.gh = path.join(root, 'a(b');
    expect(await run({ hook: true }, winIo())).toBe(1);
    expect(err.join('\n')).toContain('Set GOURNAL_HOME');
    expect(out).toContain('MCP server: skipped, because the launcher is not installed.');
    expect(calls).toEqual([]);
    expect(fs.existsSync(h.gh)).toBe(false);
  });

  test('win32 runs the check through cmd.exe', async () => {
    expect(await run({}, winIo())).toBe(0);
    expect(checks[0]).toEqual([CMD_EXE, '/d', '/c', WIN_CMD(), '--version']);
  });
});
