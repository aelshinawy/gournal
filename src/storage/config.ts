import fs from 'fs';
import path from 'path';
import { newId, normalizeConfig, type Config } from '../core';

export type { Config };

export interface LoadConfigHooks {
  /** Test seam. Runs after the read and before the new file is published. */
  beforePublish?: () => void;
  /** Receives config warnings. Default: stderr, once per distinct message per process. */
  warn?: (msg: string) => void;
}

const warned = new Set<string>();
function defaultWarn(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  process.stderr.write(`gournal: ${msg}\n`);
}

/** Only the Phase 1 keys are written. New settings stay out of the file. */
function persisted(raw: Record<string, unknown>, c: Config): Record<string, unknown> {
  return { ...raw, deviceId: c.deviceId, projectAliases: c.projectAliases, tagAliases: c.tagAliases, ticketPrefixes: c.ticketPrefixes };
}

function invalid(file: string, reason: string): Error {
  return new Error(`Config ${file} is not valid JSON object: ${reason}. Fix or delete it; gournal did not change it.`);
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

function tempPath(file: string): string {
  return path.join(path.dirname(file), `.config.${process.pid}.${newId()}.tmp`);
}

export function loadConfig(home: string, hooks: LoadConfigHooks = {}): Config {
  const file = path.join(home, 'config.json');
  const warn = hooks.warn ?? defaultWarn;
  fs.mkdirSync(home, { recursive: true });

  if (fs.existsSync(file)) {
    const raw = readRaw(file);
    const { config, changed } = normalizeConfig(file, raw, warn);
    if (changed) {
      // Existing file: atomic replace. The deviceId is already on disk, so it stays stable.
      const tmp = tempPath(file);
      try {
        fs.writeFileSync(tmp, JSON.stringify(persisted(raw, config), null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, file);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    return config;
  }

  // First run. Publish with a hard link: it fails if another process created the file first.
  const { config } = normalizeConfig(file, {}, warn);
  const tmp = tempPath(file);
  try {
    fs.writeFileSync(tmp, JSON.stringify(persisted({}, config), null, 2) + '\n', 'utf8');
    hooks.beforePublish?.();
    try {
      fs.linkSync(tmp, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      // Another process won. Use the deviceId it wrote.
      return normalizeConfig(file, readRaw(file), warn).config;
    }
    return config;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
