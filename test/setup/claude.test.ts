import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupClaude, resolveGournalCommand, SKILL_MD, SKILL_MARKER, type SetupIo, type CommandRunner } from '../../src/adapters/setup';
import { shellQuote } from '../../src/adapters/setup/command';
import { createExecFileRunner, buildCmdLine, type ExecOnce } from '../../src/adapters/setup/runner';
import { addStopHook, removeStopHook, isGournalHook } from '../../src/adapters/setup/settings';
import { runIn } from '../helpers/run-cli';
import { canSymlink } from '../helpers/symlink';
import { makeRealTmp, rmTmp } from '../helpers/tmp';

// Windows needs a privilege to create a symlink. A test that needs one skips without it.
const symlinkTest = canSymlink() ? test : test.skip;

let root: string;
let home: string;
let script: string;
let bin: string;
let calls: string[][];
let out: string[];
let err: string[];
let confirmAnswers: Array<[string, boolean]>;

/** A fake claude CLI. It keeps ~/.claude.json in step, as the real one does. */
function fakeExec(code = 0): CommandRunner {
  return async (file, args) => {
    calls.push([file, ...args]);
    if (code !== 0) return { code, stdout: '', stderr: 'boom' };
    const f = path.join(home, '.claude.json');
    const cfg = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    if (args[1] === 'add') {
      const rest = args.slice(args.indexOf('--') + 1);
      cfg.mcpServers = { ...cfg.mcpServers, gournal: { type: 'stdio', command: rest[0], args: rest.slice(1) } };
    } else if (args[1] === 'remove') {
      delete cfg.mcpServers?.gournal;
    }
    fs.writeFileSync(f, JSON.stringify(cfg));
    return { code: 0, stdout: '', stderr: '' };
  };
}

function makeIo(over: Partial<SetupIo> & { answer?: boolean } = {}): SetupIo {
  return {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    home,
    isTTY: true,
    confirm: async (m, d) => { confirmAnswers.push([m, d]); return over.answer ?? d; },
    exec: fakeExec(),
    env: { argv1: script, execPath: '/opt/node/bin/node', path: bin },
    // The POSIX rules hold on every OS that runs the tests. A win32 test sets its own platform.
    platform: 'linux',
    ...over,
  };
}

const run = (opts: Partial<{ uninstall: boolean; yes: boolean; hook: boolean }> = {}, io: SetupIo = makeIo()) =>
  setupClaude(io, { uninstall: false, yes: true, hook: false, ...opts });

const settingsFile = () => path.join(home, '.claude', 'settings.json');
const skillFile = () => path.join(home, '.claude', 'skills', 'gournal', 'SKILL.md');
const writeSettings = (v: unknown) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
};
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));

beforeEach(() => {
  root = makeRealTmp('gournal-setup-');
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  script = path.join(root, 'lib', 'cli.js');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, '');
  bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // Without symlink rights, a copy keeps the setup working. The tests that need a real link skip.
  if (canSymlink()) fs.symlinkSync(script, path.join(bin, 'gournal'));
  else fs.copyFileSync(script, path.join(bin, 'gournal'));
  calls = []; out = []; err = []; confirmAnswers = [];
});
afterEach(() => rmTmp(root));

