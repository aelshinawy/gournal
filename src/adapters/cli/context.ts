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
  /** Test seam for the runtime refresh after an upgrade. The default copies the installed package into the gournal home when it is newer. */
  runtimeRefresh?: (gournalHome: string) => void;
}

export interface CliContext {
  io: CliIo;
  /** Open the journal once for a command and close it when the command ends. */
  withJournal<T>(fn: (journal: Journal) => T | Promise<T>, opts?: { legacyImport?: boolean }): Promise<T>;
  /** A failed daily backup warns and never stops the command. */
  backupWithWarning(journal: Journal): void;
  writerFor(journal: Journal): EntryWriter;
}

/** Each register<Command> function has this shape. */
export type RegisterCommand = (program: Command, ctx: CliContext) => void;

export function createCliContext(io: CliIo): CliContext {
  return {
    io,
    withJournal: async (fn, opts = {}) => {
      const journal = openJournal(io.home, opts);
      try {
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
