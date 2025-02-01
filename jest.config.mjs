export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['@swc/jest']
  },
  moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1'
    },
  testMatch: ['**/*.test.ts']
};