test('setup registers MCP, installs the skill, and leaves the hook off by default', async () => {
  writeSettings({ model: 'x' });
  const before = fs.readFileSync(settingsFile(), 'utf8');
  expect(await run()).toBe(0);
  expect(calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', 'gournal', 'mcp']]);
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
  expect(fs.readFileSync(settingsFile(), 'utf8')).toBe(before);
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(false);
  expect(out).toContain('Stop hook: not enabled (add --hook to enable it).');
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
  expect(out.filter((l) => l.includes('already set up'))).toHaveLength(3);
  expect(out).toContain('Stop hook: already set up.');
  expect(out).not.toContain('Stop hook: added.');
});

test('existing different registration is replaced only on yes', async () => {
  fs.writeFileSync(path.join(home, '.claude.json'),
    JSON.stringify({ mcpServers: { gournal: { type: 'stdio', command: 'node', args: ['/old/cli.js', 'mcp'] } } }));
  expect(await run({}, makeIo({ answer: false }))).toBe(0);
  expect(calls).toEqual([]);
  expect(confirmAnswers.some(([m, d]) => m.includes('Replace') && d === false)).toBe(true);
  expect(await run({}, makeIo({ answer: true }))).toBe(0);
  expect(calls.map((c) => c[2])).toEqual(['remove', 'add']);
  expect(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.gournal.command).toBe('gournal');
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
  expect(added.hooks.Stop[1].hooks[0]).toEqual({ type: 'command', command: 'gournal hook stop' });
  expect(fs.existsSync(`${settingsFile()}.gournal-backup`)).toBe(true);
  await run({ uninstall: true });
  expect(readSettings()).toEqual(original);
});

test('settings.json is created with only hooks when missing', async () => {
  await run({ hook: true });
  expect(readSettings()).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
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
  expect(out.join('\n')).toContain('claude mcp add --scope user gournal -- gournal mcp');
  expect(calls).toEqual([]);
  expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  expect(err.join('\n')).toContain('--yes');
});

test('non-TTY uninstall without --yes prints the removal plan and exits 1', async () => {
  const io = makeIo({ isTTY: false });
  expect(await setupClaude(io, { uninstall: true, yes: false, hook: false })).toBe(1);
  expect(out.join('\n')).toContain('would remove these changes');
  expect(out.join('\n')).toContain('claude mcp remove --scope user gournal');
  expect(calls).toEqual([]);
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

test('a failing claude CLI gives exit 1 with its message', async () => {
  expect(await run({}, makeIo({ exec: fakeExec(2) }))).toBe(1);
  expect(err.join('\n')).toContain('boom');
});

symlinkTest('uses node and the script path when gournal on PATH is a different install', async () => {
  const other = path.join(root, 'other.js');
  fs.writeFileSync(other, '');
  fs.rmSync(path.join(bin, 'gournal'));
  fs.symlinkSync(other, path.join(bin, 'gournal'));
  await run({ hook: true });
  expect(calls[0]).toEqual(['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', '/opt/node/bin/node', script, 'mcp']);
  expect(readSettings().hooks.Stop[0].hooks[0].command).toBe(`/opt/node/bin/node ${shellQuote(script)} hook stop`);
});

test('hook command quotes parts that contain spaces', async () => {
  const spaced = path.join(root, 'my lib', 'cli.js');
  fs.mkdirSync(path.dirname(spaced));
  fs.writeFileSync(spaced, '');
  await run({ hook: true }, makeIo({ env: { argv1: spaced, execPath: '/opt/node/bin/node', path: bin } }));
  expect(readSettings().hooks.Stop[0].hooks[0].command).toBe(`/opt/node/bin/node '${spaced}' hook stop`);
});

test.each(['linux', 'darwin', 'win32'] as const)('resolveGournalCommand on %s', (platform) => {
  // Windows always pins node and the script. POSIX uses the bare name when PATH resolves to the same script.
  const bare = platform === 'win32' ? { command: '/n', args: [script] } : { command: 'gournal', args: [] };
  expect(resolveGournalCommand({ argv1: script, execPath: '/n', path: bin }, platform)).toEqual(bare);
  expect(resolveGournalCommand({ argv1: script, execPath: '/n', path: '' }, platform)).toEqual({ command: '/n', args: [script] });
});

test('the setup claude command is wired into the CLI (non-TTY without --yes exits 1)', async () => {
  const r = await runIn(path.join(root, 'gh'), ['setup', 'claude'], { isTTY: false });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('--yes');
  expect(fs.existsSync(path.join(os.homedir(), '.claude'))).toBe(false);
});

// A different registration, a pinned hook, a failed removal, and the settings backup

const differentReg = () =>
  fs.writeFileSync(path.join(home, '.claude.json'),
    JSON.stringify({ mcpServers: { gournal: { type: 'stdio', command: 'node', args: ['/old/cli.js', 'mcp'] } } }));

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
  expect(out.join('\n')).toContain(`The original file is kept at ${settingsFile()}.gournal-backup`);
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
  expect(stored.hooks.Stop[0].hooks[0].command).toBe('gournal hook stop');
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
const stopCommands = (settings: { hooks?: { Stop?: Array<{ hooks: Array<{ command: string }> }> } }) =>
  (settings.hooks?.Stop ?? []).flatMap((g) => g.hooks.map((h) => h.command));
const foreignSettings = () => ({
  model: 'opus',
  hooks: { Stop: [{ hooks: [{ type: 'command', command: FOREIGN }] }], PreToolUse: [{ matcher: 'Bash', hooks: [] }] },
});

// A pinned hook can run a gournal bin symlink: node <path>/gournal hook stop
const SYMLINKED = 'node /x/node_modules/.bin/gournal hook stop';

test.each<[string, boolean]>([
  ['gournal hook stop', true],
  ['/usr/local/bin/node /usr/lib/gournal/dist/cli.js hook stop', true],
  ['node /x/cli.js hook stop', true],
  ['C:\\nodejs\\node.exe C:\\app\\cli.js hook stop', false],
  [`'C:\\Program Files\\nodejs\\node.exe' 'C:\\app\\cli.js' hook stop`, true],
  [`/opt/node/bin/node '/my lib/it's here/cli.js' hook stop`, false],
  [`/opt/node/bin/node '/my lib/it'\\''s here/cli.js' hook stop`, true],
  [`'/my node/node' '/my lib/cli.js' hook stop`, true],
  ['gournal hook stop ', true],
  // A node command that runs a bin symlink named gournal
  [SYMLINKED, true],
  [`'C:\\Program Files\\nodejs\\node.exe' 'C:\\p q\\gournal' hook stop`, true],
  // Foreign commands
  [FOREIGN, false],
  ['other hook stop', false],
  ['afplay done.wav', false],
  ['/opt/gournal/bin/run hook stop', false],
  ['/opt/gournal/node /x/gournal.js hook stop', false],
  ['/usr/bin/python /x/cli.js hook stop', false],
  ['node /x/cli.js hook stop extra', false],
  ['gournal hook stop; rm -rf x', false],
  ['gournal hook stop && gournal', false],
  ['echo gournal hook stop', false],
  ['node /x/bin/other-tool hook stop', false],
  ['python /x/node_modules/.bin/gournal hook stop', false],
  ['node /x/node_modules/.bin/gournal hook stop extra', false],
])('isGournalHook(%j) is %s', (command, expected) => {
  expect(isGournalHook(command)).toBe(expected);
});

test('isGournalHook always counts the command that the current run writes', () => {
  expect(isGournalHook('/opt/node/bin/node /srv/app/run.js hook stop', '/opt/node/bin/node /srv/app/run.js hook stop')).toBe(true);
});

test('a foreign hook whose path contains "gournal" survives install and uninstall unchanged', async () => {
  writeSettings(foreignSettings());
  expect(await run({ hook: true })).toBe(0);
  const added = readSettings();
  expect(stopCommands(added)).toEqual([FOREIGN, 'gournal hook stop']);
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
  expect(stopCommands(readSettings())).toEqual(['gournal hook stop']);
  expect(out).toContain('Stop hook: updated.');

  writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
  out.length = 0;
  await run({ hook: true }, makeIo({ env: { argv1: script, execPath: '/opt/node/bin/node', path: '' } }));
  expect(stopCommands(readSettings())).toEqual([`/opt/node/bin/node ${shellQuote(script)} hook stop`]);
  expect(out).toContain('Stop hook: updated.');
});

test('duplicate gournal hooks collapse to one and foreign hooks stay', async () => {
  writeSettings({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'gournal hook stop' }, { type: 'command', command: 'afplay done.wav' }] },
        { hooks: [{ type: 'command', command: FOREIGN }] },
        { hooks: [{ type: 'command', command: '/old/node /old/cli.js hook stop' }] },
        { hooks: [{ type: 'command', command: 'gournal hook stop' }] },
      ],
    },
  });
  await run({ hook: true });
  expect(readSettings().hooks.Stop).toEqual([
    { hooks: [{ type: 'command', command: 'gournal hook stop' }, { type: 'command', command: 'afplay done.wav' }] },
    { hooks: [{ type: 'command', command: FOREIGN }] },
  ]);
  expect(out).toContain('Stop hook: updated.');
});

