import fs from 'fs';
import path from 'path';
import { makeFakePackage } from './fake-package';

/** Build a fake Homebrew prefix: a Cellar package, the opt links, and an executable opt node. */
export function makeFakeBrew(root: string, version: string): { prefix: string; packageRoot: string } {
  const prefix = path.join(root, 'prefix');
  const cellar = path.join(prefix, 'Cellar', 'gournal', version);
  const packageRoot = makeFakePackage(path.join(cellar, 'libexec', 'lib', 'node_modules', 'gournal'), version);
  fs.mkdirSync(path.join(prefix, 'opt'), { recursive: true });
  fs.symlinkSync(path.join('..', 'Cellar', 'gournal', version), path.join(prefix, 'opt', 'gournal'));
  const nodeFile = path.join(prefix, 'opt', 'node', 'bin', 'node');
  fs.mkdirSync(path.dirname(nodeFile), { recursive: true });
  fs.writeFileSync(nodeFile, '#!/bin/sh\n', { mode: 0o755 });
  return { prefix, packageRoot };
}
