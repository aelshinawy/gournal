import { endOfDay, startOfDay } from 'date-fns';
import { parseBound } from '../src/util/date-bounds.util';

test('date-only "to" is the end of that local day', () => {
  expect(parseBound('2026-11-15', 'to')).toBe(endOfDay(new Date(2026, 10, 15)).toISOString());
});
test('date-only "from" is the start of that local day', () => {
  expect(parseBound('2026-11-15', 'from')).toBe(startOfDay(new Date(2026, 10, 15)).toISOString());
});
test('a full timestamp passes through as UTC ISO', () => {
  expect(parseBound('2026-11-15T10:00:00+02:00', 'to')).toBe('2026-11-15T08:00:00.000Z');
});
test('an entry late on the "to" day is included', () => {
  const ts = new Date(2026, 10, 15, 23, 30).toISOString();
  expect(ts <= parseBound('2026-11-15', 'to')).toBe(true);
});
test('rejects an invalid date', () => {
  expect(() => parseBound('garbage', 'from')).toThrow('Invalid date: garbage');
});
