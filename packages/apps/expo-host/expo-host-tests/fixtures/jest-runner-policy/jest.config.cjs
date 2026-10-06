const path = require('node:path')
const { createRuntimeJestConfig } = require('../../../jest.shared.config.cjs')
const hostRoot = path.resolve(__dirname, '../../..')
const jestRoot = path.dirname(require.resolve('jest/package.json', { paths: [hostRoot] }))
const cliRoot = path.dirname(require.resolve('jest-cli', { paths: [jestRoot] }))

module.exports = {
  ...createRuntimeJestConfig({ testMatch: [`${__dirname}/execution.probe.cjs`], roots: [__dirname] }),
  rootDir: hostRoot,
  preset: undefined,
  setupFiles: [],
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,
  cacheDirectory: '<rootDir>/../../../.artifacts/jest-policy-probe',
  moduleNameMapper: {},
  transform: {},
  // These fixed-file execution probes do not need Watchman, which refuses low-priority CI children.
  watchman: false,
  testEnvironment: require.resolve(`jest-environment-${process.env.TAO_JEST_PROBE_ENVIRONMENT ?? 'node'}`, {
    paths: [cliRoot],
  }),
  // A deliberately tiny runner deadline makes suppression prove itself in real execution.
  testTimeout: 1,
}
