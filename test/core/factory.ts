import type { Activity, Entry, Kind } from '../../src/core';

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

let aseq = 0;
export function makeActivity(over: Partial<Activity> = {}): Activity {
  aseq += 1;
  const occurredAt = over.occurredAt ?? '2026-11-11T10:00:00.000Z';
  return {
    id: `01TESTACT${String(aseq).padStart(10, '0')}${String(aseq).padStart(7, 'X')}`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    deletedAt: null,
    deviceId: 'dev',
    type: 'commit',
    occurredAt,
    repo: 'acme/widgets',
    branch: null,
    externalId: `sha${String(aseq).padStart(10, '0')}`,
    title: null,
    url: null,
    capturedBy: 'github',
    pr: null,
    payload: {},
    ...over,
  };
}
