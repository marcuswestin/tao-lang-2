import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { Errors, FS, Platform } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'
import { partitionTaoTestFiles } from './tao-test-sharding'

const { taoTestShardCount } = require('./tao-test-shard-config.cjs') as {
  taoTestShardCount(rawCount?: string): number
}

/** registerTaoTestShard publishes one static Jest entry's share of the compiled test manifest. */
export function registerTaoTestShard(shardIndex: number): void {
  const shardCount = requestedShardCount()
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    Errors.throwHostEnvironment(`Tao test shard index ${shardIndex} is outside the configured ${shardCount} shards.`)
  }
  AfterEach(() => cleanup())
  Describe(`Tao test command (shard ${shardIndex + 1}/${shardCount})`, () => {
    for (const file of partitionTaoTestFiles(requestedManifest().files, shardCount)[shardIndex]!) {
      Test(FS.basename(file.sourcePath), async () => {
        await RuntimeTesting.runTestFile(file)
      })
    }
  })
}

function requestedManifest(): RuntimeTesting.TestCompiler.Manifest {
  const manifestPath = Platform.runtimeProcess.env[RuntimeTesting.TEST_MANIFEST_ENV]
  if (!manifestPath) {
    Errors.throwHostEnvironment(`${RuntimeTesting.TEST_MANIFEST_ENV} is required`)
  }
  return JSON.parse(FS.readTextSync(manifestPath)) as RuntimeTesting.TestCompiler.Manifest
}

function requestedShardCount(): number {
  return taoTestShardCount(Platform.runtimeProcess.env['TAO_TEST_SHARD_COUNT'])
}
