import { parseRemoteUrl, projectFor } from '../../src/core';

test.each([
  ['git@github.com:acme/collection-app.git', 'acme/collection-app'],
  ['https://github.com/aelshinawy/gournal', 'aelshinawy/gournal'],
  ['ssh://git@github.com/acme/widgets.git', 'acme/widgets'],
  ['/local/path/repo', null],
])('parseRemoteUrl(%s)', (url, want) => expect(parseRemoteUrl(url)).toBe(want));

test('alias keys: full repo, then repo name, then folder', () => {
  expect(projectFor({ repo: 'acme/widgets', folder: 'widgets' }, { 'acme/widgets': 'Widgets App' })).toBe('Widgets App');
  expect(projectFor({ repo: 'acme/widgets', folder: 'y' }, { widgets: 'By Name' })).toBe('By Name');
  expect(projectFor({ repo: null, folder: 'scratch' }, { scratch: 'Scratch Pad' })).toBe('Scratch Pad');
  expect(projectFor({ repo: 'acme/widgets', folder: 'widgets' }, {})).toBe('widgets');
  expect(projectFor({ repo: 'acme/widgets', folder: 'y' }, {})).toBe('widgets');
  expect(projectFor({ repo: null, folder: 'scratch' }, {})).toBe('scratch');
  expect(projectFor({ repo: null, folder: null }, {})).toBe('uncategorized');
});
