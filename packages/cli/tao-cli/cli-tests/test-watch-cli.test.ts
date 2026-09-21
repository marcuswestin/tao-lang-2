import { Errors, FS, Platform, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { runTestCommandOnce } from '../cli-src/test-command'
import { runTestWatchCommand } from '../cli-src/test-watch'
import { withTaoFixture } from './test-cli-files'

const taoApp = (name: string) => `
  use Text from @tao/ui
  app ${name} { view Main }
  view Main() { render Text("${name}") }
`

const taoTest = (name: string) => `
  use ${name} from ./
  test "${name}" {
    test "runs" {
      run ${name}
      expect text "${name}"
    }
  }
`

/** withJestStub points the runtime test runner at an inert module for the duration of one test. */
async function withJestStub(rootDir: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_JEST_PATH', FS.resolvePath('jest-stub.mjs', rootDir), run)
}

/** withRuntimeRoot compiles one run's generated code under a throwaway runtime package root. */
async function withRuntimeRoot(runtimeRoot: string, run: () => Promise<void>): Promise<void> {
  await withEnv('TAO_TEST_RUNTIME_ROOT', runtimeRoot, run)
}

async function withEnv(name: string, value: string | undefined, run: () => Promise<void>): Promise<void> {
  const previous = Platform.runtimeProcess.env[name]
  if (value === undefined) {
    delete Platform.runtimeProcess.env[name]
  } else {
    Platform.runtimeProcess.env[name] = value
  }
  try {
    await run()
  } finally {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env[name]
    } else {
      Platform.runtimeProcess.env[name] = previous
    }
  }
}

/** waitUntil polls `condition` until it is true or `timeoutMs` elapses. */
async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      Errors.throwUnexpected('waitUntil timed out waiting for a tao test --watch run.')
    }
    await Time.sleep(20)
  }
}

Describe('tao test --watch (real compile)', () => {
  // The one slow, real-pipeline test for `--watch`: it compiles for real, twice, with a real Jest
  // child stubbed inert, and proves the loop reruns on a real file change and stops on abort.
  Test('reruns once after an edited fixture file compiles again, then stops on abort', async () => {
    await withTaoFixture({
      'Project.tao': 'project { id "watch-cli-test" name "Watch CLI test" }',
      'App.tao': taoApp('WatchApp'),
      'App.test.tao': taoTest('WatchApp'),
      'jest-stub.mjs': '',
    }, async rootDir => {
      // Outside the watched project on purpose: a run writes its compiled output here, and a
      // runtime root inside the project would make every run trigger the next one.
      const runtimeRoot = await mkTestDir('tao-test-watch-runtime-')

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          let calls = 0
          const controller = new AbortController()

          const captured = await withCapturedOutput(async () => {
            const loop = runTestWatchCommand([rootDir], { output: 'quiet' }, {
              runOnce: async () => {
                const outcome = await runTestCommandOnce([rootDir], { output: 'quiet' })
                calls += 1
                return outcome
              },
              signal: controller.signal,
            })

            await waitUntil(() => calls === 1, 60_000)
            // A watcher needs a moment to finish its initial scan before it reports later writes.
            await Time.sleep(200)

            await FS.writeText(
              FS.resolvePath('App.tao', rootDir),
              taoApp('WatchApp').replace('"WatchApp"', '"WatchAppEdited"'),
            )

            await waitUntil(() => calls === 2, 60_000)

            controller.abort()
            await loop
          })

          Expect(calls).toBe(2)
          // The edit changes the cache fingerprint, so the rerun compiles again rather than reusing.
          const compileCount = captured.stdout.split('Compiling apps').length - 1
          Expect(compileCount).toBe(2)
          Expect(captured.stdout).not.toContain('Reusing compiled apps')
        })
      })
    })
  }, 120_000)
})
