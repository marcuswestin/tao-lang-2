import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { jest } from '@jest/globals'
import { Repo } from '@shared'
import { Describe, Test } from '@shared/test'
import { registerRuntimeE2ELifecycle } from './test-compile-app'

// This lane proves the owned cancellation protocol, not installed native timing.
jest.mock('@runtime/TR-continuous-clock', () => ({ nowMilliseconds: () => 0 }))
registerRuntimeE2ELifecycle()

Describe('Syntax2 lifecycle fixture', () => {
  Test('executes the authored owned-resource cancellation and joined cleanup journey', async () => {
    await RuntimeTesting.runTaoTestPlan(Repo.resolvePath('Apps/Syntax2/.host-tests/Lifecycle.test.tao'))
  })
})
