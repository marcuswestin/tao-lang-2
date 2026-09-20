import { expect, test } from '@playwright/test'
import { runPlaywrightHostDriverProof } from '../DriverHostProof'
import type { DriverHostTestingRequest, HostTestingContext } from '../HostTestingRequest'

test('runs the five browser-driver proofs through the dedicated driver project', async () => {
  const calls: unknown[][] = []
  await runPlaywrightHostDriverProof(request(), context(), {
    recordedCommand: async (...args) => {
      calls.push(args)
    },
  })

  expect(calls).toEqual([[
    'playwright-driver',
    'node',
    expect.objectContaining({
      args: [
        'playwright-cli.js',
        'test',
        '--config',
        'packages/e2e-testing/playwright.config.ts',
        '--project',
        'driver',
      ],
      env: { TAO_HOST_TEST_BROWSER_CHANNEL: 'chrome' },
      processPolicy: 'test',
    }),
    'artifact-root',
  ]])
})

function request(): DriverHostTestingRequest {
  return {
    browserChannel: 'chrome',
    kind: 'driver',
    mode: 'driver',
    seed: 12345,
    subject: 'hnreader',
  }
}

function context(): HostTestingContext {
  return {
    artifactRoot: 'artifact-root',
    environment: { TAO_HOST_TEST_BROWSER_CHANNEL: 'chrome' },
    playwright: 'playwright-cli.js',
    runId: 'run-id',
  }
}
