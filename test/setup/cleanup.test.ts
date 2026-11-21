import fs from 'fs';
import path from 'path';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { makeHarness, type Harness } from '../helpers/setup-harness';
import { selfCleanup } from '../../src/adapters/setup/cleanup';
import { runtimePaths } from '../../src/adapters/setup/runtime';
import type { CommandRunner } from '../../src/adapters/setup';

const roots: string[] = [];
afterAll(() => roots.forEach(rmTmp));

const FOREIGN_HOOK = { type: 'command', command: '/usr/local/bin/other-tool stop' };

/** A home with a full gournal setup (registration, skill, hook, launcher, runtime), a journal file, and a foreign hook. */
async function installed(): Promise<Harness> {
  const root = makeRealTmp('gournal-cleanup-');
  roots.push(root);
  const h = makeHarness(root);
  h.writeSettings({ hooks: { Stop: [{ hooks: [FOREIGN_HOOK] }] } });
  expect(await h.run({ hook: true })).toBe(0);
  fs.writeFileSync(path.join(h.gh, 'gournal.db'), 'journal');
  h.calls.length = 0;
  h.out.length = 0;
  return h;
}

const clean = (h: Harness, exec: CommandRunner): Promise<void> =>
  selfCleanup({ copyHome: h.gh, userHome: h.home, platform: 'linux', exec });
const registered = (h: Harness): unknown => JSON.parse(fs.readFileSync(path.join(h.home, '.claude.json'), 'utf8')).mcpServers?.gournal;
const launcher = (h: Harness): string => runtimePaths(h.gh, process.platform).launcher;

test('it removes the current registration, the hook, the skill, the launcher, and the runtime, and keeps gournal.db and foreign hooks', async () => {
  const h = await installed();
  expect(registered(h)).toBeDefined();
  await clean(h, h.fakeExec());
  expect(registered(h)).toBeUndefined();
  expect(h.stopCommands(h.readSettings())).toEqual([FOREIGN_HOOK.command]);
  expect(fs.existsSync(h.skillFile())).toBe(false);
  expect(fs.existsSync(launcher(h))).toBe(false);
  expect(fs.existsSync(path.join(h.gh, 'runtime'))).toBe(false);
  expect(fs.readFileSync(path.join(h.gh, 'gournal.db'), 'utf8')).toBe('journal');
  expect(h.calls.map((c) => c.slice(0, 2).join(' '))).toEqual(['claude mcp']);
  expect(h.calls[0]).toContain('remove');
  expect([h.out, h.err]).toEqual([[], []]);
});

test('a launcher registration of another gournal home is kept', async () => {
  const h = await installed();
  const other = { command: '/else/.gournal/bin/gournal', args: ['mcp'] };
  h.writeReg(other);
  await clean(h, h.fakeExec());
  expect(registered(h)).toMatchObject(other);
  expect(h.calls).toEqual([]);
  // The skill file is shared. The registration of another home still needs it.
  expect(fs.existsSync(h.skillFile())).toBe(true);
  expect(h.stopCommands(h.readSettings())).toEqual([FOREIGN_HOOK.command]);
});

test('a gournal-shaped hook of another home survives, and this home hook goes', async () => {
  const h = await installed();
  const otherHook = "'/else/.gournal/bin/gournal' hook stop";
  const settings = h.readSettings();
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: otherHook }] });
  h.writeSettings(settings);
  await clean(h, h.fakeExec());
  expect(h.stopCommands(h.readSettings())).toEqual([FOREIGN_HOOK.command, otherHook]);
});

test('a registration that is gone still lets the skill go', async () => {
  const h = await installed();
  fs.writeFileSync(path.join(h.home, '.claude.json'), '{}');
  await clean(h, h.fakeExec());
  expect(fs.existsSync(h.skillFile())).toBe(false);
});

test('a foreign registration named gournal is kept', async () => {
  const h = await installed();
  const foreign = { command: '/opt/tools/run-gournal', args: ['serve'] };
  h.writeReg(foreign);
  await clean(h, h.fakeExec());
  expect(registered(h)).toMatchObject(foreign);
  expect(h.calls).toEqual([]);
});

test('without the claude CLI it removes the hook and the skill and keeps the launcher and the copy', async () => {
  const h = await installed();
  await clean(h, async () => ({ code: 127, stdout: '', stderr: '' }));
  expect(registered(h)).toBeDefined();
  expect(h.stopCommands(h.readSettings())).toEqual([FOREIGN_HOOK.command]);
  expect(fs.existsSync(h.skillFile())).toBe(false);
  expect(fs.existsSync(launcher(h))).toBe(true);
  expect(fs.existsSync(path.join(h.gh, 'runtime', 'current'))).toBe(true);
});

test('a throwing exec never throws out of selfCleanup and prints nothing', async () => {
  const h = await installed();
  const write = jest.spyOn(process.stdout, 'write');
  const writeErr = jest.spyOn(process.stderr, 'write');
  try {
    await expect(clean(h, async () => { throw new Error('boom'); })).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(writeErr).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    writeErr.mockRestore();
  }
});
