import { generateStats, countBy } from '../src/stats';
import { Entry } from '../src/types';
import { subDays } from 'date-fns';

const entryAt = (date: Date, project: string, tags: string[] = []): Entry => ({
  timestamp: date.toISOString(),
  message: 'did stuff',
  project,
  tags,
});

describe('countBy', () => {
  test('counts occurrences, sorted descending', () => {
    expect(countBy(['a', 'b', 'a', 'a', 'b'])).toEqual([['a', 3], ['b', 2]]);
  });

  test('returns an empty array for no values', () => {
    expect(countBy([])).toEqual([]);
  });
});

describe('generateStats', () => {
  test('Handles empty entries', () => {
    expect(generateStats([])).toContain('No entries found');
  });

  test('Counts total entries and groups by project/tag', () => {
    const entries = [
      entryAt(new Date(), 'api', ['bug']),
      entryAt(new Date(), 'api', ['bug']),
      entryAt(new Date(), 'infra', []),
    ];
    const stats = generateStats(entries);
    expect(stats).toContain('Total entries: 3');
    expect(stats).toContain('api: 2');
    expect(stats).toContain('infra: 1');
    expect(stats).toContain('#bug: 2');
  });

  test('Computes a streak of consecutive days including today', () => {
    const entries = [
      entryAt(new Date(), 'api'),
      entryAt(subDays(new Date(), 1), 'api'),
      entryAt(subDays(new Date(), 2), 'api'),
    ];
    expect(generateStats(entries)).toContain('Current streak: 3 days');
  });

  test('Streak still counts yesterday if nothing logged yet today', () => {
    const entries = [entryAt(subDays(new Date(), 1), 'api')];
    expect(generateStats(entries)).toContain('Current streak: 1 day');
  });

  test('Streak resets to 0 when the gap is more than a day', () => {
    const entries = [entryAt(subDays(new Date(), 3), 'api')];
    expect(generateStats(entries)).toContain('Current streak: 0 days');
  });
});
