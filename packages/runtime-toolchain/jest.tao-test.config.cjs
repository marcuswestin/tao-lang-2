const { createRuntimeJestConfig } = require('./jest.shared.config.cjs')
const { taoTestShardCount } = require('./runtime-toolchain-tests/tao-test-shard-config.cjs')

const shardEntries = [
  '<rootDir>/runtime-toolchain-tests/tao-test-command.jest.tsx',
  '<rootDir>/runtime-toolchain-tests/tao-test-command-shard-2.jest.tsx',
  '<rootDir>/runtime-toolchain-tests/tao-test-command-shard-3.jest.tsx',
]

module.exports = {
  ...createRuntimeJestConfig({
    testMatch: shardEntries.slice(0, taoTestShardCount()),
  }),
  setupFilesAfterEnv: [
    '<rootDir>/runtime-toolchain-src/testing/device-module-mocks/tao-device-modules.setup.ts',
  ],
}
