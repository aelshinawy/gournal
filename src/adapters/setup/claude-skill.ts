import fs from 'fs';
import path from 'path';
import { SKILL_MARKER, SKILL_MD } from './skill';
import { writeAtomic } from './claude-files';
import type { Ctx } from './claude-ctx';

export async function installSkill(c: Ctx): Promise<void> {
  const { io, skillFile } = c;
  const current = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : null;
  if (current === SKILL_MD) io.out('Skill: already set up.');
  else if (current !== null && !current.includes(SKILL_MARKER)) {
    io.out(`Skill: ${skillFile} exists and gournal did not write it. Left alone.`);
  } else {
    io.out(`Skill: ${current === null ? 'write' : 'update'} ${skillFile}.`);
    if (await c.ask('Install the gournal skill?', true)) {
      writeAtomic(skillFile, SKILL_MD, c.platform);
      io.out('Skill: installed.');
    } else io.out('Skill: skipped.');
  }
}

export async function uninstallSkill(c: Ctx): Promise<void> {
  const { io, skillFile } = c;
  if (!fs.existsSync(skillFile)) return void io.out('Skill: not set up.');
  if (!fs.readFileSync(skillFile, 'utf8').includes(SKILL_MARKER)) {
    return void io.out(`Skill: ${skillFile} was not written by gournal. Left alone.`);
  }
  io.out(`Skill: remove ${skillFile}.`);
  if (await c.ask('Remove the gournal skill?', true)) {
    fs.rmSync(skillFile, { force: true });
    try { fs.rmdirSync(path.dirname(skillFile)); } catch { /* not empty: keep it */ }
    io.out('Skill: removed.');
  } else io.out('Skill: kept.');
}
