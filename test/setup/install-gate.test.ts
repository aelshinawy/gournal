import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { makeRealTmp, rmTmp } from '../helpers/tmp';
import { writeRecords } from '../../src/adapters/setup/source';
import { runtimePaths } from '../../src/adapters/setup/runtime';
import { runCli } from '../../src/adapters/cli/program';

const now = new Date('2026-11-21T12:00:00Z');
let root: string;
beforeEach(() => { root = makeRealTmp('gournal-gate-'); });
afterEach(() => rmTmp(root));

/** The copy runs from <home>/runtime/app-x. The package manager folder exists and the package is gone. */
async function run(argv: string[], afterS: number) {
  const home = path.join(root, 'home');
  const copy = path.join(home, 'runtime', 'app-x');
  const pm = path.join(root, 'pm', 'node_modules');
  fs.mkdirSync(path.join(copy, 'dist'), { recursive: true });
  fs.mkdirSync(pm, { recursive: true });
  writeRecords(path.join(home, 'runtime'), { source: path.join(pm, 'gournal'), anchor: pm, rack: path.join(pm, 'gournal') });
  const transcript = path.join(root, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } })}\n`);
  const out: string[] = [];
  const err: string[] = [];
  const saved = Object.getOwnPropertyDescriptor(process, 'stdin')!;
  Object.defineProperty(process, 'stdin', { value: Readable.from([JSON.stringify({ session_id: 'gate', transcript_path: transcript })]), configurable: true });
  try {
    const status = await runCli(['node', 'gournal', ...argv], {
      home, packageRoot: copy, now: () => new Date(now.getTime() + afterS * 1000),
      out: (t) => out.push(t), err: (t) => err.push(t),
    });
    return { status, out, err, home, source: path.join(pm, 'gournal') };
  } finally {
    Object.defineProperty(process, 'stdin', saved);
  }
}

test('a removed package: the MCP server gets one stderr line, then exits 1 after 60 seconds, and the hook stays silent', async () => {
  const first = await run(['--version'], 0);
  expect(first.status).toBe(0);
  expect(first.err).toEqual([`gournal: the installed package ${first.source} is missing. gournal runs from its copy in ${first.home}/runtime.`]);

  const late = await run(['--version'], 61);
  expect(late.status).toBe(1);
  expect(late.out).toEqual([]);
  expect(late.err).toEqual([
    `gournal: gournal is no longer installed: ${late.source} is gone. To remove gournal from Claude Code, run: ${runtimePaths(late.home, process.platform).launcher} setup claude --uninstall`,
  ]);

  const hook = await run(['hook', 'stop'], 61);
  expect({ status: hook.status, out: hook.out, err: hook.err }).toEqual({ status: 0, out: [], err: [] });
});