// A pinned command has no "gournal" in a plain path, and a quoted one has a space.
test.each([['a plain', 'app'], ['a quoted', 'my lib']])('%s pinned hook command is found again on re-run and on uninstall', async (_kind, dir) => {
  const pinned = path.join(root, dir, 'cli.js');
  fs.mkdirSync(path.dirname(pinned));
  fs.writeFileSync(pinned, '');
  const io = () => makeIo({ env: { argv1: pinned, execPath: '/opt/node/bin/node', path: '' } });
  await run({ hook: true }, io());
  out.length = 0;
  await run({ hook: true }, io());
  expect(out).toContain('Stop hook: already set up.');
  expect(stopCommands(readSettings())).toHaveLength(1);
  await run({ uninstall: true }, io());
  expect(readSettings().hooks).toBeUndefined();
});

// A pinned hook runs a gournal bin symlink: node <path>/gournal hook stop

test('a hook pinned through a gournal bin symlink is updated from another location, not duplicated', async () => {
  writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: SYMLINKED }] }] } });
  const io = () => makeIo({ env: { argv1: script, execPath: '/opt/node/bin/node', path: '' } });
  expect(await run({ hook: true }, io())).toBe(0);
  expect(stopCommands(readSettings())).toEqual([`/opt/node/bin/node ${shellQuote(script)} hook stop`]);
  expect(out).toContain('Stop hook: updated.');
});

