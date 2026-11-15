import type { Argument, Command, Option } from 'commander';
import { GENERATED_NOTE, code, firstSentence, frontmatter, table } from './markdown';

export interface GeneratedPage { path: string; content: string }

/**
 * Commander has no public accessor for a hidden command. Help.visibleCommands reads this field too.
 * Keep the private read in this one helper.
 */
function isHidden(cmd: Command): boolean {
  return Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
}

interface Leaf { names: string[]; cmd: Command }

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

function page(slug: string, names: string[], cmd: Command, example: string | undefined): GeneratedPage {
  const title = `gournal ${names.join(' ')}`;
  const description = cmd.description();
  const lines: string[] = [
    frontmatter(title, firstSentence(description)).trimEnd(),
    `<!-- ${GENERATED_NOTE} Edit examples in site/src/content/examples/cli/${slug}.md. -->`,
    '',
    description,
    '',
    '## Usage',
    '',
    `    ${usage(names, cmd)}`,
  ];
  const opts = visibleOptions(cmd);
  if (opts.length > 0) {
    lines.push('', '## Options', '');
    lines.push(table(['Option', 'Description', 'Default'], opts.map((o) => [code(o.flags), o.description, defaultText(o)])));
  }
  if (example !== undefined && example.trim() !== '') {
    lines.push('', '## Examples', '', example.trim());
  }
  return { path: `cli/${slug}.md`, content: `${lines.join('\n')}\n` };
}

/** One page per visible leaf command, sorted by slug. `examples` maps a slug to its example text. */
export function cliPages(program: Command, examples: Map<string, string>): GeneratedPage[] {
  return leaves(program, [])
    .map(({ names, cmd }) => ({ slug: names.join('-'), names, cmd }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map(({ slug, names, cmd }) => page(slug, names, cmd, examples.get(slug)));
}
