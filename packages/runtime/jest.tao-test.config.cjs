const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

module.exports = createRuntimeJestConfig({
  testMatch: ['<rootDir>/runtime-tests/tao-test-command.jest.tsx'],
})
