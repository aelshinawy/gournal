import { classifyRegistration } from '../../src/adapters/setup/command';
import { removeStopHook, isGournalHook } from '../../src/adapters/setup/settings';

test('the launcher hook shapes are gournal hooks', () => {
  expect(isGournalHook("'/Users/Ann Lee/.gournal/bin/gournal' hook stop")).toBe(true);
  expect(isGournalHook('/Users/x/.gournal/bin/gournal hook stop')).toBe(true);
  expect(isGournalHook('/x/bin/gournal-notes hook stop')).toBe(false);
  expect(isGournalHook('/opt/gournal/bin/run hook stop')).toBe(false);
  expect(isGournalHook('/opt/my-gournal-notes/bin hook stop')).toBe(false);
});

test('the cmd.exe exec hook is ours and is removed by uninstall', () => {
  const s = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', 'C:\\h\\bin\\gournal.cmd', 'hook', 'stop'] }] }] } };
  expect(removeStopHook(s).changed).toBe(true);
  const other = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', 'C:\\x\\other.cmd', 'hook', 'stop'] }] }] } };
  expect(removeStopHook(other).changed).toBe(false);
});

test('classifyRegistration', () => {
  const cur = { command: '/h/bin/gournal', args: ['mcp'] };
  expect(classifyRegistration(cur, cur)).toBe('current');
  expect(classifyRegistration({ command: 'gournal', args: ['mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: '/old/node', args: ['/old/lib/node_modules/gournal/dist/cli.js', 'mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: '/o/.local/state/fnm_multishells/1_2/bin/node', args: ['/o/.local/state/fnm_multishells/1_2/bin/gournal', 'mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: '/other/home/bin/gournal', args: ['mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: 'C:\\Windows\\System32\\CMD.EXE', args: ['/d', '/c', 'C:\\h\\bin\\Gournal.cmd', 'mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: '/opt/tools/run-gournal', args: ['serve'] }, cur)).toBe('foreign');
  expect(classifyRegistration({ command: 'node', args: ['/x/other.js', 'mcp'] }, cur)).toBe('foreign');
  expect(classifyRegistration({ command: 'gournal', args: ['mcp', '--x'] }, cur)).toBe('foreign');
});

test('classifyRegistration handles Windows node shapes and rejects lookalikes', () => {
  const cur = { command: '/h/bin/gournal', args: ['mcp'] };
  expect(classifyRegistration({ command: 'C:\\Program Files\\nodejs\\NODE.EXE', args: ['C:\\Users\\a b\\AppData\\Roaming\\npm\\node_modules\\gournal\\dist\\cli.js', 'mcp'] }, cur)).toBe('gournal');
  expect(classifyRegistration({ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/c', 'C:\\x\\other.cmd', 'mcp'] }, cur)).toBe('foreign');
  expect(classifyRegistration({ command: 'cmd.exe', args: ['/c', 'gournal.cmd', 'mcp'] }, cur)).toBe('foreign');
  expect(classifyRegistration({ command: '/x/gournal-notes', args: ['mcp'] }, cur)).toBe('foreign');
  expect(classifyRegistration({ command: 'node', args: ['cli.js', 'mcp', 'x'] }, cur)).toBe('foreign');
});

test('a foreign cli.js is not gournal in any form', () => {
  const cur = { command: '/h/bin/gournal', args: ['mcp'] };
  expect(classifyRegistration({ command: 'node', args: ['/opt/other-tool/dist/cli.js', 'mcp'] }, cur)).toBe('foreign');
  expect(isGournalHook('node /opt/other-tool/dist/cli.js hook stop')).toBe(false);
  const exec = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node', args: ['/opt/other-tool/dist/cli.js', 'hook', 'stop'] }] }] } };
  expect(removeStopHook(exec).changed).toBe(false);
  expect(isGournalHook('gournal hook stop && other')).toBe(false);
  const extra = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cmd.exe', args: ['/d', '/c', 'C:\\h\\bin\\gournal.cmd', 'hook', 'stop', 'x'] }] }] } };
  expect(removeStopHook(extra).changed).toBe(false);
});

test('a cli.js under a gournal directory is gournal, with a Windows path too', () => {
  const cur = { command: '/h/bin/gournal', args: ['mcp'] };
  const win = 'C:\\Users\\A B\\AppData\\Roaming\\npm\\node_modules\\gournal\\dist\\cli.js';
  expect(classifyRegistration({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [win, 'mcp'] }, cur)).toBe('gournal');
  expect(isGournalHook('node /src/Gournal/dist/cli.js hook stop')).toBe(true);
  const exec = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node.exe', args: [win, 'hook', 'stop'] }] }] } };
  expect(removeStopHook(exec).changed).toBe(true);
});
