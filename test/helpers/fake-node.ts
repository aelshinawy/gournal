import fs from 'fs';
import path from 'path';

/** A fake node, a 0755 sh script. Its `-e` probe exits 0 or 1 by `passes`. Otherwise it prints its path, arguments, and GOURNAL_HOME. */
export function writeFakeNode(file: string, passes: boolean): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    '#!/bin/sh',
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
