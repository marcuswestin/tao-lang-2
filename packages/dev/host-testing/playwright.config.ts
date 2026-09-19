import { defineConfig } from '@playwright/test'
import { FS, Platform, Repo } from '@shared'

const artifactRoot = Platform.runtimeProcess.env['TAO_HOST_TEST_ARTIFACTS']
  ?? Repo.resolvePath(`.artifacts/host-testing/${Platform.randomUUID()}`)

export default defineConfig({
  testDir: '.',
  tsconfig: FS.resolvePath('packages/dev/host-testing/tsconfig.json', Repo.getRoot()),
  outputDir: FS.resolvePath('results', artifactRoot),
  reporter: [
    ['list'],
    ['json', { outputFile: FS.resolvePath('playwright.json', artifactRoot) }],
  ],
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: Platform.runtimeProcess.env['TAO_HOST_TEST_URL'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'controls',
      testMatch: [
        'app-build/FaultVerdict.host.spec.ts',
        'environment/clockwork.host.spec.ts',
        'enforcement/EffectBoundaryLint.host.spec.ts',
        'native/cloudkit-config.host.spec.ts',
      ],
    },
    {
      name: 'browser',
      testMatch: Platform.runtimeProcess.env['TAO_HOST_TEST_APP'] === 'clockwork'
        ? ['browser/clockwork.host.spec.ts', 'environment/clockwork-browser.host.spec.ts']
        : ['browser/hnreader.host.spec.ts'],
      use: {
        browserName: 'chromium',
        channel: Platform.runtimeProcess.env['TAO_HOST_TEST_BROWSER_CHANNEL'] === 'chromium'
          ? undefined
          : Platform.runtimeProcess.env['TAO_HOST_TEST_BROWSER_CHANNEL'] ?? 'chrome',
      },
    },
  ],
})
