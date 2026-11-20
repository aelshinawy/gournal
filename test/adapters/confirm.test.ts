import { PassThrough } from 'stream';
import { confirm, confirmOrNo } from '../../src/adapters/cli/confirm';
import { buildProgram } from '../../src/adapters/cli';
import { openJournal } from '../../src/storage/journal';
import { runIn } from '../helpers/run-cli';
import { makeTmp, rmTmp } from '../helpers/tmp';

type Fake = PassThrough & { isTTY?: boolean };

function streams(tty: boolean): { input: Fake; output: PassThrough; text: () => string } {
  const input: Fake = new PassThrough();
  input.isTTY = tty;
  const output = new PassThrough();
  let text = '';
  output.on('data', (c: Buffer) => { text += c.toString(); });
  return { input, output, text: () => text };
}

function ask(def: boolean, feed: (input: Fake) => void, tty = true): { result: Promise<boolean>; text: () => string } {
  const s = streams(tty);
  const result = confirm('Q?', def, { input: s.input, output: s.output });
  feed(s.input);
  return { result, text: s.text };
}

describe('confirm', () => {
  test.each([
    ['y\n', false, true],
    ['YES\n', false, true],
    ['n\n', true, false],
    ['\n', false, false],
    ['\n', true, true],
    ['maybe\n', false, false],
  ] as const)('the answer %j with default %p gives %p', async (answer, def, expected) => {
    const { result } = ask(def, (input) => input.write(answer));
    await expect(result).resolves.toBe(expected);
  });

  test('the prompt shows the default', async () => {
    const no = ask(false, (input) => input.write('\n'));
    await no.result;
    expect(no.text()).toBe('? Q? (y/N) ');
    const yes = ask(true, (input) => input.write('\n'));
    await yes.result;
    expect(yes.text()).toBe('? Q? (Y/n) ');
  });

  test('an input that ends before an answer rejects', async () => {
    const { result } = ask(false, (input) => input.end());
    await expect(result).rejects.toThrow('no answer');
  });

  test('a close after the prompt rejects', async () => {
    const { result } = ask(false, (input) => { setTimeout(() => input.end(), 20); });
    await expect(result).rejects.toThrow('no answer');
  });

  test('no terminal rejects and writes nothing', async () => {
    const { result, text } = ask(false, () => undefined, false);
    await expect(result).rejects.toThrow('no terminal to ask');
    expect(text()).toBe('');
  });

  test('a second prompt on an input that already ended rejects', async () => {
    const s = streams(true);
    const io = { input: s.input, output: s.output };
    const first = confirm('Q?', false, io);
    s.input.write('y\n');
    await expect(first).resolves.toBe(true);
    s.input.end();
    await new Promise((resolve) => s.input.once('end', resolve).resume());
    await expect(confirm('Q?', false, io)).rejects.toThrow('no answer');
    await expect(confirmOrNo('Q?', true, io)).resolves.toBe(false);
  });

  test('Ctrl+C rejects', async () => {
    const s = streams(true);
    (s.output as PassThrough & { isTTY?: boolean }).isTTY = true;
    (s.input as Fake & { setRawMode?: () => void }).setRawMode = () => undefined;
    const result = confirm('Q?', false, { input: s.input, output: s.output });
    s.input.write('\x03');
    await expect(result).rejects.toThrow('no answer');
  });

  test('confirmOrNo turns no answer into false', async () => {
    const plain = streams(false);
    await expect(confirmOrNo('Q?', true, { input: plain.input, output: plain.output })).resolves.toBe(false);
    const tty = streams(true);
    const result = confirmOrNo('Q?', true, { input: tty.input, output: tty.output });
    tty.input.end();
    await expect(result).resolves.toBe(false);
  });
});

describe('gournal clear', () => {
  let home: string;
  const clearWith = async (stub: (message: string, def: boolean) => Promise<boolean>): Promise<string[]> => {
    const out: string[] = [];
    const program = buildProgram({ out: (t) => out.push(t), err: () => undefined, cwd: home, home, isTTY: true, confirm: stub });
    await program.parseAsync(['node', 'gournal', 'clear']);
    return out;
  };
  const entryCount = (): number => {
    const journal = openJournal(home);
    try { return journal.repo.find().length; } finally { journal.close(); }
  };

  beforeEach(async () => {
    home = makeTmp('gournal-confirm-');
    await runIn(home, ['add', 'keep me']);
  });
  afterEach(() => rmTmp(home));

  test('the answer no keeps every entry', async () => {
    const calls: [string, boolean][] = [];
    await clearWith(async (message, def) => { calls.push([message, def]); return false; });
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe(false);
    expect(calls[0][0]).toContain('Are you sure you want to clear all gournal entries?');
    expect(entryCount()).toBe(1);
  });

  test('the answer yes clears', async () => {
    const out = await clearWith(async () => true);
    expect(out.join('\n')).toContain('Cleared 1 entries');
  });

  test('no answer is not a terminal', async () => {
    await expect(clearWith(async () => { throw new Error('no answer'); })).rejects.toThrow('Not a terminal; nothing cleared.');
    expect(entryCount()).toBe(1);
  });
});