test('uninstall from another location removes a hook pinned through a gournal bin symlink', async () => {
  writeSettings({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: SYMLINKED }] }] } });
  expect(await run({ uninstall: true })).toBe(0);
  expect(readSettings()).toEqual({ model: 'x' });
  expect(out).toContain('Stop hook: removed.');
});

// Windows (every case injects the platform, so it runs on any OS)

const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_CLI = 'C:\\Users\\Ann Lee\\AppData\\Roaming\\npm\\node_modules\\gournal\\dist\\cli.js';
const winIo = (over: Partial<SetupIo> = {}) =>
  makeIo({ platform: 'win32', env: { argv1: WIN_CLI, execPath: WIN_NODE, path: bin }, ...over });
const WIN_HOOK = { type: 'command', command: WIN_NODE, args: [WIN_CLI, 'hook', 'stop'] };
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

  const SHIM = 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd';
  const SHIM_PATH = 'C:\\Windows;C:\\Users\\x\\AppData\\Roaming\\npm';
  const COMSPEC = 'C:\\Windows\\System32\\cmd.exe';
  const shimDeps = { platform: 'win32' as const, cwd: 'C:\\work\\repo', env: { PATH: SHIM_PATH, ComSpec: COMSPEC }, exists: (f: string) => f === SHIM };

  test('an ENOENT is retried once through cmd.exe with the exact verbatim command line', async () => {
    const { log, once } = seq(enoent, ok);
    // The child env is the given env plus NoDefaultCurrentDirectoryInExePath. FOO shows that the rest passes through.
    const env = { ...shimDeps.env, FOO: 'bar' };
    const run = createExecFileRunner({ ...shimDeps, env, once });
    const args = ['mcp', 'add', '--scope', 'user', 'gournal', '--', WIN_NODE, WIN_CLI, 'mcp'];
    expect(await run('claude', args)).toEqual(ok);
    expect(log).toHaveLength(2);
    expect(log[0]).toEqual({ file: 'claude', args, options: { windowsHide: true } });
    // The inner line starts with the quoted shim path. The outer pair of quotes is for cmd.exe /s.
    const cmdline = `"${SHIM}" ${args.map((a) => `"${a}"`).join(' ')}`;
    expect(log[1]).toEqual({
      file: COMSPEC,
      args: ['/d', '/s', '/c', `"${cmdline}"`],
      options: { windowsVerbatimArguments: true, windowsHide: true, env: { ...env, NoDefaultCurrentDirectoryInExePath: '1' } },
    });
  });

  test('no usable shim gives code 127 and never starts cmd.exe: none on PATH, or a claude.cmd or claude.bat planted in the current folder', async () => {
    const cwd = 'C:\\work\\repo';
    const planted = (f: string): boolean => /^c:\\work\\repo\\claude\.(cmd|bat)$/i.test(f);
    const rows = [
      { env: {}, resolveShim: () => null },
      ...[`${cwd};C:\\Windows`, `.;C:\\Windows`, `${cwd}\\;C:\\Windows`, `"${cwd.toUpperCase()}";C:\\Windows`, `bin;C:\\Windows`]
        .map((PATH) => ({ cwd, env: { PATH }, exists: planted })),
    ];
    for (const row of rows) {
      const { log, once } = seq(enoent, ok);
      const r = await createExecFileRunner({ platform: 'win32', once, ...row })('claude', ['mcp', 'list']);
      expect(r).toEqual(enoent);
      // Only the first try ran. No cmd.exe started.
      expect(log).toHaveLength(1);
    }
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

  test('the first try uses the full path of claude.exe from PATH', async () => {
    const { log, once } = seq(enoent, ok);
    const exists = (f: string): boolean => f === 'C:\\Users\\x\\.local\\bin\\claude.exe' || f === SHIM;
    const env = { PATH: `C:\\Users\\x\\.local\\bin;${SHIM_PATH}`, ComSpec: COMSPEC };
    await createExecFileRunner({ platform: 'win32', cwd: 'C:\\work\\repo', env, once, exists })('claude', ['mcp', 'list']);
    expect(log[0]!.file).toBe('C:\\Users\\x\\.local\\bin\\claude.exe');
    expect(log[1]!.args).toEqual(['/d', '/s', '/c', `""${SHIM}" "mcp" "list""`]);
  });

  test('on Linux and macOS the first try keeps the bare name and asks for a hidden window', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const { log, once } = seq(ok);
      await createExecFileRunner({ platform, env: { PATH: '/usr/bin' }, once, exists: () => true })('claude', ['x']);
      expect(log[0]!.file).toBe('claude');
      expect(log[0]!.options).toEqual({ windowsHide: true });
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

  // Every character that cmd.exe acts on, in a shim path and in an argument.
  test.each(['%', '^', '&', '|', '<', '>', '!', '"', '\r', '\n', '\0'])('%j is rejected in the shim path and in an argument', async (ch) => {
    expect(() => buildCmdLine(`C:\\a${ch}b\\claude.cmd`, [])).toThrow('cannot run');
    const bad = `a${ch}b`;
    expect(() => buildCmdLine(SHIM, [bad])).toThrow('cannot pass the argument');
    const { log, once } = seq(enoent, ok);
    const r = await createExecFileRunner({ ...shimDeps, once })('claude', ['mcp', bad]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cannot pass the argument');
    // Only the first try ran. No cmd.exe started.
    expect(log).toHaveLength(1);
  });

  test('buildCmdLine starts with the quoted program path, quotes each argument, and doubles a trailing backslash run', () => {
    expect(buildCmdLine(SHIM, ['mcp', 'C:\\Program Files\\x\\'])).toBe(`"${SHIM}" "mcp" "C:\\Program Files\\x\\\\"`);
    // A space and parentheses are fine inside quotes.
    expect(buildCmdLine('C:\\Program Files (x86)\\npm\\claude.cmd', [])).toBe('"C:\\Program Files (x86)\\npm\\claude.cmd"');
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
    expect(readSettings()).toEqual({ model: 'x', hooks: { Stop: [{ hooks: [WIN_HOOK] }] } });

    writeSettings({ model: 'x' });
    const posix = failFirst();
    try {
      await expect(run({ hook: true })).rejects.toThrow('EPERM');
      expect(posix.mock.calls.filter(([, to]) => to === fs.realpathSync(settingsFile()))).toHaveLength(1);
    } finally { posix.mockRestore(); }
    expect(readSettings()).toEqual({ model: 'x' });
  });

  test('the manual line quotes each path with double quotes on Windows and single quotes on POSIX', async () => {
    await run({}, winIo({ exec: fakeExec(127) }));
    const win = out.join('\n');
    expect(win).toContain(`  claude mcp add --scope user gournal -- "${WIN_NODE}" "${WIN_CLI}" mcp`);
    expect(win).not.toContain("'");
    out.length = 0;
    const spaced = path.join(root, 'my lib', 'cli.js');
    fs.mkdirSync(path.dirname(spaced));
    fs.writeFileSync(spaced, '');
    await run({}, makeIo({ exec: fakeExec(127), env: { argv1: spaced, execPath: '/opt/node/bin/node', path: '' } }));
    expect(out.join('\n')).toContain(`  claude mcp add --scope user gournal -- /opt/node/bin/node '${spaced}' mcp`);
  });

  test('a path that cmd.exe cannot quote ends in the manual command and a clear sentence', async () => {
    const enoent = { code: 127, stdout: '', stderr: 'spawn claude ENOENT' };
    const shim = 'C:\\Users\\x\\npm\\claude.cmd';
    const exec = createExecFileRunner({ platform: 'win32', env: { PATH: 'C:\\Users\\x\\npm' }, exists: (f) => f === shim, cwd: 'C:\\work', once: async () => enoent });
    const cli = 'C:\\R&D\\gournal\\dist\\cli.js';
    const io = winIo({ exec, env: { argv1: cli, execPath: WIN_NODE, path: bin } });
    expect(await run({}, io)).toBe(1);
    expect(err.join('\n')).toContain('cannot pass the argument');
    expect(err.join('\n')).toMatch(/Run the claude mcp add command yourself\.\s*$/);
    expect(out.join('\n')).toContain(`  claude mcp add --scope user gournal -- "${WIN_NODE}" "${cli}" mcp`);
    expect(() => buildCmdLine('C:\\x\\claude.cmd', ['a&b'])).toThrow(/Run the claude mcp add command yourself\.$/);
  });

  test('the hook is written in the exec form, is idempotent, and uninstall removes it', async () => {
    writeSettings({ model: 'x' });
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(readSettings()).toEqual({ model: 'x', hooks: { Stop: [{ hooks: [WIN_HOOK] }] } });
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
    for (const old of ['gournal hook stop', `'C:\\old dir\\node.exe' 'C:\\old dir\\cli.js' hook stop`, 'node /x/node_modules/.bin/gournal hook stop']) {
      writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: old }, { type: 'command', command: 'afplay done.wav' }] }] } });
      out.length = 0;
      expect(await run({ hook: true }, winIo())).toBe(0);
      expect(stopEntries(readSettings())).toEqual([WIN_HOOK, { type: 'command', command: 'afplay done.wav' }]);
      expect(out).toContain('Stop hook: updated.');
    }
  });

  test('an exec hook from another install is updated in place, and duplicates collapse', async () => {
    const other = { type: 'command', command: 'C:\\old\\node.exe', args: ['C:\\old\\gournal', 'hook', 'stop'] };
    writeSettings({ hooks: { Stop: [{ hooks: [other] }, { hooks: [{ ...WIN_HOOK }] }, { hooks: [{ type: 'command', command: FOREIGN }] }] } });
    expect(await run({ hook: true }, winIo())).toBe(0);
    expect(readSettings().hooks.Stop).toEqual([{ hooks: [WIN_HOOK] }, { hooks: [{ type: 'command', command: FOREIGN }] }]);
    expect(out).toContain('Stop hook: updated.');
  });

  test('uninstall removes any gournal hook form and keeps foreign hooks', async () => {
    const foreign = { type: 'command', command: 'C:\\tools\\gournal-notes\\run.exe', args: ['hook', 'stop'] };
    writeSettings({
      hooks: { Stop: [
        { hooks: [{ type: 'command', command: 'gournal hook stop' }, foreign] },
        { hooks: [{ type: 'command', command: 'C:\\old\\node.exe', args: ['C:\\old\\cli.js', 'hook', 'stop'] }] },
      ] },
    });
    expect(await run({ uninstall: true }, winIo())).toBe(0);
    expect(readSettings()).toEqual({ hooks: { Stop: [{ hooks: [foreign] }] } });
  });

  test('a Linux run turns an exec-form hook back into the string form', async () => {
    writeSettings({ hooks: { Stop: [{ hooks: [WIN_HOOK] }] } });
    await run({ hook: true });
    expect(stopEntries(readSettings())).toEqual([{ type: 'command', command: 'gournal hook stop' }]);
  });

  test('a read-only mode is not copied to the temp file on Windows, and it is on POSIX', async () => {
    const chmod = jest.spyOn(fs, 'chmodSync');
    try {
      writeSettings({ model: 'x' });
      await run({ hook: true }, winIo());
      expect(chmod).not.toHaveBeenCalled();
      writeSettings({ model: 'x' });
      await run({ hook: true });
      expect(chmod).toHaveBeenCalled();
    } finally {
      chmod.mockRestore();
    }
  });

  test('every hook plan line shows the exec form with one pair of quotes per word', async () => {
    expect(await run({ hook: true }, winIo())).toBe(0);
    const added = out.join('\n');
    expect(added).toContain(`Stop hook: add "${WIN_NODE}" "${WIN_CLI}" hook stop to ${settingsFile()}`);
    out.length = 0;
    writeSettings({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'gournal hook stop' }] }] } });
    expect(await run({ hook: true }, winIo())).toBe(0);
    const updated = out.join('\n');
    expect(updated).toContain(`update the gournal hook in ${settingsFile()} to "${WIN_NODE}"`);
    out.length = 0;
    await setupClaude(winIo({ isTTY: false }), { uninstall: false, yes: false, hook: false });
    const preview = out.join('\n');
    expect(preview).toContain(`add a Stop hook to ${settingsFile()}: "${WIN_NODE}"`);
    for (const text of [added, updated, preview]) expect(text).not.toContain('""');
  });
});

