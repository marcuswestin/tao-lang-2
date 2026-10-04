import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  COMPILED,
  lifecycleFixture,
  listRunRoots,
  outputText,
  REUSED,
  reuseFixture,
  withEnv,
  withJestStub,
  withRuntimeRoot,
  writeStaleRunRoot,
} from './test-command-fixtures'

Describe('tao test CLI compiled output reuse', () => {
  // A run that publishes nothing has nothing to keep, which is the lifecycle every passing run had
  // before compiled output became reusable and the one the opt-out restores.
  Test('discards its generated run root and prunes stale roots when reuse is switched off', async () => {
    await withTaoFixture({ ...lifecycleFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      await writeStaleRunRoot(runtimeRoot, 9)
      const staleNewest = await writeStaleRunRoot(runtimeRoot, 3)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          await withEnv('TAO_TEST_NO_CACHE', 'true', async () => {
            const result = await runTaoCliForTest(['test', rootDir])

            Expect(result.exitCode).toBe(0)
            Expect(await listRunRoots(runtimeRoot)).toEqual([staleNewest])
          })
        })
      })
    })
  })

  // Most of a `tao test` run is validating and compiling apps that have not changed since the last
  // run compiled them. The second run below must do neither and still run the same tests.
  Test("reuses a passing run's compiled apps when nothing they are built from has changed", async () => {
    await withTaoFixture({ ...reuseFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const staleOlder = await writeStaleRunRoot(runtimeRoot, 9)
      const staleNewest = await writeStaleRunRoot(runtimeRoot, 3)

      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(runtimeRoot, async () => {
          const cold = await runTaoCliForTest(['test', rootDir])
          const warm = await runTaoCliForTest(['test', rootDir])

          Expect(cold.exitCode).toBe(0)
          Expect(outputText(cold)).toContain(COMPILED)
          Expect(outputText(cold)).not.toContain(REUSED)
          Expect(warm.exitCode).toBe(0)
          Expect(outputText(warm)).toContain(REUSED)
          Expect(outputText(warm)).not.toContain(COMPILED)
          Expect(outputText(warm)).not.toContain('Validating Tao test files')
          Expect(outputText(warm)).toContain('Tao tests finished')
          // The published root is kept rather than discarded, and pruning still reaches the rest.
          const runRoots = await listRunRoots(runtimeRoot)
          Expect(runRoots).toContain(staleNewest)
          Expect(runRoots).not.toContain(staleOlder)
          Expect(runRoots).toHaveLength(2)
        })
      })
    })
  })
})
