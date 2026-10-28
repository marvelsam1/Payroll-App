/** Jest config — unit + integration tests (integration tests require the local Postgres from `npm run db:setup`). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  setupFiles: ['<rootDir>/test/load-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  collectCoverageFrom: [
    'src/tax-engine/**/*.ts',
    'src/ledger/**/*.ts',
    '!src/**/*.module.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  testTimeout: 30000,
  maxWorkers: 1,
};
