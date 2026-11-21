import base, { siteTests } from './jest.config.mjs';

export default {
  ...base,
  testMatch: ['**/test/{site,docs}-*.test.ts'],
  testPathIgnorePatterns: base.testPathIgnorePatterns.filter((p) => p !== siteTests)
};
