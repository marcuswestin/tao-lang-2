import { defineConfig } from '@playwright/test'
import { FS, Platform, Repo } from '@shared'

const artifactRoot = Platform.runtimeProcess.env['TAO_HOST_TEST_ARTIFACTS']
  ?? Repo.resolvePath(`.artifacts/host-testing/${Platform.randomUUID()}`)
const packageRoot = FS.resolvePath('packages/testing/e2e-testing', Repo.getRoot())

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
  // Playwright fails a test at whichever of `timeout` and `expect.timeout` elapses first, so holding
  // them equal let the test's own wall clock cut an `expect(...)` wait off before its own budget did —
  // the same dead-budget shape `until`'s 30s default hit against the test runner's own per-test
  // timeout. Kept above `expect.timeout` so a real browser wait gets the full budget below to run out
  // on its own terms and report what it was waiting for.
  timeout: 90_000,
  // A wall-clock budget on a real browser wait is for a busy host, not for a slow condition.
  expect: { timeout: 30_000 },
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
        'journey/**/*.host.spec.ts',
        'native/**/*.host.spec.ts',
      ],
    },
    {
      // The driver suite launches an installed browser through the Playwright driver itself.
      // It is deliberately separate from the host-free controls project, and the adapter owns
      // each session trace rather than sharing Playwright Test's context instrumentation.
      name: 'driver',
      testMatch: ['driver/**/*.host.spec.ts'],
      use: { trace: 'off' },
    },
    {
      name: 'browser',
      testMatch: Platform.runtimeProcess.env['TAO_HOST_TEST_APP'] === 'clockwork'
        ? ['browser/clockwork*.host.spec.ts']
        : Platform.runtimeProcess.env['TAO_HOST_TEST_APP'] === 'reading-list'
        ? ['browser/reading-list.host.spec.ts']
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
