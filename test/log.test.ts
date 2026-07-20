import { generateWorkLog } from '../src/log';
import { Entry } from '../src/types';

describe('Work Log Generation', () => {
  const mockEntries: Entry[] = [
    { timestamp: new Date().toISOString(), message: 'Fixed auth middleware', project: 'api', tags: ['bug'] },
    { timestamp: new Date().toISOString(), message: 'Updated Docker config', project: 'infra', tags: [] },
  ];

  test('Generates daily log grouped by day', () => {
    const log = generateWorkLog(mockEntries, {});
    expect(log).toContain('Work Log: Today');
    expect(log).toContain('Fixed auth middleware');
    expect(log).toContain('[api]');
    expect(log).toContain('[infra]');
  });

  test('Generates weekly log', () => {
    const log = generateWorkLog(mockEntries, { week: true });
    expect(log).toContain('Work Log: Weekly');
  });

  test('Shows a pluralized entry/project count footer', () => {
    const log = generateWorkLog(mockEntries, {});
    expect(log).toContain('2 entries across 2 projects.');
  });

  test('Singular footer wording for exactly one entry', () => {
    const log = generateWorkLog([mockEntries[0]], {});
    expect(log).toContain('1 entry across 1 project.');
  });

  test('Handles empty entries', () => {
    expect(generateWorkLog([], {})).toContain('No entries found');
  });
});
