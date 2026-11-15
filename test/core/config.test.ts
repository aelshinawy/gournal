import { normalizeConfig } from '../../src/core';

test('defaults fill the new settings', () => {
  const { config } = normalizeConfig('c.json', { deviceId: 'D' }, () => {});
  expect(config.weekStartsOn).toBe(1);
  expect(config.staleAfterDays).toBe(14);
  expect(config.github).toEqual({ autoSync: true, autoSyncMinutes: 15, initialSyncDays: 30, owners: { include: [], exclude: [] } });
});
test('an invalid display setting warns and uses the default', () => {
  const warn = jest.fn();
  const { config } = normalizeConfig('c.json', { deviceId: 'D', staleAfterDays: 'soon', weekStartsOn: 9 }, warn);
  expect(config.staleAfterDays).toBe(14);
  expect(config.weekStartsOn).toBe(1);
  expect(warn).toHaveBeenCalledWith('config c.json: staleAfterDays must be a positive integer; using 14');
  expect(warn).toHaveBeenCalledWith('config c.json: weekStartsOn must be an integer from 0 to 6; using 1');
});
test('valid new settings are kept', () => {
  const warn = jest.fn();
  const { config } = normalizeConfig('c.json', {
    deviceId: 'D', weekStartsOn: 0, staleAfterDays: 3,
    github: { autoSync: false, autoSyncMinutes: 5, initialSyncDays: 7, owners: { include: ['a'], exclude: ['b'] } },
  }, warn);
  expect(config.weekStartsOn).toBe(0);
  expect(config.staleAfterDays).toBe(3);
  expect(config.github).toEqual({ autoSync: false, autoSyncMinutes: 5, initialSyncDays: 7, owners: { include: ['a'], exclude: ['b'] } });
  expect(warn).not.toHaveBeenCalled();
});
test('a bad alias map still throws', () =>
  expect(() => normalizeConfig('c.json', { projectAliases: { a: 1 } }, () => {})).toThrow('projectAliases must be an object of strings'));
test('github settings warn and use defaults', () => {
  const warn = jest.fn();
  const { config } = normalizeConfig('c.json', {
    deviceId: 'D',
    github: { autoSync: 'yes', autoSyncMinutes: 0, initialSyncDays: 1.5, owners: { include: 'acme', exclude: [1] } },
  }, warn);
  expect(config.github).toEqual({ autoSync: true, autoSyncMinutes: 15, initialSyncDays: 30, owners: { include: [], exclude: [] } });
  expect(warn).toHaveBeenCalledWith('config c.json: github.owners.include must be an array of strings; using []');
  expect(warn).toHaveBeenCalledWith('config c.json: github.owners.exclude must be an array of strings; using []');
  expect(warn).toHaveBeenCalledWith('config c.json: github.autoSync must be true or false; using true');
  expect(warn).toHaveBeenCalledWith('config c.json: github.autoSyncMinutes must be a positive integer; using 15');
  expect(warn).toHaveBeenCalledWith('config c.json: github.initialSyncDays must be a positive integer; using 30');
});
test('changed is true only when a Phase 1 key is missing', () => {
  const full = { deviceId: 'D', projectAliases: {}, tagAliases: {}, ticketPrefixes: [] };
  expect(normalizeConfig('c.json', full, () => {}).changed).toBe(false);
  expect(normalizeConfig('c.json', { ...full, ticketPrefixes: undefined }, () => {}).changed).toBe(true);
});
