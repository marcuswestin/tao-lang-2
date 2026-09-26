import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  COMPILED,
  lifecycleFixture,
  listCachedFingerprints,
  listRunRoots,
  outputText,
  REUSED,
  reuseFixture,
  withEnv,
  withJestStub,
  withRuntimeRoot,
} from './test-command-fixtures'

Describe('tao test CLI output publication', () => {
  // A false green is worse than a slow suite, so only a run that both compiled and passed may be
  // handed to a later run.
  Test('publishes nothing a failing run compiled', async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': 'process.exit(1)\n' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const failed = await runTaoCliForTest(['test', rootDir])
          const again = await runTaoCliForTest(['test', rootDir])

          Expect(failed.exitCode).toBe(1)
          Expect(await listCachedFingerprints(runtimeRoot)).toEqual([])
          Expect(again.exitCode).toBe(1)
          Expect(outputText(again)).toContain(COMPILED)
          Expect(outputText(again)).not.toContain(REUSED)
        })
      })
    })
  })

  Test('compiles from source and publishes nothing when reuse is switched off', async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          await withEnv('TAO_TEST_NO_CACHE', 'true', async () => {
            const first = await runTaoCliForTest(['test', rootDir])
            const second = await runTaoCliForTest(['test', rootDir])

            Expect(first.exitCode).toBe(0)
            Expect(second.exitCode).toBe(0)
            Expect(outputText(second)).toContain(COMPILED)
            Expect(outputText(second)).not.toContain(REUSED)
            Expect(await listCachedFingerprints(runtimeRoot)).toEqual([])
            Expect(await listRunRoots(runtimeRoot)).toEqual([])
          })

          // The opt-out is per run, not a state it leaves behind: the next run caches again.
          Expect(outputText(await runTaoCliForTest(['test', rootDir]))).toContain(COMPILED)
          Expect(outputText(await runTaoCliForTest(['test', rootDir]))).toContain(REUSED)
        })
      })
    })
  })

  Test('keeps the generated run root of a failing suite for debugging', async () => {
    await withTaoFixture({ ...lifecycleFixture, 'jest-stub.mjs': 'process.exit(1)\n' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const result = await runTaoCliForTest(['test', rootDir])

          Expect(result.exitCode).toBe(1)
          const runRoots = await listRunRoots(runtimeRoot)
          Expect(runRoots.length).toBe(1)
          const manifestPath = `_gen_tao-app-test/tao-test-command/${runRoots[0]}/manifest.json`
          Expect(await FS.isFile(FS.resolvePath(manifestPath, runtimeRoot))).toBe(true)
        })
      })
    })
  })
})
