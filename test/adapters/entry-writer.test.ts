import fs from 'fs';
import os from 'os';
import path from 'path';
import { openJournal, type Journal } from '../../src/storage/journal';
import {
  RETRY_WINDOW_MS, createEntryWriter, type AddInput, type EntryWriter, type EntryWriterOptions,
} from '../../src/adapters/entry-writer';
import { NOT_RESOLVABLE, type NewEntryInput } from '../../src/core';
import { rmTmp } from '../helpers/tmp';

let home: string;
let journal: Journal;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gournal-writer-'));
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
  createEntryWriter(journal, { retryMemory: false, clock, resolves: 'strict', ...o });
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

  test('without retry memory a long summary with details keeps both', () => {
    const { entry } = add(writer(), { summary: long, details: 'extra' });
    expect(entry.details).toBe(`${long}\n\nextra`);
  });

  test('with retry memory a long summary without details throws and stores nothing', () => {
    expect(() => add(writer({ retryMemory: true }), { summary: long })).toThrow('max 120');
    expect(journal.repo.find()).toHaveLength(0);
  });

  test('with retry memory a multi-line summary throws the one-line message', () => {
    expect(() => add(writer({ retryMemory: true }), { summary: 'Line one\nLine two' }))
      .toThrow(/^summary must be one line, max 120\. Put the rest in details\.$/);
  });

  test('a retry at exactly 10 minutes is split', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: long })).toThrow('max 120');
    now += RETRY_WINDOW_MS;
    const { entry, notes } = add(w, { summary: long });
    expect(notes).toEqual([{ type: 'split' }]);
    expect(entry.details).toBe(long);
  });

  test('a retry after more than 10 minutes is rejected again', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: long })).toThrow('max 120');
    now += RETRY_WINDOW_MS + 1;
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

  test('an unrelated long summary is still rejected after a rejection', () => {
    const w = writer({ retryMemory: true });
    expect(() => add(w, { summary: 'a'.repeat(200) })).toThrow('max 120');
    expect(() => add(w, { summary: 'z'.repeat(200) })).toThrow('max 120');
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

  test('with retry memory a long summary with details is split', () => {
    const { entry, notes } = add(writer({ retryMemory: true }), { summary: long, details: 'given' });
    expect(entry.details).toBe(`${long}\n\ngiven`);
    expect(notes).toEqual([{ type: 'split' }]);
  });

  test('a blank summary throws summary is empty', () => {
    expect(() => add(writer(), { summary: '   ' })).toThrow('summary is empty');
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
  test('update rejects a long summary without details, also on a retry', () => {
    const w = writer({ retryMemory: true });
    const { entry } = add(w);
    expect(() => w.update(entry.id, { summary: 'x'.repeat(200) })).toThrow('max 120');
    expect(() => w.update(entry.id, { summary: 'x'.repeat(200) })).toThrow('max 120');
  });

  test('update with a long summary plus details is split', () => {
    const w = writer();
    const { entry } = add(w);
    const out = w.update(entry.id, { summary: long, details: 'given' });
    expect(out.entry.summary.length).toBeLessThanOrEqual(120);
    expect(out.entry.details).toBe(`${long}\n\ngiven`);
    expect(out.notes).toEqual([{ type: 'split' }]);
  });

  test('update keeps details when only the summary changes', () => {
    const w = writer();
    const e = seed('old', { details: 'keep me' });
    const out = w.update(e.id, { summary: 'new' });
    expect(out.entry.summary).toBe('new');
    expect(out.entry.details).toBe('keep me');
    expect(out.notes).toEqual([]);
  });

  test('update with only details replaces details', () => {
    const e = seed('old', { details: 'before' });
    const out = writer().update(e.id, { details: 'after' });
    expect(out.entry.summary).toBe('old');
    expect(out.entry.details).toBe('after');
  });

  test('update kind change reopens a resolved blocker', () => {
    const b = seed('stuck', { kind: 'blocker' });
    journal.repo.resolve(b.id);
    const out = writer().update(b.id, { kind: 'next' });
    expect(out.entry).toMatchObject({ status: 'open', resolvedAt: null, resolvedByEntryId: null });
  });
});

describe('resolves policy', () => {
  test('strict: a valid id resolves the target', () => {
    const b = seed('stuck', { kind: 'blocker' });
    const { entry, notes } = add(writer(), { resolves: [b.id] });
    expect(journal.repo.get(b.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: entry.id });
    expect(notes).toEqual([]);
  });

  test('strict: an unknown id throws and stores nothing', () => {
    const before = journal.repo.find().length;
    expect(() => add(writer(), { resolves: ['ZZZZZZZZ'] })).toThrow('No entry with id "ZZZZZZZZ"');
    expect(journal.repo.find()).toHaveLength(before);
  });

  test('strict: a non-open target throws and stores nothing', () => {
    const blocker = seed('stuck', { kind: 'blocker' });
    const done = seed('finished');
    const before = journal.repo.find().length;
    expect(() => add(writer(), { resolves: [blocker.id, done.id] })).toThrow(NOT_RESOLVABLE);
    expect(journal.repo.get(blocker.id)!.status).toBe('open');
    expect(journal.repo.find()).toHaveLength(before);
  });

  test('lenient: an open blocker is resolved', () => {
    const b = seed('stuck', { kind: 'blocker' });
    const { entry } = add(writer({ resolves: 'lenient' }), { resolves: [b.id] });
    expect(journal.repo.get(b.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: entry.id });
  });

  test('lenient: an unknown id is dropped with a note and the entry is stored', () => {
    const { entry, notes } = add(writer({ resolves: 'lenient' }), { resolves: ['ZZZZZZZZ'] });
    expect(notes).toEqual([{ type: 'resolveDropped', id: 'ZZZZZZZZ', reason: 'No entry with id "ZZZZZZZZ"' }]);
    expect(journal.repo.get(entry.id)).not.toBeNull();
  });

  test('lenient: valid ids are kept and a non-open one is dropped', () => {
    const blocker = seed('stuck', { kind: 'blocker' });
    const done = seed('finished');
    const { notes } = add(writer({ resolves: 'lenient' }), { resolves: [blocker.id, done.id.slice(-8)] });
    expect(notes).toContainEqual({ type: 'resolveDropped', id: done.id.slice(-8), reason: NOT_RESOLVABLE });
    expect(journal.repo.get(blocker.id)!.status).toBe('resolved');
  });

  test('lenient: a full id and its suffix resolve once', () => {
    const b = seed('stuck', { kind: 'blocker' });
    const { entry, notes } = add(writer({ resolves: 'lenient' }), { resolves: [b.id, b.id.slice(-8)] });
    expect(notes).toEqual([]);
    expect(journal.repo.get(b.id)!.resolvedByEntryId).toBe(entry.id);
  });

  test('lenient: a target that turns non-open inside the transaction is dropped', () => {
    const b = seed('stuck', { kind: 'blocker' });
    const orig = journal.repo.transaction.bind(journal.repo);
    // Another process resolves the blocker right as the write transaction starts.
    journal.repo.transaction = ((fn: () => unknown) => orig(() => { journal.repo.resolve(b.id); return fn(); })) as typeof journal.repo.transaction;
    const { entry, notes } = add(writer({ resolves: 'lenient' }), { resolves: [b.id.slice(-8)] });
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

  test('a new tag with no close match gives no similarTag note', () => {
    seed('first', { tags: ['review'] });
    expect(add(writer(), { tags: ['database'] }).notes).toEqual([]);
  });

  test('similar-tag notes use the normalized tag', () => {
    seed('first', { tags: ['review'] });
    const { notes } = add(writer(), { tags: ['Reveiw'] });
    expect(notes).toEqual([{ type: 'similarTag', tag: 'reveiw', close: ['review'] }]);
  });

  test('an existing tag gives no similarTag note', () => {
    seed('first', { tags: ['review'] });
    expect(add(writer(), { tags: ['review'] }).notes).toEqual([]);
  });

  test('notes come in the order similar-tag notes, dropped resolves, split', () => {
    seed('first', { tags: ['review'] });
    const w = writer({ resolves: 'lenient', retryMemory: true });
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
});

describe('pass-through methods', () => {
  test('resolve stores the resolver', () => {
    const w = writer();
    const b = seed('stuck', { kind: 'blocker' });
    const d = seed('finished');
    expect(w.resolve(b.id.slice(-8), d.id.slice(-8))).toMatchObject({ status: 'resolved', resolvedByEntryId: d.id });
    const b2 = seed('stuck two', { kind: 'blocker' });
    expect(w.resolve(b2.id)).toMatchObject({ status: 'resolved', resolvedByEntryId: null });
  });

  test('delete soft-deletes and restore brings it back', () => {
    const w = writer();
    const e = seed('one');
    expect(w.delete(e.id).deletedAt).not.toBeNull();
    expect(w.restore(e.id).deletedAt).toBeNull();
  });

  test('undo removes the latest entry of this device, then returns null', () => {
    const w = writer();
    seed('first', { createdAt: '2026-07-13T10:00:00.000Z' });
    seed('second', { createdAt: '2026-07-13T10:00:01.000Z' });
    expect(w.undo()?.summary).toBe('second');
    expect(w.undo()?.summary).toBe('first');
    expect(w.undo()).toBeNull();
  });

  test('clear hides every entry and returns the count', () => {
    seed('one');
    seed('two');
    expect(writer().clear()).toBe(2);
    expect(journal.repo.find()).toHaveLength(0);
  });

  test('resolve, delete, and restore throw on an unknown id', () => {
    const w = writer();
    expect(() => w.resolve('NOPE1234')).toThrow('No entry with id "NOPE1234"');
    expect(() => w.delete('NOPE1234')).toThrow('No entry with id "NOPE1234"');
    expect(() => w.restore('NOPE1234')).toThrow('No entry with id "NOPE1234"');
  });
});
