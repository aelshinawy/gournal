import type { Entry, Kind } from '../../src/core';

let seq = 0;
export function makeEntry(over: Partial<Entry> & { createdAt: Date | string }): Entry {
  seq += 1;
  const createdAt = over.createdAt instanceof Date ? over.createdAt.toISOString() : over.createdAt;
  return {
    id: `01TESTID${String(seq).padStart(10, '0')}${String(seq).padStart(8, 'X')}`,
    updatedAt: createdAt,
    deletedAt: null,
    deviceId: 'dev',
    summary: `entry ${seq}`,
    details: null,
    kind: 'done' as Kind,
    status: null,
    resolvedAt: null,
    resolvedByEntryId: null,
    project: 'api',
    repo: null,
    branch: null,
    source: 'cli',
    agent: null,
    tags: [],
    refs: [],
    ...over,
    createdAt,
  };
}
