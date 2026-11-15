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
});
