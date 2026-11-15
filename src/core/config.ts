import { newId } from './ulid';

export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface GithubConfig {
  autoSync: boolean;
  autoSyncMinutes: number;
  initialSyncDays: number;
  owners: { include: string[]; exclude: string[] };
}

export interface Config {
  deviceId: string;
  weekStartsOn: WeekDay;
  projectAliases: Record<string, string>;
  tagAliases: Record<string, string>;
  ticketPrefixes: string[];
  staleAfterDays: number;
  github: GithubConfig;
}

export const CONFIG_DEFAULTS: Omit<Config, 'deviceId' | 'projectAliases' | 'tagAliases' | 'ticketPrefixes'> = {
  weekStartsOn: 1,
  staleAfterDays: 14,
  github: { autoSync: true, autoSyncMinutes: 15, initialSyncDays: 30, owners: { include: [], exclude: [] } },
};

function invalid(file: string, reason: string): Error {
  return new Error(`Config ${file} is not valid JSON object: ${reason}. Fix or delete it; gournal did not change it.`);
}

function isStringMap(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && Object.values(v).every((x) => typeof x === 'string');
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate and fill. Returns the config and whether the file needs to be rewritten. */
export function normalizeConfig(
  file: string,
  raw: Record<string, unknown>,
  warn: (msg: string) => void,
): { config: Config; changed: boolean } {
  if (raw.deviceId !== undefined && (typeof raw.deviceId !== 'string' || !raw.deviceId)) {
    throw invalid(file, 'deviceId must be a non-empty string');
  }
  for (const key of ['projectAliases', 'tagAliases'] as const) {
    if (raw[key] !== undefined && !isStringMap(raw[key])) throw invalid(file, `${key} must be an object of strings`);
    const map = (raw[key] ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(map)) {
      if (v !== k && Object.hasOwn(map, v)) throw invalid(file, `alias chain at "${k}"`);
    }
  }
  const tp = raw.ticketPrefixes;
  if (tp !== undefined && !isStringArray(tp)) {
    throw invalid(file, 'ticketPrefixes must be an array of strings');
  }

  const d = CONFIG_DEFAULTS;
  const posInt = (value: unknown, name: string, def: number): number => {
    if (value === undefined) return def;
    if (isPositiveInt(value)) return value;
    warn(`config ${file}: ${name} must be a positive integer; using ${def}`);
    return def;
  };

  let weekStartsOn: WeekDay = d.weekStartsOn;
  if (raw.weekStartsOn !== undefined) {
    const w = raw.weekStartsOn;
    if (typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 6) weekStartsOn = w as WeekDay;
    else warn(`config ${file}: weekStartsOn must be an integer from 0 to 6; using ${d.weekStartsOn}`);
  }

  const gh = raw.github;
  let g: Record<string, unknown> = {};
  if (gh !== undefined) {
    if (isObject(gh)) g = gh;
    else warn(`config ${file}: github must be an object; using defaults`);
  }
  let autoSync = d.github.autoSync;
  if (g.autoSync !== undefined) {
    if (typeof g.autoSync === 'boolean') autoSync = g.autoSync;
    else warn(`config ${file}: github.autoSync must be true or false; using ${d.github.autoSync}`);
  }
  let owners: Record<string, unknown> = {};
  if (g.owners !== undefined) {
    if (isObject(g.owners)) owners = g.owners;
    else warn(`config ${file}: github.owners must be an object; using defaults`);
  }
  const ownerList = (key: 'include' | 'exclude'): string[] => {
    const v = owners[key];
    if (v === undefined) return [];
    if (isStringArray(v)) return v;
    warn(`config ${file}: github.owners.${key} must be an array of strings; using []`);
    return [];
  };

  const config: Config = {
    deviceId: (raw.deviceId as string | undefined) ?? newId(),
    weekStartsOn,
    projectAliases: (raw.projectAliases as Record<string, string> | undefined) ?? {},
    tagAliases: (raw.tagAliases as Record<string, string> | undefined) ?? {},
    ticketPrefixes: (tp as string[] | undefined) ?? [],
    staleAfterDays: posInt(raw.staleAfterDays, 'staleAfterDays', d.staleAfterDays),
    github: {
      autoSync,
      autoSyncMinutes: posInt(g.autoSyncMinutes, 'github.autoSyncMinutes', d.github.autoSyncMinutes),
      initialSyncDays: posInt(g.initialSyncDays, 'github.initialSyncDays', d.github.initialSyncDays),
      owners: { include: ownerList('include'), exclude: ownerList('exclude') },
    },
  };
  const changed = raw.deviceId === undefined || raw.projectAliases === undefined
    || raw.tagAliases === undefined || raw.ticketPrefixes === undefined;
  return { config, changed };
}
