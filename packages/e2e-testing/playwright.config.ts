import { defineConfig } from '@playwright/test'
import { FS, Platform, Repo } from '@shared'

const artifactRoot = Platform.runtimeProcess.env['TAO_HOST_TEST_ARTIFACTS']
  ?? Repo.resolvePath(`.artifacts/host-testing/${Platform.randomUUID()}`)
const packageRoot = FS.resolvePath('packages/e2e-testing', Repo.getRoot())

export default defineConfig({
  testDir: packageRoot,
  tsconfig: FS.resolvePath('tsconfig.json', packageRoot),
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
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'controls',
      testMatch: [
        'app-build/**/*.host.spec.ts',
        'controls/**/*.host.spec.ts',
        'enforcement/**/*.host.spec.ts',
        'environment/**/*.host.spec.ts',
        'native/**/*.host.spec.ts',
      ],
    },
    {
      name: 'browser',
      testMatch: Platform.runtimeProcess.env['TAO_HOST_TEST_APP'] === 'clockwork'
        ? ['browser/clockwork*.host.spec.ts']
        : ['browser/hnreader*.host.spec.ts'],
      use: {
        browserName: 'chromium',
        channel: Platform.runtimeProcess.env['TAO_HOST_TEST_BROWSER_CHANNEL'] === 'chromium'
          ? undefined
          : Platform.runtimeProcess.env['TAO_HOST_TEST_BROWSER_CHANNEL'] ?? 'chrome',
      },
    },
  ],
})
