import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  argvEchoStubSource,
  listEntrypoints,
  listRunRoots,
  outputText,
  reportFixture,
  splittableFixture,
  taoApp,
  withEnv,
  withJestStub,
  withRuntimeRoot,
} from './test-command-fixtures'

Describe('tao test CLI worker budgets', () => {
  // Jest distributes test files rather than cases, so a run only uses the width it was granted if it
  // is split into that many entrypoints. The pool and the split are therefore one number.
  Test('bounds the test runner workers and the entrypoint split with the run job budget', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          await withEnv('TAO_TEST_JOBS', '1', async () => {
            const budgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(budgeted.exitCode).toBe(0)
            Expect(outputText(budgeted)).toContain('--maxWorkers=1')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
              'shard-1-of-1.jest.tsx',
            ])
          })
          await withEnv('TAO_TEST_JOBS', undefined, async () => {
            const unbudgeted = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(unbudgeted.exitCode).toBe(0)
            Expect(outputText(unbudgeted)).toContain('--maxWorkers=2')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 2)).toEqual([
              'shard-1-of-2.jest.tsx',
              'shard-2-of-2.jest.tsx',
            ])
          })
        })
      })
    })
  })

  // Jest hashes its whole configuration into the key of every transform it caches, and the
  // entrypoint directory is in that configuration. When it sat inside the run root, every compile
  // moved it and the runner re-transformed React Native and everything else it loads. The compiled
  // apps are stored by their contents for the same reason: a compile whose output is unchanged hands
  // the runner the same module paths, and only an edit that changes the output moves them.
  Test('hands the test runner the same entrypoints and module paths across compiles of unchanged output', async () => {
    const envStub = [
      `process.stderr.write(\`entrypoints: \${process.env.${RuntimeTesting.TestHarnessFiles.ENTRYPOINTS_ENV}}\\n\`)`,
      `process.stderr.write(\`manifest: \${process.env.${RuntimeTesting.TEST_MANIFEST_ENV}}\\n\`)`,
      `process.stderr.write(\`jest cache: \${process.env.${RuntimeTesting.JestTransformCache.ENV}}\\n\`)`,
      '',
    ].join('\n')
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': envStub }, async rootDir => {
      await withJestStub(rootDir, async () => {
        const runtimeRoot = FS.resolvePath('runtime-root', rootDir)
        await withRuntimeRoot(runtimeRoot, async () => {
          const entrypointsOf = (output: string) => /entrypoints: (.+)/.exec(output)?.[1]
          const jestCacheOf = (output: string) => /jest cache: (.+)/.exec(output)?.[1]
          const modulePathsOf = async (output: string) => {
            const manifestPath = /manifest: (.+)/.exec(output)?.[1]
            Expect(manifestPath).toBeDefined()
            const manifest = await FS.readJson<RuntimeTesting.TestCompiler.Manifest>(manifestPath!)
            return manifest.files.flatMap(file =>
              file.suites.flatMap(suite => suite.checks.map(check => check.app.modulePath))
            )
          }

          const first = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])
          const firstRunRoots = await listRunRoots(runtimeRoot)
          const firstModules = await modulePathsOf(outputText(first))
          await FS.writeText(FS.resolvePath('App.tao', rootDir), taoApp('Reported').replace('"Reported"', '"Edited"'))
          const second = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])
          const secondModules = await modulePathsOf(outputText(second))
          const third = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])
          const thirdModules = await modulePathsOf(outputText(third))

          Expect([first.exitCode, second.exitCode, third.exitCode]).toEqual([0, 0, 0])
          Expect(await listRunRoots(runtimeRoot)).not.toEqual(firstRunRoots)
          Expect(entrypointsOf(outputText(first))).toBeDefined()
          Expect(entrypointsOf(outputText(second))).toBe(entrypointsOf(outputText(first)))
          Expect(entrypointsOf(outputText(first))).not.toContain('/run-')
          Expect(jestCacheOf(outputText(first))).toBe(
            FS.resolvePath('data', RuntimeTesting.JestTransformCache.root(runtimeRoot)),
          )
          Expect(jestCacheOf(outputText(second))).toBe(jestCacheOf(outputText(first)))
          Expect(jestCacheOf(outputText(third))).toBe(jestCacheOf(outputText(first)))
          Expect(firstModules.length).toBeGreaterThan(0)
          const store = `/${RuntimeTesting.TestRunRoot.COMPILED_STORE_DIRECTORY_NAME}/`
          Expect(firstModules.every(path => path.includes(store))).toBe(true)
          Expect(secondModules).not.toEqual(firstModules)
          Expect(thirdModules).toEqual(secondModules)
        })
      })
    })
  })

  // A run with little to divide is better off undivided: every entrypoint stands up its own React
  // Native module registry, and one app's own suite is the common shape.
  Test('leaves a small run on one entrypoint however wide the budget', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          await withEnv('TAO_TEST_JOBS', '8', async () => {
            const result = await runTaoCliForTest(['test', rootDir, '--output', 'lines'])

            Expect(result.exitCode).toBe(0)
            Expect(outputText(result)).toContain('--maxWorkers=1')
            Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
              'shard-1-of-1.jest.tsx',
            ])
          })
        })
      })
    })
  })
})
