import { Command, CommanderError } from 'commander';
import { startMcpServer } from '../mcp';
import { red } from '../../render';
import { VERSION } from '../version';
import { confirmOrNo } from './confirm';
import { execFileRunner, setupClaude, stopHook } from '../setup';
import { gournalHome, userHomePath } from '../../storage';
import { createCliContext, type CliIo, type CliContext, type RegisterCommand } from './context';
import { registerAdd, registerClear, registerUndo, registerRestore, registerResolve, registerTags, registerProjects, registerFind } from './entries';
import { registerStandup, registerLog, registerStats, registerExport } from './reports';
import { registerImport, registerMigrate, registerIndex } from './journal';
import { registerSync } from './sync';

const stripNewline = (text: string): string => text.replace(/\n$/, '');

function registerSetup(program: Command, ctx: CliContext): void {
  const setup = program.command('setup').description('Set gournal up for another tool.');
  setup
    .command('claude')
    .description('Register the gournal MCP server and install the gournal skill for Claude Code. You can also add a Stop hook.')
    .option('--uninstall', 'Remove the MCP server, the skill, and the hook that setup added.')
    .option('-y, --yes', 'Answer yes to the install and removal prompts. On a terminal, the prompt to replace an existing MCP registration still asks. Without a terminal and without this option, setup prints its plan and exits with code 1.')
    .option('--hook', 'Also add the Stop hook. The hook reminds Claude to log its work. With --yes, the hook is added only when you pass this option. Before it changes an existing settings.json, setup saves a copy as settings.json.gournal-backup if that file does not exist yet.')
    .action(async (options: { uninstall?: boolean; yes?: boolean; hook?: boolean }) => {
      const code = await setupClaude({
        out: ctx.io.out, err: ctx.io.err, isTTY: ctx.io.isTTY,
        home: ctx.io.userHome ?? userHomePath(),
        confirm: ctx.io.confirm ?? confirmOrNo,
        exec: ctx.io.exec ?? execFileRunner,
      }, { uninstall: options.uninstall === true, yes: options.yes === true, hook: options.hook === true });
      if (code !== 0) throw new CommanderError(code, 'gournal.setup', 'setup did not finish'); // setup already printed why
    });
}

function registerHook(program: Command, ctx: CliContext): void {
  const hook = program.command('hook', { hidden: true }).description('Claude Code hook entry points.');
  hook
    .command('stop')
    .description('Stop hook. Ask the agent to log edited work once per session.')
    .action(async () => {
      // Never opens the database. Never fails: any error means no output and exit 0.
      let stdin = '';
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        stdin = Buffer.concat(chunks).toString('utf8');
      } catch {
        return;
      }
      const result = await stopHook(stdin, ctx.io.home, new Date());
      if (result !== null) ctx.io.out(result);
    });
}

function registerMcp(program: Command, ctx: CliContext): void {
  program
    .command('mcp')
    .description('Start the gournal MCP server on stdio. It offers entries, standup reports, work logs, and export as tools.')
    .action(async () => {
      await startMcpServer();
    });
}

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
  registerMigrate,
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
  };
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
