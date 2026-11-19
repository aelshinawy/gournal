import { runIn } from './helpers/run-cli';
import { makeTmp, rmTmp } from './helpers/tmp';

describe('gournal undo', () => {
  let home: string;

  const run = (...args: string[]) => runIn(home, args);

  beforeEach(() => {
    home = makeTmp('gournal-');
  });
  afterEach(() => {
    rmTmp(home);
  });

  test('removes the last entry it reports, one at a time', async () => {
    expect((await run('add', 'first')).status).toBe(0);
    expect((await run('add', 'second')).status).toBe(0);

    const undo1 = await run('undo');
    expect(undo1.status).toBe(0);
    expect(undo1.stdout).toContain('Removed: second');
    expect(undo1.stdout).toMatch(/restore with gournal restore [0-9A-Z]{8}\)/);

    expect((await run('undo')).stdout).toContain('Removed: first');
    expect((await run('undo')).stdout).toContain('No entries to undo.');
  });
});
