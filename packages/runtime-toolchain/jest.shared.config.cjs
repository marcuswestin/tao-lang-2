function createRuntimeJestConfig(options) {
  return {
    preset: 'jest-expo',
    testTimeout: options.testTimeout ?? 30_000,
    testMatch: options.testMatch,
    moduleNameMapper: {
      '^@runtime/TR$': '<rootDir>/../runtime/TaoRuntime-src/TR.ts',
      '^@runtime/(.*)$': '<rootDir>/../runtime/TaoRuntime-src/$1',
      '^@runtime-toolchain$': '<rootDir>/runtime-toolchain-src/runtime.ts',
      '^@runtime-toolchain/(.*)$': '<rootDir>/runtime-toolchain-src/$1',
      '^@shared$': '<rootDir>/../shared/shared-src/shared.ts',
      '^@shared/core$': '<rootDir>/../shared/shared-src/core/shared-core.ts',
      '^@shared/test$': '<rootDir>/../shared/shared-src/testing/Test-Jest.ts',
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^@jest/globals$': '<rootDir>/node_modules/@jest/globals',
      '^@babel/runtime/(.*)$': '<rootDir>/node_modules/@babel/runtime/$1',
      '^react$': '<rootDir>/node_modules/react',
      '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime',
      '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
      '^react-native$': '<rootDir>/node_modules/react-native',
      '^react-native-safe-area-context$': '<rootDir>/runtime-toolchain-tests/safe-area-context-mock.tsx',
    },
    // Bun isolated installs put React Native's ESM Jest setup under node_modules/.bun,
    // outside the path shape handled by jest-expo's default transform allowlist.
    transformIgnorePatterns: [],
  }
}

module.exports = { createRuntimeJestConfig }
