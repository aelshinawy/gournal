import { wrapEmitWarning } from '../src/adapters/suppress-warnings';

const make = () => {
  const calls: unknown[][] = [];
  const emit = jest.fn(function (this: unknown, ...a: unknown[]) { calls.push(a); }) as unknown as typeof process.emitWarning;
  return { emit, calls, wrapped: wrapEmitWarning(emit) };
};

test('the SQLite experimental warning is dropped', () => {
  const { wrapped, calls } = make();
  wrapped('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
  expect(calls).toEqual([]);
});

test('every other warning goes through with its arguments', () => {
  const { wrapped, calls } = make();
  wrapped('Something else is deprecated', 'DeprecationWarning', 'DEP0001');
  wrapped('Another experimental feature', 'ExperimentalWarning');
  expect(calls).toEqual([
    ['Something else is deprecated', 'DeprecationWarning', 'DEP0001'],
    ['Another experimental feature', 'ExperimentalWarning'],
  ]);
});

test('a SQLite text in a non-experimental warning is kept', () => {
  const { wrapped, calls } = make();
  wrapped('SQLite file is large', 'Warning');
  expect(calls).toHaveLength(1);
});

test('an Error warning object is filtered by its name and message', () => {
  const { wrapped, calls } = make();
  const err = Object.assign(new Error('SQLite is an experimental feature'), { name: 'ExperimentalWarning' });
  wrapped(err);
  expect(calls).toEqual([]);
});
