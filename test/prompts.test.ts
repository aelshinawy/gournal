import { clearConfirmQuestion } from '../src/prompts';

test('clear confirmation defaults to no', () => {
  expect(clearConfirmQuestion.default).toBe(false);
});
