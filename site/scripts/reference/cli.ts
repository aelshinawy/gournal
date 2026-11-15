import type { Argument, Command, Option } from 'commander';
import { code, table } from './markdown';

export interface GeneratedPage { path: string; content: string }

/**
 * Commander has no public accessor for a hidden command. Help.visibleCommands reads this field too.
 * Keep the private read in this one helper.
 */
function isHidden(cmd: Command): boolean {
  return Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
}

export interface Leaf { names: string[]; cmd: Command }

/** Collect leaf commands. Skip a command when it or any ancestor is hidden. Group parents get no page. */
function leaves(parent: Command, prefix: string[]): Leaf[] {
  const out: Leaf[] = [];
  for (const cmd of parent.commands) {
    if (isHidden(cmd)) continue;
    const names = [...prefix, cmd.name()];
    if (cmd.commands.length > 0) out.push(...leaves(cmd, names));
    else out.push({ names, cmd });
  }
  return out;
}

/** Visible leaf commands in program order. */
export function leafCommands(program: Command): Leaf[] {
  return leaves(program, []);
}

/** Visible leaf command names joined by a space, in program order. */
export function leafNames(program: Command): string[] {
  return leaves(program, []).map((l) => l.names.join(' '));
}

function argText(arg: Argument): string {
  const name = `${arg.name()}${arg.variadic ? '...' : ''}`;
  return arg.required ? `<${name}>` : `[${name}]`;
}

function visibleOptions(cmd: Command): Option[] {
  return cmd.options.filter((o) => !o.hidden);
}

function defaultText(opt: Option): string {
  if (opt.defaultValueDescription !== undefined) return code(opt.defaultValueDescription);
  if (opt.defaultValue === undefined) return '';
  if (opt.defaultValue === '') return '(empty)';
  return code(JSON.stringify(opt.defaultValue));
}

function usage(names: string[], cmd: Command): string {
  const parts = ['gournal', ...names, ...cmd.registeredArguments.map(argText)];
  if (visibleOptions(cmd).length > 0) parts.push('[options]');
  return parts.join(' ');
}

/** The rendered Markdown parts of one command. An empty string means the part is left out. */
export interface CliSection {
  /** Heading text, such as `gournal index rebuild`. */
  title: string;
  description: string;
  usage: string;
  args: string;
  options: string;
  example: string;
}

function argumentsTable(cmd: Command): string {
  const args = cmd.registeredArguments;
  if (args.length === 0) return '';
  return table(['Argument', 'Required', 'Description'], args.map((a) => [code(argText(a)), a.required ? 'yes' : 'no', a.description]));
}

function optionsTable(cmd: Command): string {
  const opts = visibleOptions(cmd);
  if (opts.length === 0) return '';
  const rows = opts.map((o) => [code(o.flags), o.description, defaultText(o)]);
  if (rows.every((r) => r[2] === '')) return table(['Option', 'Description'], rows.map((r) => r.slice(0, 2)));
  return table(['Option', 'Description', 'Default'], rows);
}

/**
 * Demote the headings of an example so the shallowest one sits at level 4, below `### CLI`.
 * Lines inside a code fence stay as they are.
 */
export function demoteHeadings(text: string): string {
  const lines = text.split('\n');
  const heading = /^(#{1,6})(\s.*)$/;
  let fenced = false;
  const isHeading = lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    return !fenced && !/^\s*(```|~~~)/.test(l) && heading.test(l);
  });
  const levels = lines.filter((_, i) => isHeading[i]).map((l) => heading.exec(l)![1].length);
  if (levels.length === 0) return text;
  const shift = Math.max(0, 4 - Math.min(...levels));
  return lines.map((l, i) => {
    if (!isHeading[i]) return l;
    const m = heading.exec(l)!;
    return `${'#'.repeat(Math.min(6, m[1].length + shift))}${m[2]}`;
  }).join('\n');
}

export function cliSection(names: string[], cmd: Command, example: string | undefined): CliSection {
  return {
    title: `gournal ${names.join(' ')}`,
    description: cmd.description(),
    usage: usage(names, cmd),
    args: argumentsTable(cmd),
    options: optionsTable(cmd),
    example: example === undefined || example.trim() === '' ? '' : demoteHeadings(example.trim()),
  };
}
