import { createTaoTestRuntimeContext, runTaoTestPlan } from '@runtime/testing/tao-test-plan'
import { FS, Platform } from '@shared'
import { AfterEach, Describe, Test } from '@shared/test'
import { cleanup } from '@testing-library/react-native'

const TEST_PLAN_ENV = 'TAO_TEST_PLAN_PATHS'
const runtimeContext = createTaoTestRuntimeContext()

AfterEach(() => cleanup())

Describe('Tao test command', () => {
  for (const testPath of requestedTestPlanPaths()) {
    Test(displayPath(testPath), async () => {
      await runTaoTestPlan(testPath, runtimeContext)
    })
  }
})

function requestedTestPlanPaths(): string[] {
  const encoded = Platform.runtimeProcess.env[TEST_PLAN_ENV]
  if (!encoded) {
    throw new Error(`${TEST_PLAN_ENV} is required`)
  }
  const parsed = JSON.parse(encoded) as unknown
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error(`${TEST_PLAN_ENV} must be a JSON array of file paths`)
  }
  return parsed
}

function displayPath(path: string): string {
  const relative = FS.relativePath(FS.repoPath(), path)
  return relative.startsWith('..') ? path : relative
}
