// This file runs before node:sqlite loads. Use only syntax that Node 14 parses.
import { enforceNodeFloor } from './node-guard';

enforceNodeFloor({
  argv: process.argv,
  version: process.versions.node,
  execPath: process.execPath,
  hasSqlite: () => {
    try {
      require('node:sqlite');
      return true;
    } catch {
      return false;
    }
  },
  write: (t) => process.stderr.write(t),
  exit: (c) => process.exit(c),
});
