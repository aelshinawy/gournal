import type { Entry } from '../types';

export const groupByProject = (entries: Entry[]): Map<string, Entry[]> =>
  entries.reduce((acc, e) => {
    const projectEntries = acc.get(e.project) || [];
    return acc.set(e.project, [...projectEntries, e]);
  }, new Map<string, Entry[]>());
