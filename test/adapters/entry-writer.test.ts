import { openJournal, type Journal } from '../../src/storage/journal';
import {
  RETRY_WINDOW_MS, createEntryWriter, relinkAfterWrite, type AddInput, type EntryWriter, type EntryWriterOptions,
} from '../../src/adapters/entry-writer';
import { NOT_RESOLVABLE, type NewEntryInput } from '../../src/core';
import { makeTmp, rmTmp } from '../helpers/tmp';

let home: string;
let journal: Journal;
beforeEach(() => {
  home = makeTmp('gournal-writer-');
  journal = openJournal(home);
  now = 1_000_000;
});
afterEach(() => {
  journal.close();
  rmTmp(home);
});

const ID = { project: 'p', repo: null, branch: null };
const long = `${'word '.repeat(40)}end.`;
let now = 1_000_000;
const clock = () => now;
const writer = (o: Partial<EntryWriterOptions> = {}) =>
  createEntryWriter(journal, { retryMemory: false, clock, ...o });
const add = (w: EntryWriter, o: Partial<AddInput> = {}) =>
  w.add({ summary: 'x', identity: ID, source: 'mcp', ...o });
const seed = (summary: string, o: Partial<NewEntryInput> = {}) =>
  journal.repo.add({ summary, project: 'p', source: 'mcp', ...o });

describe('add summary rule', () => {
  test('without retry memory a long summary is split with a split note', () => {
    const { entry, notes } = add(writer(), { summary: long, source: 'cli' });
    expect(entry.summary.length).toBeLessThanOrEqual(120);
    expect(entry.details).toBe(long);
    expect(notes).toEqual([{ type: 'split' }]);
  });

  test.each([false, true])('with retryMemory %s a long summary with details is split and keeps both', (retryMemory) => {
    const { entry, notes } = add(writer({ retryMemory }), { summary: long, details: 'extra' });
    expect(entry.details).toBe(`${long}\n\nextra`);
    expect(notes).toEqual([{ type: 'split' }]);
  });

  test('with retry memory a long summary without details throws and stores nothing', () => {
    expect(() => add(writer({ retryMemory: true }), { summary: long })).toThrow('max 120');
    expect(journal.repo.find()).toHaveLength(0);
  });

  test('with retry memory a multi-line summary throws the one-line message', () => {
    expect(() => add(writer({ retryMemory: true }), { summary: 'Line one\nLine two' }))
      .toThrow(/^summary must be one line, max 120\. Put the rest in details\.$/);
  });

  test('a retry at exactly 10 minutes is split, one millisecond later it is rejected again', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: long })).toThrow('max 120');
    now += RETRY_WINDOW_MS;
    const { entry, notes } = add(w, { summary: long });
    expect(notes).toEqual([{ type: 'split' }]);
    expect(entry.details).toBe(long);
    now += 1;
    expect(() => add(w, { summary: long })).toThrow('max 120');
  });

  test('a retry that shares the first 60 characters is split', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: 'a'.repeat(60) + 'b'.repeat(100) })).toThrow('max 120');
    expect(() => add(w, { summary: 'a'.repeat(60) + 'c'.repeat(100) })).not.toThrow();
  });

  test('a retry that shares only 59 characters is rejected', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: 'a'.repeat(59) + 'b'.repeat(101) })).toThrow('max 120');
    expect(() => add(w, { summary: 'a'.repeat(59) + 'c'.repeat(101) })).toThrow('max 120');
  });

  test('retry matching ignores surrounding whitespace', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: `  ${'q'.repeat(200)}  ` })).toThrow('max 120');
    expect(() => add(w, { summary: 'q'.repeat(200) })).not.toThrow();
  });

  test('retry memory is per writer', () => {
    expect(() => add(writer({ retryMemory: true }), { summary: long })).toThrow('max 120');
    expect(() => add(writer({ retryMemory: true }), { summary: long })).toThrow('max 120');
  });

  test('add stores the identity, source, agent, kind, tags, and refs', () => {
    const { entry } = add(writer(), {
      identity: { project: 'gournal', repo: 'o/r', branch: 'b' },
      source: 'mcp', agent: 'claude', kind: 'next', tags: ['feature'], refs: [{ type: 'pr', value: '12' }],
    });
    expect(journal.repo.get(entry.id)).toMatchObject({
      project: 'gournal', repo: 'o/r', branch: 'b', source: 'mcp', agent: 'claude', kind: 'next',
      tags: ['feature'], refs: [{ type: 'pr', value: '12' }],
    });
  });
});

