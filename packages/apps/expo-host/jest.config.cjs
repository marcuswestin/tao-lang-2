const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

module.exports = createRuntimeJestConfig({
  testMatch: ['<rootDir>/expo-host-tests/*.jest-test.ts?(x)'],
})
