import fs from 'fs';
import path from 'path';
import { setupClaude, type SetupIo, type CommandRunner } from '../../src/adapters/setup';
import { VERSION } from '../../src/adapters/version';
import { makeFakePackage } from './fake-package';

export interface Harness {
  root: string;
  /** The user's home (it holds .claude and .claude.json). */
  home: string;
  /** The gournal home. A test may change it before it builds an io. */
  gh: string;
  pkg: string;
  calls: string[][];
  out: string[];
  err: string[];
  confirmAnswers: Array<[string, boolean]>;
  checks: string[][];
  fakeExec(code?: number): CommandRunner;
  makeIo(over?: Partial<SetupIo> & { answer?: boolean }): SetupIo;
  run(opts?: Partial<{ uninstall: boolean; yes: boolean; hook: boolean }>, io?: SetupIo): Promise<number>;
  settingsFile(): string;
  skillFile(): string;
  readSettings(): any;
  writeSettings(v: unknown): void;
  writeReg(reg: { command: string; args: string[] }): void;
  stopCommands(settings: { hooks?: { Stop?: Array<{ hooks: Array<{ command: string }> }> } }): string[];
}

/** The state for one setup test: a temp user home, a gournal home, a fake package, and a fake claude CLI. */
export function makeHarness(root: string): Harness {
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const h: Harness = {
    root, home,
    gh: path.join(root, 'gournal-home'),
    pkg: makeFakePackage(path.join(root, 'pkg'), VERSION),
    calls: [], out: [], err: [], confirmAnswers: [], checks: [],
    // A fake claude CLI. It keeps ~/.claude.json in step, as the real one does.
    fakeExec(code = 0) {
      return async (file, args) => {
        h.calls.push([file, ...args]);
        if (code !== 0) return { code, stdout: '', stderr: 'boom' };
        const f = path.join(home, '.claude.json');
        const cfg = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
        if (args[1] === 'add') {
          const rest = args.slice(args.indexOf('--') + 1);
          cfg.mcpServers = { ...cfg.mcpServers, gournal: { type: 'stdio', command: rest[0], args: rest.slice(1) } };
        } else if (args[1] === 'remove') {
          delete cfg.mcpServers?.gournal;
        }
        fs.writeFileSync(f, JSON.stringify(cfg));
        return { code: 0, stdout: '', stderr: '' };
      };
    },
    makeIo(over = {}) {
      return {
        out: (t) => h.out.push(t),
        err: (t) => h.err.push(t),
        home,
        gournalHome: h.gh,
        packageRoot: h.pkg,
        isTTY: true,
        confirm: async (m, d) => { h.confirmAnswers.push([m, d]); return over.answer ?? d; },
        exec: h.fakeExec(),
        env: { execPath: '/opt/node/bin/node', cmdExe: 'C:\\Windows\\System32\\cmd.exe' },
        bakeHome: false,
        check: async (f, a) => { h.checks.push([f, ...a]); return { code: 0, stdout: `${VERSION}\n`, stderr: '' }; },
        // The POSIX rules hold on every OS that runs the tests. A win32 test sets its own platform.
        platform: 'linux',
        ...over,
      };
    },
    run: (opts = {}, io = h.makeIo()) => setupClaude(io, { uninstall: false, yes: true, hook: false, ...opts }),
    settingsFile: () => path.join(home, '.claude', 'settings.json'),
    skillFile: () => path.join(home, '.claude', 'skills', 'gournal', 'SKILL.md'),
    readSettings: () => JSON.parse(fs.readFileSync(h.settingsFile(), 'utf8')),
    writeSettings(v) {
      fs.mkdirSync(path.dirname(h.settingsFile()), { recursive: true });
      fs.writeFileSync(h.settingsFile(), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
    },
    writeReg(reg) {
      fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { gournal: { type: 'stdio', ...reg } } }));
    },
    stopCommands: (settings) => (settings.hooks?.Stop ?? []).flatMap((g) => g.hooks.map((x) => x.command)),
  };
  return h;
}
