// This file runs before node:sqlite loads. Use only syntax that Node 14 parses.
export const NODE_FLOOR = { major: 22, minor: 13 } as const;

export interface GuardDeps {
  argv: string[];
  version: string;
  execPath: string;
  hasSqlite: () => boolean;
  write: (text: string) => void;
  exit: (code: number) => void;
}

/** Return a message when this Node cannot run gournal. Return null when it can. */
export function nodeProblem(version: string, execPath: string, hasSqlite: () => boolean): string | null {
  const [major, minor] = version.split('.').map(Number);
  const good = major > NODE_FLOOR.major || (major === NODE_FLOOR.major && minor >= NODE_FLOOR.minor);
  if (!good) {
    const floor = `${NODE_FLOOR.major}.${NODE_FLOOR.minor}`;
    return `gournal needs Node.js ${floor} or newer. This is Node.js ${version} at ${execPath}. Switch to Node.js ${floor} or newer and run the command again.`;
  }
  if (!hasSqlite()) {
    return `gournal needs the node:sqlite module. The Node.js ${version} build at ${execPath} does not have it. Install an official Node.js build.`;
  }
  return null;
}

/** Stop the process with a clear message when Node is too old. A hook command stays silent and exits 0. */
export function enforceNodeFloor(deps: GuardDeps): void {
  const problem = nodeProblem(deps.version, deps.execPath, deps.hasSqlite);
  if (problem === null) return;
  if (deps.argv[2] === 'hook') {
    deps.exit(0);
    return;
  }
  deps.write(`${problem}\n`);
  deps.exit(1);
}
