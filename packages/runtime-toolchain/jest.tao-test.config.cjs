const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')

// `tao test` generates one Jest entrypoint per worker its run is allowed, into the run root holding
// the compiled apps, and names that directory here. Jest distributes test files rather than cases,
// so a run declaring its whole manifest in one entrypoint has nothing for its worker pool to hand
// out. `test-harness-files.ts` writes them and owns this environment key; a config Jest loads
// cannot import it, so the two are kept in step by hand.
// A run that names no directory — a bare `jest --config` — falls back to the entrypoint that
// declares the whole manifest itself.
const entrypointRoot = process.env.TAO_TEST_RUNTIME_ENTRYPOINTS

const base = createRuntimeJestConfig({
  testMatch: entrypointRoot === undefined
    ? ['<rootDir>/runtime-toolchain-tests/tao-test-command.jest.tsx']
    : [`${entrypointRoot}/*.jest.tsx`],
})

module.exports = {
  ...base,
  // `jest.shared.config.cjs` owns why `roots` is named rather than left to default. This run also
  // reads the entrypoints it just generated, which live outside the package, so it adds that one
  // directory. The compiled apps those entrypoints import need no root of their own: they are
  // required by absolute path.
  roots: [...(entrypointRoot === undefined ? [] : [entrypointRoot]), ...base.roots],
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // A generated entrypoint sits an unknowable number of directories below the package root, so it
    // names its harness rather than spelling a path back up to it.
    '^@tao-test-harness$': '<rootDir>/runtime-toolchain-tests/tao-journey-harness',
  },
  setupFilesAfterEnv: [
    '<rootDir>/runtime-toolchain-src/testing/device-module-mocks/tao-device-modules.setup.ts',
  ],
  // Jest prints the per-case tree on its own only while a run has exactly one test file. Splitting a
  // run across entrypoints must not cost that tree: it is what `tao test` shows a reader, and what
  // Tao Studio parses its per-journey results out of.
  verbose: true,
}
