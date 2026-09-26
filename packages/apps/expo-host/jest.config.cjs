const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

const base = createRuntimeJestConfig({
  testMatch: ['<rootDir>/expo-host-tests/*.jest-test.ts?(x)'],
})

module.exports = {
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@compiler/native-bindings$': '<rootDir>/../../compiler/compiler-src/native-bindings.ts',
  },
}
