export default {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest']
  },
  moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1'
    },
  testTimeout: 30000,
  testMatch: ['**/*.test.ts'],
  // Git worktrees under .claude/ hold full copies of the test suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/']
};