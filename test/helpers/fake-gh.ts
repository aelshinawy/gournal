import { GhError, type GhRunner } from '../../src/sources';

/** Route key: endpoint plus sorted -f params, for example "search/issues?page=1&per_page=100&q=...". */
function keyFor(args: string[]): string {
  const rest = args.slice(1).filter((a, i, all) => a !== '-X' && all[i - 1] !== '-X');
  const endpoint = rest.find((a, i) => a !== '-f' && rest[i - 1] !== '-f') ?? '';
  const params = rest.flatMap((a, i) => (rest[i - 1] === '-f' ? [a] : [])).sort();
  return params.length ? `${endpoint}?${params.join('&')}` : endpoint;
}

export function fakeGh(routes: Record<string, unknown | GhError>): GhRunner & { calls: string[][]; timeouts: number[] } {
  const run = (async (args: string[], opts: { timeoutMs: number }) => {
    run.calls.push(args);
    run.timeouts.push(opts.timeoutMs);
    const key = keyFor(args);
    if (!(key in routes)) throw new GhError('other', `no fake route for ${key}`);
    const v = routes[key];
    if (v instanceof GhError) throw v;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }) as GhRunner & { calls: string[][]; timeouts: number[] };
  run.calls = [];
  run.timeouts = [];
  return run;
}
