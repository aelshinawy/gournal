/** The Node.js that runs setup, and the cmd.exe path that a Windows registration uses. */
export interface CommandEnv { execPath: string; cmdExe: string }
export interface GournalCommand { command: string; args: string[] }

/** Quote one shell word when it holds characters that a shell would split or expand. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote one word for the manual `claude mcp add` line that setup prints.
 * POSIX shells get single quotes. On Windows, a word that needs quoting gets double quotes, which
 * PowerShell and cmd both accept.
 */
export function displayQuote(word: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return shellQuote(word);
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `"${word}"`;
}

/** The last path part. It splits on both `/` and `\\`, so a Windows path works on any platform. */
export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? '';

/**
 * True when `node <script>` starts gournal: the command is Node, and the script is named `gournal`
 * or is a `cli.js` that sits under a directory named `gournal` (any case, either separator).
 * A `cli.js` elsewhere belongs to another tool.
 */
export function isGournalNodeLaunch(nodeCommand: string, script: string): boolean {
  const node = baseName(nodeCommand).toLowerCase();
  if (node !== 'node' && node !== 'node.exe') return false;
  const parts = script.split(/[\\/]/);
  const name = parts.pop();
  if (name === 'gournal') return true;
  return name === 'cli.js' && parts.some((d) => d.toLowerCase() === 'gournal');
}

/** How a registered command relates to the one setup writes now. */
/** True for `/d /c <gournal.cmd> ...tail`, the way setup runs the Windows launcher through cmd.exe. */
export function isLauncherCmd(args: string[], tail: string[]): boolean {
  return args.length === 3 + tail.length && args[0] === '/d' && args[1] === '/c' && baseName(args[2]!).toLowerCase() === 'gournal.cmd' && tail.every((t, i) => args[3 + i] === t);
}

export type RegistrationKind = 'current' | 'gournal' | 'foreign';

/**
 * Classify a registered MCP command. `gournal` means a form that gournal wrote in the past, or
 * a launcher at another path. Anything else is `foreign`, so setup never replaces a command it did not write.
 */
export function classifyRegistration(reg: GournalCommand, current: GournalCommand): RegistrationKind {
  if (reg.command === current.command && JSON.stringify(reg.args) === JSON.stringify(current.args)) return 'current';
  const { args } = reg;
  const cmd = baseName(reg.command);
  // This match is case-sensitive on purpose: setup writes `gournal` in lower case. The branches below lower the case, because Windows names have any case.
  if (cmd === 'gournal') return args.length === 1 && args[0] === 'mcp' ? 'gournal' : 'foreign';
  const lower = cmd.toLowerCase();
  if (lower === 'node' || lower === 'node.exe') {
    return args.length === 2 && args[1] === 'mcp' && isGournalNodeLaunch(reg.command, args[0]!) ? 'gournal' : 'foreign';
  }
  if (lower === 'cmd.exe') {
    return isLauncherCmd(args, ['mcp']) ? 'gournal' : 'foreign';
  }
  return 'foreign';
}
