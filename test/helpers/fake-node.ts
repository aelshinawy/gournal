import fs from 'fs';
import path from 'path';

/**
 * Write a fake node executable (a 0755 sh script).
 * With `-e` as the first argument, it acts as the version probe and exits 0 or 1 by `passes`.
 * A passing probe first reads all of stdin and drops it.
 * Otherwise it prints its own path, its arguments, GOURNAL_HOME, and then its stdin.
 * It calls /bin/cat by absolute path, so it works with an empty PATH.
 */
export function writeFakeNode(file: string, passes: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '#!/bin/sh',
    // A passing probe drains stdin, so a launcher that lets the probe read its stdin loses the input.
    `if [ "$1" = -e ]; then ${passes ? '/bin/cat >/dev/null; exit 0' : 'exit 1'}; fi`,
    'echo "node=$0"',
    'echo "args=$*"',
    'echo "home=${GOURNAL_HOME-unset}"',
    '/bin/cat',
    '',
  ];
  fs.writeFileSync(file, lines.join('\n'), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
}
