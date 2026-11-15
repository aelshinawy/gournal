import fs from 'fs';
import path from 'path';
import { newId } from '../core';

export interface Config {
  deviceId: string;
  projectAliases: Record<string, string>;
  tagAliases: Record<string, string>;
  ticketPrefixes: string[];
}

export interface LoadConfigHooks {
  /** Test seam. Runs after the read and before the new file is published. */
  beforePublish?: () => void;
}

function invalid(file: string, reason: string): Error {
  return new Error(`Config ${file} is not valid JSON object: ${reason}. Fix or delete it; gournal did not change it.`);
}

function isStringMap(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && Object.values(v).every((x) => typeof x === 'string');
}

function readRaw(file: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw invalid(file, (err as Error).message);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid(file, 'the value is not an object');
  }
  return parsed as Record<string, unknown>;
}

/** Validate and fill. Returns the config and whether the file needs to be rewritten. */
function normalize(file: string, raw: Record<string, unknown>): { config: Config; changed: boolean } {
  if (raw.deviceId !== undefined && (typeof raw.deviceId !== 'string' || !raw.deviceId)) {
    throw invalid(file, 'deviceId must be a non-empty string');
  }
  for (const key of ['projectAliases', 'tagAliases'] as const) {
    if (raw[key] !== undefined && !isStringMap(raw[key])) throw invalid(file, `${key} must be an object of strings`);
  }
  const tp = raw.ticketPrefixes;
  if (tp !== undefined && !(Array.isArray(tp) && tp.every((x) => typeof x === 'string'))) {
    throw invalid(file, 'ticketPrefixes must be an array of strings');
  }
  const config: Config = {
    deviceId: (raw.deviceId as string | undefined) ?? newId(),
    projectAliases: (raw.projectAliases as Record<string, string> | undefined) ?? {},
    tagAliases: (raw.tagAliases as Record<string, string> | undefined) ?? {},
    ticketPrefixes: (tp as string[] | undefined) ?? [],
  };
  const changed = raw.deviceId === undefined || raw.projectAliases === undefined
    || raw.tagAliases === undefined || raw.ticketPrefixes === undefined;
  return { config, changed };
}

function tempPath(file: string): string {
  return path.join(path.dirname(file), `.config.${process.pid}.${newId()}.tmp`);
}

export function loadConfig(home: string, hooks: LoadConfigHooks = {}): Config {
  const file = path.join(home, 'config.json');
  fs.mkdirSync(home, { recursive: true });

  if (fs.existsSync(file)) {
    const raw = readRaw(file);
    const { config, changed } = normalize(file, raw);
    if (changed) {
      // Existing file: atomic replace. The deviceId is already on disk, so it stays stable.
      const tmp = tempPath(file);
      try {
        fs.writeFileSync(tmp, JSON.stringify({ ...raw, ...config }, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, file);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return config;
  }

  // First run. Publish with a hard link: it fails if another process created the file first.
  const { config } = normalize(file, {});
  const tmp = tempPath(file);
  try {
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    hooks.beforePublish?.();
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Another process won. Use the deviceId it wrote.
      return normalize(file, readRaw(file)).config;
    }
    return config;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