describe('update summary rule', () => {
  test.each([['no details', undefined], ['existing details', 'keep me']])('with retry memory update rejects a long first summary with %s and changes nothing', (_label, details) => {
    const w = writer({ retryMemory: true });
    const e = seed('one', { details });
    expect(() => w.update(e.id, { summary: long })).toThrow('max 120');
    expect(journal.repo.get(e.id)).toEqual(e);
  });

  test('with retry memory a retried update is split', () => {
    const w = writer({ retryMemory: true });
    const e = seed('one');
    expect(() => w.update(e.id, { summary: long })).toThrow('max 120');
    const { entry, notes } = w.update(e.id, { summary: long });
    expect(notes).toEqual([{ type: 'split' }]);
    expect(entry.details).toBe(long);
    expect(entry.summary.length).toBeLessThanOrEqual(120);
  });

  test('without retry memory update splits a long summary', () => {
    const { entry, notes } = writer().update(seed('one').id, { summary: long });
    expect(notes).toEqual([{ type: 'split' }]);
    expect(entry.details).toBe(long);
  });

  test('a split update keeps the existing details after the overflow', () => {
    const w = writer({ retryMemory: true });
    const e = seed('one', { details: 'keep me' });
    expect(() => w.update(e.id, { summary: long })).toThrow('max 120');
    const { entry, notes } = w.update(e.id, { summary: long });
    expect(entry.details).toBe(`${long}\n\nkeep me`);
    expect(notes).toEqual([{ type: 'split' }]);
  });

  test('a rejected add makes the same update a retry', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: long })).toThrow('max 120');
    const e = seed('one');
    expect(w.update(e.id, { summary: long }).notes).toEqual([{ type: 'split' }]);
  });

  test('update with a long summary plus details is split', () => {
    const w = writer();
    const { entry } = add(w);
    const out = w.update(entry.id, { summary: long, details: 'given' });
    expect(out.entry.summary.length).toBeLessThanOrEqual(120);
    expect(out.entry.details).toBe(`${long}\n\ngiven`);
    expect(out.notes).toEqual([{ type: 'split' }]);
  });

  test('update keeps details when only the summary changes, and replaces them when only details change', () => {
    const w = writer();
    const e = seed('old', { details: 'keep me' });
    const kept = w.update(e.id, { summary: 'new' });
    expect(kept.entry).toMatchObject({ summary: 'new', details: 'keep me' });
    expect(kept.notes).toEqual([]);
    const replaced = w.update(e.id, { details: 'after' });
    expect(replaced.entry).toMatchObject({ summary: 'new', details: 'after' });
    expect(replaced.notes).toEqual([]);
  });
});

describe('resolves policy', () => {
  test.each([
    ['a full id', (id: string) => [id]],
    ['a full id and its suffix', (id: string) => [id, id.slice(-8)]],
  ])('an open blocker is resolved once by %s', (_label, ids) => {
    const b = seed('stuck', { kind: 'blocker' });
    const { entry, notes } = add(writer(), { resolves: ids(b.id) });
    expect(notes).toEqual([]);
    expect(journal.repo.get(b.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: entry.id });
  });

  test('an unknown id is dropped with a note and the entry is stored', () => {
    const { entry, notes } = add(writer(), { resolves: ['ZZZZZZZZ'] });
    expect(notes).toEqual([{ type: 'resolveDropped', id: 'ZZZZZZZZ', reason: 'No entry with id "ZZZZZZZZ"' }]);
    expect(journal.repo.get(entry.id)).not.toBeNull();
  });

  test('valid ids are kept and a non-open one is dropped', () => {
    const blocker = seed('stuck', { kind: 'blocker' });
    const done = seed('finished');
    const { notes } = add(writer(), { resolves: [blocker.id, done.id.slice(-8)] });
    expect(notes).toContainEqual({ type: 'resolveDropped', id: done.id.slice(-8), reason: NOT_RESOLVABLE });
    expect(journal.repo.get(blocker.id)!.status).toBe('resolved');
  });

  test('a target that turns non-open inside the transaction is dropped', () => {
    const b = seed('stuck', { kind: 'blocker' });
    const orig = journal.repo.transaction.bind(journal.repo);
    // Another process resolves the blocker right as the write transaction starts.
    journal.repo.transaction = ((fn: () => unknown) => orig(() => { journal.repo.resolve(b.id); return fn(); })) as typeof journal.repo.transaction;
    const { entry, notes } = add(writer(), { resolves: [b.id.slice(-8)] });
    expect(notes).toEqual([{ type: 'resolveDropped', id: b.id.slice(-8), reason: NOT_RESOLVABLE }]);
    expect(journal.repo.get(entry.id)).not.toBeNull();
  });
});