describe('isGournalHook exec form', () => {
  const exec = (command: string, args: unknown) => addStopHook({ hooks: { Stop: [{ hooks: [{ type: 'command', command, args }] }] } }, 'gournal hook stop');
  const recognized = (command: string, args: unknown) => exec(command, args).action === 'updated';

  test('accepts node or node.exe with a cli.js or gournal script', () => {
    expect(recognized('C:\\Program Files\\nodejs\\node.exe', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(true);
    expect(recognized('node', ['C:\\app\\node_modules\\.bin\\gournal', 'hook', 'stop'])).toBe(true);
    expect(recognized('/usr/bin/node', ['/x/cli.js', 'hook', 'stop'])).toBe(true);
  });

  test('compares the program name without regard to case', () => {
    expect(recognized('C:\\Program Files\\nodejs\\Node.exe', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(true);
    expect(recognized('NODE', ['C:\\app\\cli.js', 'hook', 'stop'])).toBe(true);
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

  test('setup exits 1 on every platform, prints the manual command, and still installs the skill', async () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      out.length = 0;
      expect(await run({}, makeIo({ platform, exec: fakeExec(127) }))).toBe(1);
      expect(hasMissingNote()).toBe(true);
      expect(out.join('\n')).toContain('claude mcp add --scope user gournal --');
      expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
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
