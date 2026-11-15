import fs from 'fs';
import path from 'path';
import readline from 'readline';

export const HOOK_REASON = 'Gournal: this session edited files but logged no work. Call add_entry once with a summary of the work (pass project and cwd). Then stop.';
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

const STATE_FILE = 'hook-state.json';
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const GOURNAL_ADD = /\bgournal\s+add\b/;

interface HookState {
  asked: Record<string, string>;
}

function readState(file: string): HookState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const asked = (parsed as { asked?: unknown } | null)?.asked;
    if (typeof asked === 'object' && asked !== null && !Array.isArray(asked)) {
      return { asked: { ...(asked as Record<string, string>) } };
    }
  } catch {
    // Missing or bad state counts as empty.
  }
  return { asked: {} };
}

function writeState(file: string, state: HookState): void {
  const tmp = path.join(path.dirname(file), `.hook-state.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Streams the transcript. Bad lines are skipped. */
async function scan(transcriptPath: string): Promise<{ edited: boolean; logged: boolean }> {
  const result = { edited: false, logged: false };
  const stream = fs.createReadStream(transcriptPath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('tool_use')) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const o = obj as { type?: unknown; message?: { content?: unknown } } | null;
      if (!o || o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
      for (const block of o.message.content as Array<Record<string, unknown> | null>) {
        if (!block || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
        const name = block.name;
        if (EDIT_TOOLS.includes(name)) result.edited = true;
        if (name.includes('gournal') && name.endsWith('__add_entry')) result.logged = true;
        if (name === 'Bash') {
          const command = (block.input as { command?: unknown } | null)?.command;
          if (typeof command === 'string' && GOURNAL_ADD.test(command)) result.logged = true;
        }
      }
      if (result.logged) break;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return result;
}

/** Returns the JSON line to print, or null. Never throws. */
export async function stopHook(stdin: string, home: string, now: Date): Promise<string | null> {
  try {
    const input = JSON.parse(stdin) as { session_id?: unknown; transcript_path?: unknown; stop_hook_active?: unknown } | null;
    if (!input || input.stop_hook_active === true) return null;
    const { session_id: sessionId, transcript_path: transcriptPath } = input;
    if (typeof sessionId !== 'string' || !sessionId || typeof transcriptPath !== 'string' || !transcriptPath) return null;

    const stateFile = path.join(home, STATE_FILE);
    const state = readState(stateFile);
    if (Object.prototype.hasOwnProperty.call(state.asked, sessionId)) return null;

    const { edited, logged } = await scan(transcriptPath);
    if (!edited || logged) return null;

    const cutoff = now.getTime() - PRUNE_MS;
    const kept: Record<string, string> = {};
    for (const [id, at] of Object.entries(state.asked)) {
      const t = Date.parse(at);
      if (Number.isFinite(t) && t >= cutoff) kept[id] = at;
    }
    kept[sessionId] = now.toISOString();
    fs.mkdirSync(home, { recursive: true });
    writeState(stateFile, { asked: kept });
    return JSON.stringify({ decision: 'block', reason: HOOK_REASON });
  } catch {
    return null;
  }
}
