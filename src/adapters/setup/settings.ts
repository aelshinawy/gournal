type Json = Record<string, unknown>;

const HOOK_SUFFIX = ' hook stop';

/** A hook is gournal's when it ends with " hook stop" and either names gournal or is the command setup resolves now. */
export function isGournalHook(command: string, current?: string): boolean {
  if (!command.endsWith(HOOK_SUFFIX)) return false;
  return command.slice(0, -HOOK_SUFFIX.length).includes('gournal') || command === current;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function stopGroups(settings: Json): unknown[] {
  const hooks = settings.hooks;
  if (!isObj(hooks) || !Array.isArray(hooks.Stop)) return [];
  return hooks.Stop;
}

/** The commands of the gournal hooks in settings, in order. */
export function gournalHookCommands(settings: Json, current?: string): string[] {
  const out: string[] = [];
  for (const group of stopGroups(settings)) {
    if (!isObj(group) || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) {
      if (isObj(h) && typeof h.command === 'string' && isGournalHook(h.command, current)) out.push(h.command);
    }
  }
  return out;
}

/** Add the gournal Stop hook. Every other key and hook stays as it is. */
export function addStopHook(settings: Json, command: string): { next: Json; changed: boolean } {
  const existing = gournalHookCommands(settings, command);
  if (existing.length === 1 && existing[0] === command) return { next: settings, changed: false };
  const next = clone(settings);
  if (existing.length > 0) {
    // A gournal hook from another install: point it at this one.
    for (const group of stopGroups(next)) {
      if (!isObj(group) || !Array.isArray(group.hooks)) continue;
      for (const h of group.hooks) {
        if (isObj(h) && typeof h.command === 'string' && isGournalHook(h.command, command)) h.command = command;
      }
    }
    return { next, changed: true };
  }
  if (!isObj(next.hooks)) next.hooks = {};
  const hooks = next.hooks as Json;
  if (!Array.isArray(hooks.Stop)) hooks.Stop = [];
  (hooks.Stop as unknown[]).push({ hooks: [{ type: 'command', command }] });
  return { next, changed: true };
}

/** Remove every gournal Stop hook. Drop the containers that this leaves empty. */
export function removeStopHook(settings: Json, current?: string): { next: Json; changed: boolean } {
  if (gournalHookCommands(settings, current).length === 0) return { next: settings, changed: false };
  const next = clone(settings);
  const hooks = next.hooks as Json;
  const kept: unknown[] = [];
  for (const group of hooks.Stop as unknown[]) {
    if (!isObj(group) || !Array.isArray(group.hooks)) {
      kept.push(group);
      continue;
    }
    const rest = group.hooks.filter((h) => !(isObj(h) && typeof h.command === 'string' && isGournalHook(h.command, current)));
    if (rest.length === group.hooks.length) kept.push(group);
    else if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  if (kept.length > 0) hooks.Stop = kept;
  else delete hooks.Stop;
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { next, changed: true };
}
