#!/usr/bin/env node
import './adapters/suppress-warnings';
import { runCli } from './adapters/cli';

// A reader that closes the pipe early (`gournal export | head -1`) is not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

runCli(process.argv).then((code) => {
  process.exitCode = code;
});
