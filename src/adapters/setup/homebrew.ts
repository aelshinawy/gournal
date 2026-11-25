import fs from 'fs';

export interface HomebrewInstall {
  prefix: string;
  node: string;
  source: string;
}

const CELLAR = /^(.+)\/Cellar\/gournal\/[^/]+\/libexec\/lib\/node_modules\/gournal$/;

/**
 * Find out whether the package runs from a Homebrew install.
 * Return the stable `opt` paths that stay valid after `brew upgrade`. Return null when it does not.
 */
export function detectHomebrew(
  packageRoot: string,
  platform: NodeJS.Platform,
  exists: (file: string) => boolean = fs.existsSync,
): HomebrewInstall | null {
  if (platform === 'win32') return null;
  let real: string;
  try {
    real = fs.realpathSync(packageRoot);
  } catch {
    return null;
  }
  const match = CELLAR.exec(real);
  if (!match) return null;
  const prefix = match[1]!;
  const node = `${prefix}/opt/node/bin/node`;
  const source = `${prefix}/opt/gournal/libexec/lib/node_modules/gournal`;
  if (!exists(node) || !exists(`${source}/dist/cli.js`)) return null;
  return { prefix, node, source };
}
