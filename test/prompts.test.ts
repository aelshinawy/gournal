import { clearConfirmQuestion } from '../src/adapters/cli/prompts';

test('clear confirmation defaults to no', () => {
  expect(clearConfirmQuestion.default).toBe(false);
});
