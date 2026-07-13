import { generateCsvExport, generateMarkdownExport } from '../src/export';
import { Entry } from '../src/types';

describe('Export Generation', () => {
  const mockEntries: Entry[] = [
    {
      timestamp: '2026-07-13T10:00:00.000Z',
      message: 'Fixed auth middleware',
      project: 'api',
      tags: ['bug']
    },
    {
      timestamp: '2026-07-13T11:00:00.000Z',
      message: 'Note, with a comma',
      project: 'infra',
      tags: []
    }
  ];

  test('Generates CSV export with header and escaped fields', () => {
    const csv = generateCsvExport(mockEntries);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,project,message,tags');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('api');
    expect(lines[1]).toContain('bug');
    expect(lines[2]).toContain('"Note, with a comma"');
  });

  test('Generates markdown export grouped by project', () => {
    const md = generateMarkdownExport(mockEntries);
    expect(md).toContain('## api');
    expect(md).toContain('## infra');
    expect(md).toContain('Fixed auth middleware');
    expect(md).toContain('#bug');
  });

  test('Handles empty entries', () => {
    expect(generateMarkdownExport([])).toContain('No entries found');
    expect(generateCsvExport([])).toBe('timestamp,project,message,tags');
  });
});
