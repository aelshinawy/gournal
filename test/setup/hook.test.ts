import fs from 'fs';
import path from 'path';
import { stopHook, HOOK_REASON } from '../../src/adapters/setup/hook';
import { makeTmp } from '../helpers/tmp';

let dir: string;
let home: string;
const now = new Date('2026-11-15T12:00:00Z');
const EXPECTED = JSON.stringify({ decision: 'block', reason: HOOK_REASON });

const tool = (name: string, input: unknown = {}) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name, input }] } });

function transcript(lines: string[]): string {
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
const input = (file: string, extra: Record<string, unknown> = {}, id = 's1') =>
  JSON.stringify({ session_id: id, transcript_path: file, stop_hook_active: false, ...extra });

beforeEach(() => {
  dir = makeTmp('gournal-hook-');
  home = path.join(dir, 'home');
  fs.mkdirSync(home);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('stopHook', () => {
  test('asks once when files were edited and add_entry was not called', async () => {
    const i = input(transcript([tool('Edit', { file_path: 'a.ts' })]));
    expect(await stopHook(i, home, now)).toBe(EXPECTED);
    expect(await stopHook(i, home, now)).toBeNull();
  });
  test('does nothing when stop_hook_active is true', async () => {
    const i = input(transcript([tool('Write')]), { stop_hook_active: true });
    expect(await stopHook(i, home, now)).toBeNull();
    expect(fs.existsSync(path.join(home, 'hook-state.json'))).toBe(false);
  });
  test('does nothing when add_entry or gournal add was called', async () => {
    for (const logged of [
      tool('mcp__gournal__add_entry'),
      tool('mcp__plugin_gournal_gournal__add_entry'),
      tool('Bash', { command: 'gournal add "did it" -p x' }),
      tool('PowerShell', { command: 'gournal add "did it" -p x' }),
    ]) {
      const i = input(transcript([tool('MultiEdit'), logged]), {}, `s-${logged.length}`);
      expect(await stopHook(i, home, now)).toBeNull();
    }
  });
  test('a PowerShell command that is not gournal add does not count as logged', async () => {
    const i = input(transcript([tool('Edit'), tool('PowerShell', { command: 'Get-ChildItem' })]));
    expect(await stopHook(i, home, now)).toBe(EXPECTED);
  });
  test('does nothing for a session with no edits', async () => {
    const i = input(transcript([tool('Read'), tool('Bash', { command: 'ls' })]));
    expect(await stopHook(i, home, now)).toBeNull();
  });
  test('bad transcript or bad stdin returns null', async () => {
    expect(await stopHook('not json', home, now)).toBeNull();
    expect(await stopHook('', home, now)).toBeNull();
    expect(await stopHook(JSON.stringify({ session_id: 's' }), home, now)).toBeNull();
    expect(await stopHook(input(path.join(dir, 'missing.jsonl')), home, now)).toBeNull();
    const file = transcript(['{bad', '[]', 'null', tool('NotebookEdit')]);
    expect(await stopHook(input(file), home, now)).toBe(EXPECTED);
  });
  test('does not open the database', async () => {
    await stopHook(input(transcript([tool('Edit')])), home, now);
    expect(fs.readdirSync(home).sort()).toEqual(['hook-state.json']);
  });
  test('prunes asked sessions older than 7 days', async () => {
    const old = new Date(now.getTime() - 8 * 86400000).toISOString();
    const recent = new Date(now.getTime() - 86400000).toISOString();
    fs.writeFileSync(path.join(home, 'hook-state.json'), JSON.stringify({ asked: { old, recent } }));
    await stopHook(input(transcript([tool('Edit')]), {}, 'fresh'), home, now);
    const state = JSON.parse(fs.readFileSync(path.join(home, 'hook-state.json'), 'utf8'));
    expect(Object.keys(state.asked).sort()).toEqual(['fresh', 'recent']);
  });
});
