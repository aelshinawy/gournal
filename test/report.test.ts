import { generateStandupReport } from '../src/report';
import { Entry } from '../src/types';

describe('Standup Report Generation', () => {
  const mockEntries: Entry[] = [
    {
      timestamp: new Date().toISOString(),
      message: 'Fixed auth middleware',
      project: 'api',
      tags: ['bug']
    },
    {
      timestamp: new Date().toISOString(),
      message: 'Updated Docker config',
      project: 'infra',
      tags: ['devops']
    }
  ];

  test('Generates daily report', () => {
    const report = generateStandupReport(mockEntries, {});
    expect(report).toContain('Standup: Today');
    expect(report).toContain('api');
    expect(report).toContain('infra');
  });

  test('Generates weekly report', () => {
    const report = generateStandupReport(mockEntries, { week: true });
    expect(report).toContain('Standup: Weekly');
    expect(report).toContain('api');
    expect(report).toContain('infra');
  });

  test('Generates yesterday report', () => {
    const report = generateStandupReport(mockEntries, { yesterday: true });
    expect(report).toContain('Standup: Yesterday');
    expect(report).toContain('api');
    expect(report).toContain('infra');
  });
});