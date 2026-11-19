import { styleText } from 'node:util';

// The one place that adds ANSI codes. Color is on when stdout is a TTY that supports it.
// Node reads NO_COLOR, FORCE_COLOR, and TERM for that check.
// @types/node 22.12 has no options argument for styleText, so this alias adds it.
const paint = styleText as (
  format: Parameters<typeof styleText>[0],
  text: string,
  options: { validateStream: boolean; stream: NodeJS.WriteStream },
) => string;

let forced: boolean | undefined;

/** Test seam. true forces color on, false forces it off, undefined uses the stream check. Returns the previous value. */
export function forceColor(on: boolean | undefined): boolean | undefined {
  const prev = forced;
  forced = on;
  return prev;
}

type Format = Parameters<typeof styleText>[0];

const style = (format: Format) => (text: string): string =>
  forced === false ? text : paint(format, text, { validateStream: forced !== true, stream: process.stdout });

export const bold = style('bold');
export const gray = style('gray');
export const blue = style('blue');
export const magenta = style('magenta');
export const yellow = style('yellow');
export const green = style('green');
export const red = style('red');
export const blueBold = style(['blue', 'bold']);
export const greenBold = style(['green', 'bold']);
export const redBold = style(['red', 'bold']);
export const yellowBold = style(['yellow', 'bold']);
