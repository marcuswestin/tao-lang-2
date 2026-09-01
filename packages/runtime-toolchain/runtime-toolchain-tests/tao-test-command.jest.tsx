import { RuntimeTesting } from '@runtime-toolchain/testing/runtime-testing'
import { Errors, FS, Platform } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

AfterEach(() => cleanup())

Describe('Tao test command', () => {
  for (const file of requestedManifest().files) {
    Test(FS.basename(file.sourcePath), async () => {
      await RuntimeTesting.runTestFile(file)
    })
  }
})

function requestedManifest(): RuntimeTesting.TestCompiler.Manifest {
  const manifestPath = Platform.runtimeProcess.env[RuntimeTesting.TEST_MANIFEST_ENV]
  if (!manifestPath) {
    Errors.throwHostEnvironment(`${RuntimeTesting.TEST_MANIFEST_ENV} is required`)
  }
  return JSON.parse(FS.readTextSync(manifestPath)) as RuntimeTesting.TestCompiler.Manifest
}
