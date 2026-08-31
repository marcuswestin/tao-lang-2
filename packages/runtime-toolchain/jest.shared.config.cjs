function createRuntimeJestConfig(options) {
  const dependencyRoot = process.env.TAO_TEST_NODE_MODULES_ROOT ?? '<rootDir>/node_modules'
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
      '^@jest/globals$': `${dependencyRoot}/@jest/globals`,
      '^@babel/runtime/(.*)$': `${dependencyRoot}/@babel/runtime/$1`,
      '^react$': `${dependencyRoot}/react`,
      '^react/jsx-dev-runtime$': `${dependencyRoot}/react/jsx-dev-runtime`,
      '^react/jsx-runtime$': `${dependencyRoot}/react/jsx-runtime`,
      '^react-native$': `${dependencyRoot}/react-native`,
      '^react-native-safe-area-context$': '<rootDir>/runtime-toolchain-tests/safe-area-context-mock.tsx',
      '^@react-native-async-storage/async-storage$': '<rootDir>/runtime-toolchain-tests/async-storage-mock.ts',
    },
    // Bun isolated installs put React Native's ESM Jest setup under node_modules/.bun,
    // outside the path shape handled by jest-expo's default transform allowlist.
    transformIgnorePatterns: [],
  }
}

module.exports = { createRuntimeJestConfig }
