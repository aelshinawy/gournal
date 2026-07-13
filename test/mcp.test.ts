import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Entry } from '../src/types';

jest.mock('../src/storage');
jest.mock('../src/report');
jest.mock('../src/export');

import { readEntries } from '../src/storage';
import { generateStandupReport } from '../src/report';
import { generateCsvExport, generateMarkdownExport } from '../src/export';
import { createServer } from '../src/mcp';

const mockedReadEntries = readEntries as jest.MockedFunction<typeof readEntries>;
const mockedStandup = generateStandupReport as jest.MockedFunction<typeof generateStandupReport>;
const mockedCsv = generateCsvExport as jest.MockedFunction<typeof generateCsvExport>;
const mockedMd = generateMarkdownExport as jest.MockedFunction<typeof generateMarkdownExport>;

const entries: Entry[] = [
  { timestamp: '2026-07-13T10:00:00.000Z', message: 'Fixed auth middleware', project: 'api', tags: ['bug'] },
  { timestamp: '2026-07-12T10:00:00.000Z', message: 'Updated Docker config', project: 'infra', tags: [] },
];

async function connectedClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe('MCP server tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadEntries.mockResolvedValue(entries);
  });

  test('list_entries calls readEntries and returns all entries', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'list_entries', arguments: {} });
    expect(mockedReadEntries).toHaveBeenCalledTimes(1);
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual(entries);
  });

  test('list_entries filters by project', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'list_entries', arguments: { project: 'api' } });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([entries[0]]);
  });

  test('list_entries filters by date range', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'list_entries',
      arguments: { from: '2026-07-13T00:00:00.000Z' },
    });
    const text = (result.content as any[])[0].text;
    expect(JSON.parse(text)).toEqual([entries[0]]);
  });

  test('get_standup calls generateStandupReport with matching options', async () => {
    mockedStandup.mockReturnValue('STANDUP OUTPUT');
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_standup', arguments: { week: true, project: 'api' } });
    expect(mockedReadEntries).toHaveBeenCalledTimes(1);
    expect(mockedStandup).toHaveBeenCalledWith([entries[0]], { yesterday: undefined, week: true, month: undefined });
    expect((result.content as any[])[0].text).toBe('STANDUP OUTPUT');
  });

  test('get_monthly_summary calls generateStandupReport with month: true', async () => {
    mockedStandup.mockReturnValue('MONTHLY OUTPUT');
    const client = await connectedClient();
    const result = await client.callTool({ name: 'get_monthly_summary', arguments: {} });
    expect(mockedStandup).toHaveBeenCalledWith(entries, { month: true });
    expect((result.content as any[])[0].text).toBe('MONTHLY OUTPUT');
  });

  test('export_entries defaults to markdown', async () => {
    mockedMd.mockReturnValue('MD OUTPUT');
    const client = await connectedClient();
    const result = await client.callTool({ name: 'export_entries', arguments: {} });
    expect(mockedMd).toHaveBeenCalledWith(entries);
    expect(mockedCsv).not.toHaveBeenCalled();
    expect((result.content as any[])[0].text).toBe('MD OUTPUT');
  });

  test('export_entries uses csv when requested, filtered by project', async () => {
    mockedCsv.mockReturnValue('CSV OUTPUT');
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'export_entries',
      arguments: { format: 'csv', project: 'infra' },
    });
    expect(mockedCsv).toHaveBeenCalledWith([entries[1]]);
    expect((result.content as any[])[0].text).toBe('CSV OUTPUT');
  });
});
