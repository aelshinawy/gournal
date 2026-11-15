import fs from 'fs';
import path from 'path';
import { newId } from '../core';

export interface Config {
  deviceId: string;
  projectAliases: Record<string, string>;
  tagAliases: Record<string, string>;
  ticketPrefixes: string[];
}

function isRecord(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function writeAtomic(file: string, data: string): void {
  const tmp = path.join(path.dirname(file), `.config.${process.pid}.${newId()}.tmp`);
  try {
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

export function loadConfig(home: string): Config {
  const file = path.join(home, 'config.json');
  fs.mkdirSync(home, { recursive: true });
  let raw: any = {};
  if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config: Config = {
    deviceId: typeof raw.deviceId === 'string' && raw.deviceId ? raw.deviceId : newId(),
    projectAliases: isRecord(raw.projectAliases) ? raw.projectAliases : {},
    tagAliases: isRecord(raw.tagAliases) ? raw.tagAliases : {},
    ticketPrefixes: Array.isArray(raw.ticketPrefixes) ? raw.ticketPrefixes.filter((p: unknown) => typeof p === 'string') : [],
  };
  if (raw.deviceId !== config.deviceId) writeAtomic(file, JSON.stringify({ ...raw, ...config }, null, 2) + '\n');
  return config;
}
