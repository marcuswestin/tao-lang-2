import { startDebouncedWatcher, WATCH_DEBOUNCE_MS } from '@expo-host/dev-loop/DebouncedWatcher'
import { FS, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, until, withCapturedOutput } from '@shared/test'
import { runTestCommandOnce } from '../cli-src/test-command'
import { runTestWatchCommand } from '../cli-src/test-watch'
import { withTaoFixture } from './test-cli-files'
import { taoApp, taoTest, withJestStub, withRuntimeRoot } from './test-command-fixtures'

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

      try {
        await withJestStub(rootDir, async () => {
          await withRuntimeRoot(runtimeRoot, async () => {
            let calls = 0
            const controller = new AbortController()

            const captured = await withCapturedOutput(async () => {
              const loop = runTestWatchCommand([rootDir], { output: 'quiet' }, {
                // The verification shell cannot receive native macOS file events; the product's
                // named host watch command uses native events instead.
                startWatcher: (onChange, roots) =>
                  startDebouncedWatcher(roots, onChange, { debounceMs: WATCH_DEBOUNCE_MS, usePolling: true }),
                runOnce: async () => {
                  const outcome = await runTestCommandOnce([rootDir], { output: 'quiet' })
                  calls += 1
                  return outcome
                },
                signal: controller.signal,
              })

              try {
                await until(() => calls === 1, { description: 'the initial watch compile', timeoutMs: 60_000 })
                // A watcher needs a moment to finish its initial scan before it reports later writes.
                await Time.sleep(200)

                await FS.writeText(
                  FS.resolvePath('App.tao', rootDir),
                  taoApp('WatchApp').replace('"WatchApp"', '"WatchAppEdited"'),
                )

                await until(() => calls === 2, { description: 'the edited watch compile', timeoutMs: 60_000 })
              } finally {
                controller.abort()
                await loop
              }
            })

            Expect(calls).toBe(2)
            // The edit changes the cache fingerprint, so the rerun compiles again rather than reusing.
            const compileCount = captured.stdout.split('Compiling apps').length - 1
            Expect(compileCount).toBe(2)
            Expect(captured.stdout).not.toContain('Reusing compiled apps')
          })
        })
      } finally {
        await FS.remove(runtimeRoot)
      }
    })
  }, 120_000)
})
