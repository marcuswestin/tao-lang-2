const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

const base = createRuntimeJestConfig({
  testMatch: ['<rootDir>/expo-host-tests/*.jest-test.ts?(x)'],
})

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@native-bindings$': '<rootDir>/../../native-bindings/native-bindings-src/native-bindings.ts',
  },
}
