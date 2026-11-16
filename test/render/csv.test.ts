import { exportCsv } from '../../src/render';
import { makeEntry } from '../core/factory';

describe('csv export', () => {
  const a = makeEntry({ createdAt: '2026-07-13T10:00:00.000Z', summary: 'Fixed auth middleware', project: 'api', tags: ['bug', 'x'] });
  const b = makeEntry({ createdAt: '2026-07-13T11:00:00.000Z', summary: 'Note, with a comma', project: 'infra' });

  test('keeps the old columns first and adds the new ones at the end', () => {
    const lines = exportCsv([a, b]).split('\n');
    expect(lines[0]).toBe('timestamp,project,message,tags,summary,details,kind,refs');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('2026-07-13T10:00:00.000Z,api,Fixed auth middleware,bug;x,Fixed auth middleware,,done,');
    expect(lines[2]).toContain('"Note, with a comma"');
  });

  test('message is summary plus details; refs are type:value joined by ;', () => {
    const e = makeEntry({
      createdAt: '2026-07-13T10:00:00.000Z', summary: 'Shipped', details: 'Long text', project: 'api',
      refs: [{ type: 'pr', value: '327' }, { type: 'jira', value: 'SBDC-1748' }],
    });
    expect(exportCsv([e]).split('\n').slice(1).join('\n')).toBe(
      '2026-07-13T10:00:00.000Z,api,"Shipped\n\nLong text",,Shipped,Long text,done,pr:327;jira:SBDC-1748');
  });

  test('empty list gives only the header', () => {
    expect(exportCsv([])).toBe('timestamp,project,message,tags,summary,details,kind,refs');
  });

  describe('formula injection', () => {
    const cell = (summary: string) => exportCsv([makeEntry({ createdAt: '2026-07-13T10:00:00.000Z', summary, project: 'api' })]).split('\n')[1];
    const summaryOf = (summary: string) => cell(summary).split(',')[2];

    test.each(['=', '+', '-', '@'])('a cell that starts with %s gets a single quote', (c) => {
      expect(summaryOf(`${c}HYPERLINK("http://x")`)).toBe(`"'${c}HYPERLINK(""http://x"")"`);
      expect(summaryOf(`${c}1+1`)).toBe(`'${c}1+1`);
    });

    test('a cell that starts with a tab or a carriage return gets a single quote and is quoted', () => {
      expect(summaryOf('\tcmd')).toBe("'\tcmd");
      expect(summaryOf('\rcmd')).toBe(`"'\rcmd"`);
    });

    test('a number with trailing text, or a hex number, is not a plain number and gets a single quote', () => {
      expect(summaryOf('-5\t')).toBe("'-5\t");
      expect(summaryOf('-0x10')).toBe("'-0x10");
    });

    test('the message and details columns are checked too', () => {
      const e = makeEntry({ createdAt: '2026-07-13T10:00:00.000Z', summary: 'ok', details: '=SUM(A1)', project: '@home', tags: ['-x'] });
      const row = exportCsv([e]).split('\n').slice(1).join('\n');
      expect(row).toBe("2026-07-13T10:00:00.000Z,'@home,\"ok\n\n=SUM(A1)\",'-x,ok,'=SUM(A1),done,");
    });

    test('a value with a carriage return inside is quoted', () => {
      expect(summaryOf('a\rb')).toBe('"a\rb"');
    });

    test('normal cells are not changed: dates, mid-text signs, and plain numbers', () => {
      expect(cell('Fixed a-b = c')).toBe('2026-07-13T10:00:00.000Z,api,Fixed a-b = c,,Fixed a-b = c,,done,');
      expect(summaryOf('-5')).toBe('-5');
      expect(summaryOf('+3.5')).toBe('+3.5');
      expect(summaryOf('2026-07-13')).toBe('2026-07-13');
      expect(cell('x').startsWith('2026-07-13T10:00:00.000Z,')).toBe(true);
    });
  });
});
