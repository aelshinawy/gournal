#!/usr/bin/env node
import './adapters/suppress-warnings';
import { runCli } from './adapters/cli';

runCli(process.argv).then((code) => {
  process.exitCode = code;
});
