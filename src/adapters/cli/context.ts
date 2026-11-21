import fs from 'fs';
import path from 'path';
import type { Command } from 'commander';
import type { GhRunner } from '../../sources';
import type { CommandRunner } from '../setup';
import { createEntryWriter, type EntryWriter } from '../entry-writer';
import { openJournal, type Journal } from '../../storage';
import type { SpinnerStream } from './spinner';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  home: string;
  isTTY: boolean;
  /** Test seam. The default runs the real gh. */
  gh?: GhRunner;
  /** The user's home, for `setup claude`. `home` above is the gournal home. Default: the profile folder at call time (os.homedir(), or USERPROFILE on Windows). */
  userHome?: string;
  /** Test seam for the clear and setup claude prompts. The default asks on the terminal with readline. */
  confirm?: (message: string, def: boolean) => Promise<boolean>;
  /** Test seam for `setup claude`. The default runs the claude CLI with execFile, no shell. */
  exec?: CommandRunner;
  /** Test seam for the spinner. The default is process.stderr. */
  spinnerStream?: SpinnerStream;
}

export interface CliContext {
  io: CliIo;
  /** Open the journal once for a command and close it when the command ends. */
  withJournal<T>(fn: (journal: Journal) => T | Promise<T>): Promise<T>;
  /** A failed daily backup warns and never stops the command. */
  backupWithWarning(journal: Journal): void;
  writerFor(journal: Journal): EntryWriter;
}

/** Each register<Command> function has this shape. */
export type RegisterCommand = (program: Command, ctx: CliContext) => void;

export function createCliContext(io: CliIo): CliContext {
  return {
    io,
    withJournal: async (fn) => {
      const journal = openJournal(io.home);
      try {
        // Only the CLI prints this. A migrated journal has entries (even soft-deleted ones), so it never sees it.
        if (fs.existsSync(path.join(io.home, 'entries.json')) && journal.repo.find({ includeDeleted: true, limit: 1 }).length === 0) {
          io.err('gournal: entries.json from 0.x is no longer read. Install gournal@0.10, run gournal migrate, then upgrade.');
        }
        return await fn(journal);
      } finally {
        journal.close();
      }
    },
    backupWithWarning: (journal) => {
      try {
        journal.backupIfNeeded();
      } catch (err) {
        io.err(`gournal: daily backup failed: ${(err as Error).message}`);
      }
    },
    writerFor: (journal) => createEntryWriter(journal, { retryMemory: false, clock: Date.now }),
  };
}
