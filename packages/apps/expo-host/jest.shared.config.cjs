const os = require('node:os')
const { root: directCacheRoot } = require('./jest-direct-cache.cjs')

// The per-journey budget an uncontended machine keeps. A Tao journey compiles and renders a whole
// app, so its floor sits far above Jest's five-second default.
const JOURNEY_BUDGET_MS = 30_000
// Past this a deadline no longer tells a starved journey from a hung one. It sits under the Bun
// runner's 120s ceiling on purpose: tao test runs Jest inside a Bun test, and the inner bound has
// to fire first so the journey, not the test around it, is what the report names.
const MAX_JOURNEY_DEADLINE_MS = 90_000

/**
 * Jest's deadline is wall time: the work a journey did plus the time it spent off CPU waiting for
 * the rest of the machine. Held fixed, it judges a journey by how busy the host is — one tutorial
 * journey ran 50s and was killed at a flat 30s with the load average at 52 on 18 CPUs, and passed
 * alone. So the budget stays fixed and only the deadline stretches by the run-queue depth, the way
 * the repository's Bun runner already does (`TestRunner.ts`, `starvationAdjustedTimeoutMs`), with
 * the same allowance for the one-minute average lagging the load a test is feeling.
 */
function starvationAdjustedTimeoutMs(budgetMs) {
  const observed = os.loadavg()[0] / Math.max(1, os.cpus().length) * 2
  return Math.min(Math.round(budgetMs * Math.max(observed, 1)), MAX_JOURNEY_DEADLINE_MS)
}

function createRuntimeJestConfig(options) {
  const managedCacheDirectory = process.env.TAO_TEST_JEST_CACHE_DIRECTORY
  const dependencyRoot = process.env.TAO_TEST_NODE_MODULES_ROOT ?? '<rootDir>/node_modules'
  // Inside the repository the runtime and `@shared` sit where the package layout puts them relative
  // to this host. An installed Tao has no repository around its host, so it names both instead
  // (`RuntimeToolchainPaths.expoEnvironment`), as it does for `metro.config.cjs`.
  const runtimeSourceRoot = process.env.TAO_RUNTIME_SOURCE_ROOT ?? '<rootDir>/../runtime/TaoRuntime-src'
  const sharedSourceRoot = process.env.TAO_SHARED_SOURCE_ROOT ?? '<rootDir>/../../shared/shared-src'
  return {
    preset: 'jest-expo',
    cacheDirectory: managedCacheDirectory ?? `${directCacheRoot(__dirname)}/data`,
    ...(managedCacheDirectory === undefined
      ? {
        globalSetup: require.resolve('./jest-direct-cache-setup.cjs'),
        globalTeardown: require.resolve('./jest-direct-cache-teardown.cjs'),
      }
      : {}),
    // Generated Tao apps may live outside the package's ancestor chain. Resolve workspace packages
    // from this runtime package's installed links.
    modulePaths: ['<rootDir>/node_modules'],
    testTimeout: starvationAdjustedTimeoutMs(options.testTimeout ?? JOURNEY_BUDGET_MS),
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
    roots: options.roots ?? ['<rootDir>/expo-host-tests', '<rootDir>/expo-host-src'],
    moduleNameMapper: {
      '^@runtime/TR$': `${runtimeSourceRoot}/TR.ts`,
      '^@tao/runtime$': `${runtimeSourceRoot}/TR.ts`,
      '^@tao/runtime/core$': `${runtimeSourceRoot}/core/RuntimeCore.ts`,
      '^@runtime/(.*)$': `${runtimeSourceRoot}/$1`,
      '^@expo-host$': '<rootDir>/expo-host-src/runtime.ts',
      '^@expo-host/(.*)$': '<rootDir>/expo-host-src/$1',
      '^@shared$': `${sharedSourceRoot}/shared.ts`,
      '^@shared/core$': `${sharedSourceRoot}/core/shared-core.ts`,
      '^@shared/test$': `${sharedSourceRoot}/testing/Test-Jest.ts`,
      '^(\\.{1,2}/.*)\\.js$': '$1',
      '^@jest/globals$': `${dependencyRoot}/@jest/globals`,
      '^@babel/runtime/(.*)$': `${dependencyRoot}/@babel/runtime/$1`,
      '^react$': `${dependencyRoot}/react`,
      '^react/jsx-dev-runtime$': `${dependencyRoot}/react/jsx-dev-runtime`,
      '^react/jsx-runtime$': `${dependencyRoot}/react/jsx-runtime`,
      '^react-native$': `${dependencyRoot}/react-native`,
      '^react-native-safe-area-context$': '<rootDir>/expo-host-tests/safe-area-context-mock.tsx',
      '^@react-native-async-storage/async-storage$': '<rootDir>/expo-host-tests/async-storage-mock.ts',
      // Tao journeys exercise the portable controls. Installed optional native hosts are present
      // on development machines but cannot provide their device UI through react-test-renderer.
      '^@(react-native-community/(datetimepicker|slider)|react-native-picker/picker|react-native-segmented-control/segmented-control)$':
        '<rootDir>/expo-host-tests/optional-native-host-mock.cjs',
    },
    // Bun isolated installs put React Native's ESM Jest setup under node_modules/.bun,
    // outside the path shape handled by jest-expo's default transform allowlist.
    transformIgnorePatterns: [],
  }
}

module.exports = { MAX_JOURNEY_DEADLINE_MS, createRuntimeJestConfig }
