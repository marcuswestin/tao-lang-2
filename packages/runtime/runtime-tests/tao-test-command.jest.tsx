import { RuntimeTesting } from '@runtime/testing/runtime-testing'
import { FS, Platform } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

AfterEach(() => cleanup())

Describe('Tao test command', () => {
  Test('runs manifest files', async () => {
    const manifest = await requestedManifest()
    for (const file of manifest.files) {
      await RuntimeTesting.runTestFile(file)
    }
  })
})

async function requestedManifest(): Promise<RuntimeTesting.TestCompiler.Manifest> {
  const manifestPath = Platform.runtimeProcess.env[RuntimeTesting.TEST_MANIFEST_ENV]
  if (!manifestPath) {
    throw new Error(`${RuntimeTesting.TEST_MANIFEST_ENV} is required`)
  }
  return await FS.readJson<RuntimeTesting.TestCompiler.Manifest>(manifestPath)
}
