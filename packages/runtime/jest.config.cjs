const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

module.exports = createRuntimeJestConfig({
  testMatch: ['<rootDir>/runtime-tests/*.jest-test.ts?(x)'],
})
