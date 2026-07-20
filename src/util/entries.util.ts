import type { Entry } from '../types';

export const filterByProject = (entries: Entry[], project?: string): Entry[] =>
  project ? entries.filter(e => e.project === project) : entries;

export const filterByTags = (entries: Entry[], tags?: string[]): Entry[] =>
  tags && tags.length ? entries.filter(e => tags.every(t => e.tags.includes(t))) : entries;

export const groupByProject = (entries: Entry[]): Map<string, Entry[]> =>
  entries.reduce((acc, e) => {
    const projectEntries = acc.get(e.project) || [];
    return acc.set(e.project, [...projectEntries, e]);
  }, new Map<string, Entry[]>());
