import fs from 'fs';
import path from 'path';
import { invalidConfig, isPlainObject, normalizeConfig, type Config } from '../core';
import { ensurePrivateDir, publishExclusive, sleepSync, tightenFile, writeViaTemp } from './private-files';

export type { Config };

export interface LoadConfigHooks {
  /** Test seam. Runs after the read and before the new file is published. */
  beforePublish?: () => void;
  /** Receives config warnings. Default: stderr, once per distinct message per process. */
  warn?: (msg: string) => void;
  /** Test seam. Waits between two polls of an empty config file. Default: a blocking sleep. */
  sleep?: (ms: number) => void;
  /** Test seam. The clock for the wait on an empty config file. Default: Date.now. */
  now?: () => number;
}

/** How long to wait for an empty config file to get its content, and how often to look. */
const EMPTY_WAIT_MS = 500;
const EMPTY_POLL_MS = 20;

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

function readRaw(file: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw invalidConfig(file, (err as Error).message);
  }
  if (!isPlainObject(parsed)) throw invalidConfig(file, 'the value is not an object');
  return parsed;
}

type Wait = Pick<LoadConfigHooks, 'sleep' | 'now'>;

/**
 * Wait up to 500 ms, polling every 20 ms, for a config file to get content. A first run without
 * hard links creates the file empty and then renames the finished file onto it.
 * It returns 'missing' when the file is gone, and 'empty' when it is still empty after the wait.
 */
function waitForContent(file: string, wait: Wait): 'ready' | 'empty' | 'missing' {
  const sleep = wait.sleep ?? sleepSync;
  const now = wait.now ?? Date.now;
  const deadline = now() + EMPTY_WAIT_MS;
  for (;;) {
    try {
      if (fs.statSync(file).size > 0) return 'ready';
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw err;
    }
    if (now() >= deadline) return 'empty';
    sleep(EMPTY_POLL_MS);
  }
}

function emptyConfig(file: string): Error {
  return new Error(`Config ${file} is empty. An earlier first run was interrupted. Delete the file and run gournal again.`);
}

/** Read a config file that exists. An empty file gets the bounded wait first. gournal never repairs or deletes it. */
function readExisting(file: string, wait: Wait): Record<string, unknown> {
  if (waitForContent(file, wait) === 'empty') throw emptyConfig(file);
  return readRaw(file);
}

/** Read the config file and apply the environment override. GOURNAL_NO_AUTOSYNC=1 turns auto-sync off. The file stays unchanged. */
export function loadConfig(home: string, hooks: LoadConfigHooks = {}): Config {
  const config = loadConfigFile(home, hooks);
  if (process.env.GOURNAL_NO_AUTOSYNC === '1') return { ...config, github: { ...config.github, autoSync: false } };
  return config;
}

function loadConfigFile(home: string, hooks: LoadConfigHooks): Config {
  const file = path.join(home, 'config.json');
  const warn = hooks.warn ?? defaultWarn;
  ensurePrivateDir(home);

  if (fs.existsSync(file)) {
    tightenFile(file);
    const raw = readExisting(file, hooks);
    const { config, changed } = normalizeConfig(file, raw, warn);
    if (changed) {
      // Existing file: atomic replace. The deviceId is already on disk, so it stays stable.
      const json = JSON.stringify(persisted(raw, config), null, 2) + '\n';
      writeViaTemp(file, (tmp) => fs.writeFileSync(tmp, json, 'utf8'));
    }
    return config;
  }

  // First run. Publish without replacing: a hard link fails if another process created the file first.
  // Without hard links, publishExclusive claims the file with an exclusive create. Either way the loser gets EEXIST.
  const { config } = normalizeConfig(file, {}, warn);
  const json = JSON.stringify(persisted({}, config), null, 2) + '\n';
  return writeViaTemp(file, (tmp) => fs.writeFileSync(tmp, json, 'utf8'), {
    publish: (tmp) => {
      hooks.beforePublish?.();
      for (let attempt = 0; ; attempt++) {
        let how: 'link' | 'rename';
        try {
          how = publishExclusive(tmp, file);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
          // Another process won. Use the deviceId it wrote.
          const state = waitForContent(file, hooks);
          if (state === 'empty') throw emptyConfig(file);
          // The winner removed its claim, because its own rename failed. Publish once more.
          if (state === 'missing' && attempt === 0) continue;
          return normalizeConfig(file, readRaw(file), warn).config;
        }
        if (how === 'link') return config;
        // The fallback path: use what is on disk.
        return normalizeConfig(file, readRaw(file), warn).config;
      }
    },
  });
}
