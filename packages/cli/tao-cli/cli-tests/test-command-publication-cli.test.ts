import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { copyMaintainedBindingPayload } from './maintained-bindings-fixture'
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
  Test('rejects a cached success after native output mutation and recovers with the maintained command', async () => {
    await withTaoFixture(
      Object.fromEntries(Object.entries(reuseFixture).map(([path, content]) => [`App/${path}`, content])),
      async rootDir => {
        const stdlibRoot = FS.resolvePath('stdlib', rootDir)
        await FS.copyDirectory(Repo.resolvePath('packages/apps/stdlib'), stdlibRoot)
        await copyMaintainedBindingPayload(stdlibRoot)
        await FS.writeText(FS.resolvePath('jest-stub.mjs', rootDir), '')
        const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
        const appRoot = FS.resolvePath('App', rootDir)
        await withEnv('TAO_STDLIB_ROOT', stdlibRoot, async () => {
          await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
            await withJestStub(rootDir, async () => {
              const first = await runTaoCliForTest(['test', appRoot])
              const reused = await runTaoCliForTest(['test', appRoot])
              Expect([first.exitCode, reused.exitCode]).toEqual([0, 0])
              Expect(outputText(reused)).toContain(REUSED)
              await FS.writeText(output, `${await FS.readText(output)}\n// stale native output\n`)
              const stale = await runTaoCliForTest(['test', appRoot])
              Expect(stale.exitCode).toBe(1)
              Expect(outputText(stale)).not.toContain(REUSED)
              Expect(outputText(stale)).toContain('tao bindings generate --maintained')
              const recovered = await runTaoCliForTest(['bindings', 'generate', '--maintained'])
              Expect(recovered.exitCode).toBe(0)
              Expect((await runTaoCliForTest(['test', appRoot])).exitCode).toBe(0)
            })
          })
        })
      },
    )
  })
  Test('does not publish output when native bindings change during a passing run', async () => {
    await withTaoFixture(
      Object.fromEntries(Object.entries(reuseFixture).map(([path, content]) => [`App/${path}`, content])),
      async rootDir => {
        const stdlibRoot = FS.resolvePath('stdlib', rootDir)
        await FS.copyDirectory(Repo.resolvePath('packages/apps/stdlib'), stdlibRoot)
        await copyMaintainedBindingPayload(stdlibRoot)
        const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
        await FS.writeText(
          FS.resolvePath('jest-stub.mjs', rootDir),
          `import { appendFileSync } from 'node:fs'; appendFileSync(${
            JSON.stringify(output)
          }, '\\n// changed during run\\n');\n`,
        )
        const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
        await withEnv('TAO_STDLIB_ROOT', stdlibRoot, async () => {
          await withRuntimeRoot(runtimeRoot, async () => {
            await withJestStub(rootDir, async () => {
              const result = await runTaoCliForTest(['test', FS.resolvePath('App', rootDir)])
              Expect(result.exitCode).toBe(0)
              Expect(outputText(result)).toContain(COMPILED)
              Expect(await FS.readText(output)).toContain('// changed during run')
              Expect(await listCachedFingerprints(runtimeRoot)).toEqual([])
              Expect(await listRunRoots(runtimeRoot)).toEqual([])
            })
          })
        })
      },
    )
  })
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
