import { parseRemoteUrl, projectFor } from '../../src/core';

test.each([
  ['git@github.com:acme/collection-app.git', 'acme/collection-app'],
  ['https://github.com/aelshinawy/gournal', 'aelshinawy/gournal'],
  ['ssh://git@github.com/acme/x.git', 'acme/x'],
  ['/local/path/repo', null],
])('parseRemoteUrl(%s)', (url, want) => expect(parseRemoteUrl(url)).toBe(want));

test('alias keys: full repo, then repo name, then folder', () => {
  expect(projectFor({ repo: 'acme/x', folder: 'x' }, { 'acme/x': 'X App' })).toBe('X App');
  expect(projectFor({ repo: 'acme/x', folder: 'y' }, { x: 'By Name' })).toBe('By Name');
  expect(projectFor({ repo: null, folder: 'scratch' }, { scratch: 'Scratch Pad' })).toBe('Scratch Pad');
  expect(projectFor({ repo: 'acme/x', folder: 'x' }, {})).toBe('x');
  expect(projectFor({ repo: 'acme/x', folder: 'y' }, {})).toBe('x');
  expect(projectFor({ repo: null, folder: 'scratch' }, {})).toBe('scratch');
  expect(projectFor({ repo: null, folder: null }, {})).toBe('uncategorized');
});
