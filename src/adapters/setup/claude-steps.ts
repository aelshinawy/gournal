import fs from 'fs';
import path from 'path';
import { SKILL_MARKER, SKILL_MD } from './skill';
import { addStopHook, removeStopHook } from './settings';
import { writeAtomic, readSettings, type Json, type SettingsRead } from './claude-files';
import { ask, planCommand, type Ctx } from './claude-ctx';

export async function installSkill(c: Ctx): Promise<void> {
  const { io, skillFile } = c;
  const current = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : null;
  if (current === SKILL_MD) io.out('Skill: already set up.');
  else if (current !== null && !current.includes(SKILL_MARKER)) {
    io.out(`Skill: ${skillFile} exists and gournal did not write it. Left alone.`);
  } else {
    io.out(`Skill: ${current === null ? 'write' : 'update'} ${skillFile}.`);
    if (await ask(c, 'Install the gournal skill?', true)) {
      writeAtomic(skillFile, SKILL_MD, c.platform);
      io.out('Skill: installed.');
    } else io.out('Skill: skipped.');
  }
}

export async function uninstallSkill(c: Ctx): Promise<void> {
  const { io, skillFile } = c;
  if (!fs.existsSync(skillFile)) io.out('Skill: not set up.');
  else if (!fs.readFileSync(skillFile, 'utf8').includes(SKILL_MARKER)) {
    io.out(`Skill: ${skillFile} was not written by gournal. Left alone.`);
  } else {
    io.out(`Skill: remove ${skillFile}.`);
    if (await ask(c, 'Remove the gournal skill?', true)) {
      fs.rmSync(skillFile, { force: true });
      try { fs.rmdirSync(path.dirname(skillFile)); } catch { /* not empty: keep it */ }
      io.out('Skill: removed.');
    } else io.out('Skill: kept.');
  }
}

type SettingsOk = Extract<SettingsRead, { kind: 'ok' }>;

/** Read settings.json. An invalid file gets one message and null. */
function readSettingsOrWarn(c: Ctx): SettingsOk | null {
  const read = readSettings(c.settingsFile);
  if (read.kind === 'ok') return read;
  c.io.err(`Stop hook: ${c.settingsFile} is not a valid JSON object. Gournal did not change it.`);
  return null;
}

function saveSettings(c: Ctx, read: SettingsOk, next: Json, takeBackup: boolean): void {
  // Keep the first backup: it holds the file as it was before gournal. Only install takes it.
  if (takeBackup && read.exists && !fs.existsSync(c.backupFile)) fs.copyFileSync(c.settingsFile, c.backupFile);
  writeAtomic(c.settingsFile, JSON.stringify(next, null, 2) + '\n', c.platform);
}

export async function installHook(c: Ctx): Promise<number> {
  const { io, opts, settingsFile, backupFile } = c;
  if (opts.yes && !opts.hook) {
    io.out('Stop hook: not enabled (add --hook to enable it).');
    return 0;
  }
  const read = readSettingsOrWarn(c);
  if (!read) return 1;
  const { next, changed, action } = addStopHook(read.settings, c.hook);
  if (!changed) {
    io.out('Stop hook: already set up.');
    return 0;
  }
  const plan = action === 'updated'
    ? `update the gournal hook in ${settingsFile} to ${planCommand(c)}`
    : `add ${planCommand(c)} to ${settingsFile}`;
  io.out(`Stop hook: ${plan}${read.exists ? ` (backup: ${backupFile})` : ''}.`);
  if (await ask(c, action === 'updated' ? 'Update the gournal Stop hook?' : 'Add the gournal Stop hook?', opts.hook)) {
    saveSettings(c, read, next, true);
    io.out(`Stop hook: ${action}.`);
  } else io.out('Stop hook: skipped.');
  return 0;
}

export async function uninstallHook(c: Ctx): Promise<number> {
  const { io, settingsFile, backupFile } = c;
  const read = readSettingsOrWarn(c);
  if (!read) return 1;
  const { next, changed } = removeStopHook(read.settings, c.hook);
  if (!changed) {
    io.out('Stop hook: not set up.');
    return 0;
  }
  // Only a backup that install took before its first write holds the original file.
  const hasOriginal = fs.existsSync(backupFile);
  io.out(`Stop hook: remove the gournal hook from ${settingsFile}${hasOriginal ? ` (original backup: ${backupFile})` : ''}.`);
  if (await ask(c, 'Remove the gournal Stop hook?', true)) {
    saveSettings(c, read, next, false);
    io.out(`Stop hook: removed.${hasOriginal ? ` The original file is kept at ${backupFile}.` : ''}`);
  } else io.out('Stop hook: kept.');
  return 0;
}
