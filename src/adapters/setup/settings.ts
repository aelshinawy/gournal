type Json = Record<string, unknown>;

/** Characters that `shellQuote` leaves bare. */
const BARE = /[\w@%+=:,./-]/;

/**
 * Split a command the way `shellQuote` joins one: bare words, single-quoted runs, and `\'` for a
 * quote. Return null for any other shell syntax, so a foreign command never parses as ours.
 */
function tokenize(command: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === ' ') {
      if (word !== null) words.push(word);
      word = null;
    } else if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return null;
      word = (word ?? '') + command.slice(i + 1, close);
      i = close;
    } else if (c === '\\' && command[i + 1] === "'") {
      word = (word ?? '') + "'";
      i++;
    } else if (BARE.test(c)) {
      word = (word ?? '') + c;
    } else return null;
  }
  if (word !== null) words.push(word);
  return words;
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? '';

/**
 * A hook is gournal's only when its command has a shape that setup writes:
 *   gournal hook stop
 *   <node> <cli.js|gournal> hook stop   (each part quoted by shellQuote when needed)
 * The script is `cli.js`, or `gournal` when setup ran through a bin symlink such as node_modules/.bin/gournal.
 * `current` is the command setup resolves now. It always counts, whatever the script is named.
 * This function reads the shell form only. The exec form is recognized when setup reads the settings.
 */
export function isGournalHook(command: string, current?: string): boolean {
  if (current !== undefined && command === current) return true;
  const t = tokenize(command);
  if (t === null) return false;
  if (t.length === 3) return t[0] === 'gournal' && t[1] === 'hook' && t[2] === 'stop';
  if (t.length !== 4) return false;
  const node = baseName(t[0]!);
  const script = baseName(t[1]!);
  const isNode = node === 'node' || node === 'node.exe';
  const isScript = script === 'cli.js' || script === 'gournal';
  return isNode && isScript && t[2] === 'hook' && t[3] === 'stop';
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A Stop hook that setup writes. A string is the shell form: `command` holds the whole line.
 * An object is the exec form: `command` is the executable and `args` are its arguments. No shell runs.
 */
export type StopHook = string | { command: string; args: string[] };

const want = (hook: StopHook): { command: string; args?: string[] } =>
  typeof hook === 'string' ? { command: hook } : { command: hook.command, args: hook.args };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((a) => typeof a === 'string');

/** True when `h` is a hook entry that has the same command and the same args (or none) as `hook`. */
function sameHook(h: Json, hook: StopHook): boolean {
  const w = want(hook);
  if (h.command !== w.command) return false;
  return w.args === undefined ? h.args === undefined : isStrings(h.args) && JSON.stringify(h.args) === JSON.stringify(w.args);
}

/**
 * The exec form that setup writes on Windows: `<node|node.exe>` with the args
 * `[<cli.js|gournal>, 'hook', 'stop']`. The script path is one arg, so it needs no quoting.
 */
function isGournalExecHook(command: string, args: unknown): boolean {
  if (!isStrings(args) || args.length !== 3) return false;
  const node = baseName(command).toLowerCase();
  const script = baseName(args[0]!);
  const isNode = node === 'node' || node === 'node.exe';
  const isScript = script === 'cli.js' || script === 'gournal';
  return isNode && isScript && args[1] === 'hook' && args[2] === 'stop';
}

/** True when `h` is a gournal hook entry in the shell form or in the exec form. */
function isOurs(h: unknown, current?: StopHook): h is Json {
  if (!isObj(h) || typeof h.command !== 'string') return false;
  if (current !== undefined && sameHook(h, current)) return true;
  if (h.args !== undefined) return isGournalExecHook(h.command, h.args);
  return isGournalHook(h.command);
}

function stopGroups(settings: Json): unknown[] {
  const hooks = settings.hooks;
  if (!isObj(hooks) || !Array.isArray(hooks.Stop)) return [];
  return hooks.Stop;
}

/** The gournal hook entries in settings, in order. */
function gournalHooks(settings: Json, current?: StopHook): Json[] {
  const out: Json[] = [];
  for (const group of stopGroups(settings)) {
    if (!isObj(group) || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) if (isOurs(h, current)) out.push(h);
  }
  return out;
}

export type HookAction = 'added' | 'updated' | 'unchanged';

/**
 * Add the gournal Stop hook. Every other key and hook stays as it is, foreign hooks included.
 * One gournal hook already there is pointed at `hook`, in whichever form `hook` has.
 * Extra gournal hooks are removed.
 */
export function addStopHook(settings: Json, hook: StopHook): { next: Json; changed: boolean; action: HookAction } {
  const existing = gournalHooks(settings, hook);
  if (existing.length === 1 && sameHook(existing[0]!, hook)) return { next: settings, changed: false, action: 'unchanged' };
  const next = clone(settings);
  const w = want(hook);
  if (existing.length > 0) {
    let seen = false;
    const kept: unknown[] = [];
    for (const group of stopGroups(next)) {
      if (!isObj(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const rest = group.hooks.filter((h) => {
        if (!isOurs(h, hook)) return true;
        if (seen) return false;
        seen = true;
        h.command = w.command;
        if (w.args === undefined) delete h.args;
        else h.args = w.args;
        return true;
      });
      if (rest.length === group.hooks.length) kept.push(group);
      else if (rest.length > 0) kept.push({ ...group, hooks: rest });
    }
    (next.hooks as Json).Stop = kept;
    return { next, changed: true, action: 'updated' };
  }
  if (!isObj(next.hooks)) next.hooks = {};
  const hooks = next.hooks as Json;
  if (!Array.isArray(hooks.Stop)) hooks.Stop = [];
  (hooks.Stop as unknown[]).push({ hooks: [{ type: 'command', command: w.command, ...(w.args ? { args: w.args } : {}) }] });
  return { next, changed: true, action: 'added' };
}

/** Remove every gournal Stop hook. Drop the containers that this leaves empty. */
export function removeStopHook(settings: Json, current?: StopHook): { next: Json; changed: boolean } {
  if (gournalHooks(settings, current).length === 0) return { next: settings, changed: false };
  const next = clone(settings);
  const hooks = next.hooks as Json;
  const kept: unknown[] = [];
  for (const group of hooks.Stop as unknown[]) {
    if (!isObj(group) || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const rest = group.hooks.filter((h) => !isOurs(h, current));
    if (rest.length === group.hooks.length) kept.push(group);
    else if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  if (kept.length > 0) hooks.Stop = kept;
  else delete hooks.Stop;
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { next, changed: true };
}
