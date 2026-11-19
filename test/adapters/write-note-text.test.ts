import { writeNoteText } from '../../src/adapters/write-note-text';

describe('write-note-text', () => {
  test('writeNoteText words each Write note', () => {
    expect(writeNoteText({ type: 'similarTag', tag: 'reveiw', close: ['review', 'reviews'] })).toBe('New tag "reveiw". Close existing tags: review, reviews');
    expect(writeNoteText({ type: 'resolveDropped', id: 'ZZZZZZZZ', reason: 'No entry with id "ZZZZZZZZ"' })).toBe('Could not resolve ZZZZZZZZ: No entry with id "ZZZZZZZZ"');
    expect(writeNoteText({ type: 'split' })).toBe('Summary was too long and was split; full text is in details.');
  });
});
