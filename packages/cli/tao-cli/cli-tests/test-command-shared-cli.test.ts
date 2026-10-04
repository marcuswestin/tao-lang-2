import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  argvEchoStubSource,
  COMPILED,
  listRunRoots,
  outputText,
  reportFixture,
  splittableFixture,
  withEnv,
  withJestStub,
  withRuntimeRoot,
} from './test-command-fixtures'

Describe('tao test CLI shared compiled corpus', () => {
  Test('writes a versioned live-render artifact when Studio requests journey observations', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const artifactPath = FS.resolvePath('journey-observations.json', rootDir)
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--journey-observations',
            artifactPath,
          ])

          Expect(result.exitCode).toBe(0)
          Expect(await FS.readJson<RuntimeTesting.JourneyObservationsArtifact>(artifactPath)).toEqual({
            checks: [],
            format: 'tao-journey-observations',
            version: 1,
          })
        })
      })
    })
  })

  Test('prepares one compiled corpus and runs its disjoint roots without recompiling', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const handoffPath = FS.resolvePath('artifacts/shared-tao-run.json', rootDir)
      const identityPath = FS.resolvePath('.tao/project.json', rootDir)
      await FS.remove(identityPath)
      await withRuntimeRoot(runtimeRoot, async () => {
        await withJestStub(rootDir, async () => {
          const prepared = await runTaoCliForTest(['test', '--shared-prepare', handoffPath, rootDir])
          const first = await runTaoCliForTest(['test', '--shared-run', handoffPath, FS.resolvePath('One', rootDir)])
          const second = await runTaoCliForTest(['test', '--shared-run', handoffPath, FS.resolvePath('Two', rootDir)])
          const finalized = await runTaoCliForTest(['test', '--shared-finalize', handoffPath])
          const handoff = await FS.readJson<{ testPaths: readonly string[] }>(handoffPath)

          Expect([prepared.exitCode, first.exitCode, second.exitCode, finalized.exitCode]).toEqual([0, 0, 0, 0])
          Expect(outputText(prepared)).toContain(COMPILED)
          Expect(outputText(prepared)).toContain('Prepared shared Tao test run')
          Expect(await FS.isFile(identityPath)).toBe(true)
          Expect(handoff.testPaths).toHaveLength(2)
          Expect(outputText(first)).not.toContain(COMPILED)
          Expect(outputText(second)).not.toContain(COMPILED)
          Expect(outputText(first)).toContain('Running shared Tao tests')
          Expect(outputText(second)).toContain('Running shared Tao tests')
          Expect(await listRunRoots(runtimeRoot)).toHaveLength(1)
        })
      })
    })
  })

  Test('fails closed when a shared shard root was not prepared', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const handoffPath = FS.resolvePath('shared-tao-run.json', rootDir)
      await withRuntimeRoot(runtimeRoot, async () => {
        await withJestStub(rootDir, async () => {
          const prepared = await runTaoCliForTest([
            'test',
            '--shared-prepare',
            handoffPath,
            FS.resolvePath('One', rootDir),
          ])
          const run = await runTaoCliForTest(['test', '--shared-run', handoffPath, FS.resolvePath('Two', rootDir)])

          Expect(prepared.exitCode).toBe(0)
          Expect(run.exitCode).toBe(1)
          Expect(outputText(run)).toContain('has no compiled test files under shard root')
        })
      })
    })
  })

  Test('rejects a shared handoff from another runtime root', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const preparedRuntimeRoot = FS.resolvePath('prepared-runtime-root', rootDir)
      const foreignRuntimeRoot = FS.resolvePath('foreign-runtime-root', rootDir)
      const handoffPath = FS.resolvePath('shared-tao-run.json', rootDir)
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(preparedRuntimeRoot, async () => {
          Expect((await runTaoCliForTest(['test', '--shared-prepare', handoffPath, rootDir])).exitCode).toBe(0)
        })
        await withRuntimeRoot(foreignRuntimeRoot, async () => {
          const run = await runTaoCliForTest(['test', '--shared-run', handoffPath, rootDir])

          Expect(run.exitCode).toBe(1)
          Expect(outputText(run)).toContain('belongs to')
          Expect(outputText(run)).toContain('not this runtime root')
        })
      })
    })
  })

  Test('discards an uncached shared run only after its finalizer', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': '' }, async rootDir => {
      const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
      const handoffPath = FS.resolvePath('shared-tao-run.json', rootDir)
      await withRuntimeRoot(runtimeRoot, async () => {
        await withJestStub(rootDir, async () => {
          await withEnv('TAO_TEST_NO_CACHE', 'true', async () => {
            const prepared = await runTaoCliForTest(['test', '--shared-prepare', handoffPath, rootDir])
            Expect(prepared.exitCode).toBe(0)
            Expect(await listRunRoots(runtimeRoot)).toHaveLength(1)

            const finalized = await runTaoCliForTest(['test', '--shared-finalize', handoffPath])
            Expect(finalized.exitCode).toBe(0)
            Expect(await listRunRoots(runtimeRoot)).toEqual([])
          })
        })
      })
    })
  })
})
