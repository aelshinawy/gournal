import fs from 'fs';
import path from 'path';
import { writeViaTemp } from '../../storage';

export type Json = Record<string, unknown>;
export const SERVER = 'gournal';

/**
 * Write through a symlink: the temp file goes next to the real target, so the link stays a link.
 * An existing file keeps its mode through the copy, so its temp starts private. Windows has no mode bits to keep, and a read-only copy would
 * block the rename, so it skips the copy.
 */
export function writeAtomic(file: string, content: string, platform: NodeJS.Platform): void {
  const real = fs.existsSync(file) ? fs.realpathSync(file) : file;
  fs.mkdirSync(path.dirname(real), { recursive: true });
  writeViaTemp(
    real,
    (tmp) => {
      fs.writeFileSync(tmp, content, 'utf8');
      if (platform !== 'win32' && fs.existsSync(real)) fs.chmodSync(tmp, fs.statSync(real).mode & 0o7777);
    },
    { mode: fs.existsSync(real) ? 0o600 : 0o666, rename: { platform } },
  );
}

export type SettingsRead = { kind: 'ok'; settings: Json; exists: boolean } | { kind: 'invalid' };

export function readSettings(file: string): SettingsRead {
  if (!fs.existsSync(file)) return { kind: 'ok', settings: {}, exists: false };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { kind: 'ok', settings: parsed as Json, exists: true };
    }
  } catch { /* fall through */ }
  return { kind: 'invalid' };
}

export function readRegistration(claudeJson: string): { command: string; args: string[] } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(claudeJson, 'utf8')) as { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
    const s = parsed.mcpServers?.[SERVER];
    if (!s) return null;
    return {
      command: typeof s.command === 'string' ? s.command : '',
      args: Array.isArray(s.args) ? s.args.map(String) : [],
    };
  } catch {
    return null;
  }
}
