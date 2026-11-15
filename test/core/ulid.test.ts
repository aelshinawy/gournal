import { newId } from '../../src/core';

test('ulid is 26 Crockford base32 chars', () => expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/));
test('ulids sort by time', () => expect(newId(1000) < newId(2000)).toBe(true));
test('ulids are unique', () => expect(new Set(Array.from({ length: 1000 }, () => newId(5))).size).toBe(1000));
