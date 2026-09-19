import { expect, test } from '@playwright/test'
import { FS, Repo } from '@shared'
import { nativeFlowPath } from './NativeHostProof'

test('resolves every Maestro flow from the worktree when a native build runs from a nested directory', () => {
  const nestedBuildRoot = Repo.resolvePath('packages/e2e-testing/native')

  expect(nativeFlowPath('flows/reset.yaml', nestedBuildRoot)).toBe(
    Repo.resolvePath('packages/e2e-testing/native/flows/reset.yaml'),
  )
  expect(nativeFlowPath('flows/clockwork.yaml', nestedBuildRoot)).toBe(
    Repo.resolvePath('packages/e2e-testing/native/flows/clockwork.yaml'),
  )
  expect(nativeFlowPath('flows/hnreader.yaml', nestedBuildRoot)).toBe(
    Repo.resolvePath('packages/e2e-testing/native/flows/hnreader.yaml'),
  )
})

test('HNReader observes the control receipt before continuing after its deep link', async () => {
  const flow = await FS.readText(Repo.resolvePath('packages/e2e-testing/native/flows/hnreader.yaml'))
  const steps = flow.split('\n').filter(step => step.length > 0 && step !== '---')
  const control =
    '- openLink: "taohostpoc-${TAO_HOST_TEST_RUN_ID}://control?runId=${TAO_HOST_TEST_RUN_ID}&advanceMs=1000"'

  const deepLink = steps.indexOf(control)
  expect(deepLink).toBeGreaterThan(-1)
  expect(steps.slice(deepLink + 1, deepLink + 6)).toEqual([
    '- runFlow:',
    '    when:',
    '      visible: "Open"',
    '    commands:',
    '      - tapOn: "Open"',
  ])
  expect(steps[deepLink + 6]).toBe('- assertVisible: "Control received: advance 1000ms"')
})