describe('similar-tag notes', () => {
  test('a new tag close to an existing one gives a similarTag note', () => {
    seed('first', { tags: ['review'] });
    const { notes } = add(writer(), { tags: ['reveiw'] });
    expect(notes).toEqual([{ type: 'similarTag', tag: 'reveiw', close: ['review'] }]);
  });

  test('similar-tag notes use the normalized tag', () => {
    seed('first', { tags: ['review'] });
    const { notes } = add(writer(), { tags: ['Reveiw'] });
    expect(notes).toEqual([{ type: 'similarTag', tag: 'reveiw', close: ['review'] }]);
  });

  test('a new tag with no close match, and an existing tag, give no similarTag note', () => {
    seed('first', { tags: ['review'] });
    expect(add(writer(), { tags: ['database'] }).notes).toEqual([]);
    expect(add(writer(), { tags: ['review'] }).notes).toEqual([]);
  });

  test('notes come in the order similar-tag notes, dropped resolves, split', () => {
    seed('first', { tags: ['review'] });
    const w = writer({ retryMemory: true });
    const { notes } = add(w, { summary: long, details: 'd', tags: ['reveiw'], resolves: ['ZZZZZZZZ'] });
    expect(notes.map((n) => n.type)).toEqual(['similarTag', 'resolveDropped', 'split']);
  });
});

describe('relink after write', () => {
  const pr = () => journal.activity.upsert([{
    type: 'pr_opened', occurredAt: new Date().toISOString(), repo: 'acme/widgets', branch: 'feat/x',
    externalId: '5', title: 'Add x', url: null, pr: 5, payload: { pr: 5 },
  }]);

  test('add links the new entry to stored activity', () => {
    pr();
    const { entry } = add(writer(), {
      identity: { project: 'p', repo: 'acme/widgets', branch: null }, refs: [{ type: 'pr', value: '5' }],
    });
    expect(journal.activity.linkedTo([entry.id])[entry.id]).toHaveLength(1);
  });

  test('update links an entry to stored activity', () => {
    pr();
    const w = writer();
    const { entry } = add(w, { identity: { project: 'p', repo: 'acme/widgets', branch: null } });
    expect(journal.activity.linkedTo([entry.id])[entry.id] ?? []).toHaveLength(0);
    w.update(entry.id, { refs: [{ type: 'pr', value: '5' }] });
    expect(journal.activity.linkedTo([entry.id])[entry.id]).toHaveLength(1);
  });

  test('restore relinks the entry to stored activity', () => {
    const w = writer();
    const { entry } = add(w, { identity: { project: 'p', repo: 'acme/widgets', branch: null }, refs: [{ type: 'pr', value: '5' }] });
    w.delete(entry.id);
    pr(); // sync stores activity while the entry is removed; upsert does not link
    w.restore(entry.id);
    expect(journal.activity.linkedTo([entry.id])[entry.id] ?? []).toHaveLength(1);
  });
});

describe('undo', () => {
  test('undo removes the latest entry of this device, then returns null', () => {
    const w = writer();
    seed('first', { createdAt: '2026-07-13T10:00:00.000Z' });
    seed('second', { createdAt: '2026-07-13T10:00:01.000Z' });
    expect(w.undo()?.summary).toBe('second');
    expect(w.undo()?.summary).toBe('first');
    expect(w.undo()).toBeNull();
  });
});

describe('relinkAfterWrite', () => {
  test('it never throws and warns once per process', () => {
    const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const broken = { activity: { relinkEntries: () => { throw new Error('boom'); } } } as unknown as Journal;
    expect(() => relinkAfterWrite(broken, ['a'])).not.toThrow();
    expect(() => relinkAfterWrite(broken, ['b'])).not.toThrow();
    const warnings = write.mock.calls.filter((c) => String(c[0]).includes('relink'));
    expect(warnings.length).toBeLessThanOrEqual(1);
  });
});
