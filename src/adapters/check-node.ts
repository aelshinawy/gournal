// This file runs before node:sqlite loads. Use only syntax that Node 14 parses.
export const NODE_FLOOR = { major: 22, minor: 13 } as const;

function problem(): string | null {
  const version = process.versions.node;
  const [major, minor] = version.split('.').map(Number);
  if (major < NODE_FLOOR.major || (major === NODE_FLOOR.major && minor < NODE_FLOOR.minor)) {
    const floor = `${NODE_FLOOR.major}.${NODE_FLOOR.minor}`;
    return `gournal needs Node.js ${floor} or newer. This is Node.js ${version} at ${process.execPath}. Switch to Node.js ${floor} or newer and run the command again.`;
  }
  try {
    require('node:sqlite');
    return null;
  } catch {
    return `gournal needs the node:sqlite module. The Node.js ${version} build at ${process.execPath} does not have it. Install an official Node.js build.`;
  }
}

const message = problem();
if (message !== null) {
  // A hook command stays silent and exits 0.
  const isHook = process.argv[2] === 'hook';
  if (!isHook) process.stderr.write(`${message}\n`);
  process.exit(isHook ? 0 : 1);
}
