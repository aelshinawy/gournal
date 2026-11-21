import { classifyRegistration } from '../../src/adapters/setup/command';
import { removeStopHook, isGournalHook } from '../../src/adapters/setup/settings';

test('the launcher hook shapes are gournal hooks', () => {
  expect(isGournalHook("'/Users/Ann Lee/.gournal/bin/gournal' hook stop")).toBe(true);
  expect(isGournalHook('/Users/x/.gournal/bin/gournal hook stop')).toBe(true);
  expect(isGournalHook('/x/bin/gournal-notes hook stop')).toBe(false);
  expect(isGournalHook('/opt/gournal/bin/run hook stop')).toBe(false);
  expect(isGournalHook('/opt/my-gournal-notes/bin hook stop')).toBe(false);
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
