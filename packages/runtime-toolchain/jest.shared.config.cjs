function createRuntimeJestConfig(options) {
  const dependencyRoot = process.env.TAO_TEST_NODE_MODULES_ROOT ?? '<rootDir>/node_modules'
  return {
    preset: 'jest-expo',
    testTimeout: options.testTimeout ?? 30_000,
    testMatch: options.testMatch,
    // Jest builds the file map it discovers tests from by crawling `roots`, and `roots` defaults to
    // `rootDir` — this whole package. `rootDir` also holds `_gen_tao-app-test`, the cache of
    // compiled run roots, and that cache exists in order to grow: retaining a passing run root is
    // what spares the next run its compile. So the better the cache works, the longer the crawl
    // gets, and every run pays it whether or not it reuses anything. Measured at 34,337 cached
    // files, a whole-package crawl cost 1.22s against 0.22s for the two directories below.
    //
    // Naming the directories a run actually reads is what takes that off, and it is safe because
    // Jest resolves a path against the filesystem rather than against this map. The mapped
    // `@runtime/*` and `@shared/*` modules already prove it: they live outside `rootDir` altogether
    // and resolve. A config that generates test files elsewhere adds that directory to this list.
    roots: options.roots ?? ['<rootDir>/runtime-toolchain-tests', '<rootDir>/runtime-toolchain-src'],
    moduleNameMapper: {
      '^@runtime/TR$': '<rootDir>/../runtime/TaoRuntime-src/TR.ts',
      '^@tao/runtime$': '<rootDir>/../runtime/TaoRuntime-src/TR.ts',
      '^@tao/runtime/core$': '<rootDir>/../runtime/TaoRuntime-src/core/Effects.ts',
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
