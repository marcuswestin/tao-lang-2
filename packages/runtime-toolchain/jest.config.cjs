const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

module.exports = createRuntimeJestConfig({
  testMatch: ['<rootDir>/runtime-toolchain-tests/*.jest-test.ts?(x)'],
})
