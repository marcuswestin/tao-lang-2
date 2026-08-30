const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

module.exports = {
  ...createRuntimeJestConfig({
    testMatch: ['<rootDir>/runtime-toolchain-tests/tao-test-command.jest.tsx'],
  }),
  setupFilesAfterEnv: [
    '<rootDir>/runtime-toolchain-src/testing/device-module-mocks/tao-device-modules.setup.ts',
  ],
}
