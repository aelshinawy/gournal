import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupClaude, resolveGournalCommand, SKILL_MD, SKILL_MARKER, type SetupIo, type CommandRunner } from '../../src/adapters/setup';
import { addStopHook, removeStopHook, isGournalHook } from '../../src/adapters/setup/settings';
import { runIn } from '../helpers/run-cli';

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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-setup-')));
  home = path.join(root, 'home');
  fs.mkdirSync(home);
  script = path.join(root, 'lib', 'cli.js');
  fs.mkdirSync(path.dirname(script));
  fs.writeFileSync(script, '');
  bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync(script, path.join(bin, 'gournal'));
  calls = []; out = []; err = []; confirmAnswers = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('tests run inside the temp HOME', () => {
  expect(process.env.HOME).toBe(process.env.GOURNAL_TEST_HOME_ROOT);
  expect(home.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
});

test('setup registers MCP, installs the skill, and leaves the hook off by default', async () => {
  writeSettings({ model: 'x' });
  const before = fs.readFileSync(settingsFile(), 'utf8');
  expect(await run()).toBe(0);
  expect(calls).toEqual([['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', 'gournal', 'mcp']]);
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
  expect(out.filter((l) => l.includes('already set up'))).toHaveLength(3);
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

test('uninstall restores a settings file that had no hooks key', async () => {
  writeSettings({ model: 'x' });
  await run({ hook: true });
  await run({ uninstall: true });
  expect(readSettings()).toEqual({ model: 'x' });
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

test('claude CLI missing prints the manual command and still installs the skill', async () => {
  expect(await run({}, makeIo({ exec: fakeExec(127) }))).toBe(0);
  expect(out.join('\n')).toContain('claude mcp add --scope user gournal -- gournal mcp');
  expect(fs.readFileSync(skillFile(), 'utf8')).toBe(SKILL_MD);
});

test('a failing claude CLI gives exit 1 with its message', async () => {
  expect(await run({}, makeIo({ exec: fakeExec(2) }))).toBe(1);
  expect(err.join('\n')).toContain('boom');
});

test('uses node and the script path when gournal on PATH is a different install', async () => {
  const other = path.join(root, 'other.js');
  fs.writeFileSync(other, '');
  fs.rmSync(path.join(bin, 'gournal'));
  fs.symlinkSync(other, path.join(bin, 'gournal'));
  await run({ hook: true });
  expect(calls[0]).toEqual(['claude', 'mcp', 'add', '--scope', 'user', 'gournal', '--', '/opt/node/bin/node', script, 'mcp']);
  expect(readSettings().hooks.Stop[0].hooks[0].command).toBe(`/opt/node/bin/node ${script} hook stop`);
});

test('hook command quotes parts that contain spaces', async () => {
  const spaced = path.join(root, 'my lib', 'cli.js');
  fs.mkdirSync(path.dirname(spaced));
  fs.writeFileSync(spaced, '');
  await run({ hook: true }, makeIo({ env: { argv1: spaced, execPath: '/opt/node/bin/node', path: bin } }));
  expect(readSettings().hooks.Stop[0].hooks[0].command).toBe(`/opt/node/bin/node '${spaced}' hook stop`);
});

test('resolveGournalCommand: bare when PATH resolves to the same script, empty PATH pins', () => {
  expect(resolveGournalCommand({ argv1: script, execPath: '/n', path: bin })).toEqual({ command: 'gournal', args: [] });
  expect(resolveGournalCommand({ argv1: script, execPath: '/n', path: '' })).toEqual({ command: '/n', args: [script] });
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

// Fix round 1

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

test('a pinned hook command without "gournal" in its path is found again', async () => {
  const appDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-app-')));
  const pinned = path.join(appDir, 'cli.js');
  fs.writeFileSync(pinned, '');
  const io = () => makeIo({ env: { argv1: pinned, execPath: '/opt/node/bin/node', path: '' } });
  await run({ hook: true }, io());
  await run({ hook: true }, io());
  expect(readSettings().hooks.Stop).toHaveLength(1);
  await run({ uninstall: true }, io());
  expect(readSettings().hooks).toBeUndefined();
  fs.rmSync(appDir, { recursive: true, force: true });
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
