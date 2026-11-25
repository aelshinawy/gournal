import { Command, CommanderError } from 'commander';
import { red } from '../../render';
import { VERSION } from '../version';
import { gournalHome } from '../../storage';
import { PACKAGE_ROOT, adoptInstalledPackage, installGate, type GateResult } from '../setup';
import { createCliContext, type CliIo, type RegisterCommand } from './context';
import { registerAdd, registerClear, registerUndo, registerRestore, registerResolve, registerTags, registerProjects, registerFind } from './entries';
import { registerStandup, registerLog, registerStats, registerExport } from './reports';
import { registerImport, registerIndex } from './journal';
import { registerSync } from './sync';
import { registerSetup, registerHook, registerMcp } from './setup';

const stripNewline = (text: string): string => text.replace(/\n$/, '');

const COMMANDS: RegisterCommand[] = [
  registerAdd,
  registerClear,
  registerUndo,
  registerRestore,
  registerResolve,
  registerStandup,
  registerLog,
  registerStats,
  registerTags,
  registerProjects,
  registerExport,
  registerImport,
  registerFind,
  registerIndex,
  registerSync,
  registerSetup,
  registerHook,
  registerMcp,
];

export function buildProgram(io: CliIo): Command {
  const program = new Command();
  const ctx = createCliContext(io);

  program
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.out(stripNewline(text)),
      writeErr: (text) => io.err(stripNewline(text)),
    })
    .name('gournal')
    .description('CLI development journal with Git integration')
    .version(VERSION);

  for (const register of COMMANDS) register(program, ctx);

  return program;
}

export async function runCli(argv: string[], io: Partial<CliIo> = {}): Promise<number> {
  const full: CliIo = {
    out: io.out ?? ((text) => { process.stdout.write(`${text}\n`); }),
    err: io.err ?? ((text) => { process.stderr.write(`${text}\n`); }),
    cwd: io.cwd ?? process.cwd(),
    home: io.home ?? gournalHome(),
    isTTY: io.isTTY ?? process.stdin.isTTY === true,
    gh: io.gh,
    spinnerStream: io.spinnerStream,
  };
  let gate: GateResult = { kind: 'run' };
  try {
    gate = installGate({
      argv,
      packageRoot: io.packageRoot ?? PACKAGE_ROOT,
      gournalHome: full.home,
      now: (io.now ?? (() => new Date()))(),
      platform: process.platform,
    });
  } catch {
    // The gate never stops a command by failing. Run it.
  }
  // The message goes to stderr as plain text. Stdout belongs to the MCP protocol. An empty message stays silent.
  if (gate.kind === 'exit') {
    if (gate.message) full.err(gate.message);
    return gate.code;
  }
  if (gate.notice) full.err(gate.notice);
  try {
    adoptInstalledPackage(full.home, { packageRoot: io.packageRoot });
  } catch {
    // Adoption is best effort. It never fails a command.
  }
  try {
    await buildProgram(full).parseAsync(argv);
    return 0;
  } catch (err) {
    // Commander has already written its own help, version, and usage errors.
    if (err instanceof CommanderError) return err.exitCode;
    full.err(red(err instanceof Error ? err.message : String(err)));
    return 1;
  }
}
