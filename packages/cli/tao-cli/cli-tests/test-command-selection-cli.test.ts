import { RuntimeTesting } from '@expo-host/testing/runtime-testing'
import { FS, TaoTestProtocol } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import {
  argvEchoStubSource,
  listEntrypoints,
  outputText,
  reportFixture,
  splittableFixture,
  withJestStub,
  withRuntimeRoot,
} from './test-command-fixtures'

Describe('tao test CLI journey selection', () => {
  // One Jest case per Tao journey is what makes a name pattern able to select a journey at all, so
  // the pattern goes to the runner unaltered and the runner does the selecting.
  Test('forwards a name pattern to the test runner', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'runs', '--output', 'lines'])

          Expect(result.exitCode).toBe(0)
          Expect(outputText(result)).toContain('--testNamePattern runs')
          Expect(outputText(result)).toContain('Selected 1 of 1 Tao journey')
        })
      })
    })
  })

  // The runner reaches the same journeys either way, but it stands up a module registry for every
  // entrypoint it opens, so an entrypoint the pattern can select nothing from is a worker that loads
  // React Native to run nothing. Selecting one journey is the inner loop this protects.
  Test('keeps a name pattern out of the entrypoints it can select nothing from', async () => {
    await withTaoFixture({ ...splittableFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--name',
            'SplitOne > runs 1$',
            '--output',
            'lines',
          ])

          Expect(result.exitCode).toBe(0)
          // The command still reports the selection against every journey the run discovered.
          Expect(outputText(result)).toContain(
            `Selected 1 of ${RuntimeTesting.TestHarnessFiles.JOURNEYS_PER_SHARD * 2} Tao journeys`,
          )
          Expect(outputText(result)).toContain('--maxWorkers=1')
          Expect(await listEntrypoints(FS.resolvePath('runtime-root', rootDir), 1)).toEqual([
            'shard-1-of-1.jest.tsx',
          ])
        })
      })
    })
  })

  // The runner would filter every case out, report a run with no tests in it, and exit zero. A
  // pattern that selects nothing is a mistake in the pattern, so it is reported as one.
  Test('fails with a clear message when a name pattern matches no journey', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'never written'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(1)
          Expect(output).toContain('No Tao test journey matches --name "never written". Searched 1 journey under')
          Expect(output).toContain('run tao test without --name to run them all.')
          // Nothing ran, so the runner was never started and nothing it would have printed appears.
          Expect(output).not.toContain('runner args: ')
          Expect(output).not.toContain('Tests:')
        })
      })
    })
  })

  // A scheduler hands one pattern to every suite it knows about, and a Tao journey will never be
  // named like a Bun test, so the suites the pattern cannot describe have to be able to sit out
  // without turning the filtered run red. The empty selection is still reported, not hidden.
  Test('passes on a name pattern that matches no journey when asked to', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'never written', '--pass-with-no-tests'])
          const output = outputText(result)

          Expect(result.exitCode).toBe(0)
          Expect(output).toContain('No Tao test journey matches --name "never written". Searched 1 journey under')
          // The repository test runner reads this marker to tell this pass from a pass that ran
          // something: the Tao suite writes no per-test report, so the line is the only evidence.
          // Asserting the literal here would let the two ends drift apart silently.
          Expect(output).toContain(`${TaoTestProtocol.NO_JOURNEYS_MATCHED}.`)
          Expect(TaoTestProtocol.ranNoJourneys(output)).toBe(true)
          // Passing is not running: the remedy for a mistyped pattern is not offered, and the
          // runner is still never started.
          Expect(output).not.toContain('run tao test without --name to run them all.')
          Expect(output).not.toContain('runner args: ')
          Expect(output).not.toContain('Tests:')
        })
      })
    })
  })

  // The flag settles the empty selection and nothing else; a pattern that does select journeys runs
  // them, so a scheduler that always passes it cannot silently stop testing what it does reach.
  Test('still runs the journeys a name pattern selects while passing with no tests', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest([
            'test',
            rootDir,
            '--name',
            'runs',
            '--pass-with-no-tests',
            '--output',
            'lines',
          ])

          Expect(result.exitCode).toBe(0)
          Expect(outputText(result)).toContain('--testNamePattern runs')
          Expect(outputText(result)).toContain('Selected 1 of 1 Tao journey')
        })
      })
    })
  })

  Test('rejects a name pattern that is not a regular expression', async () => {
    await withTaoFixture({ ...reportFixture, 'jest-stub.mjs': argvEchoStubSource() }, async rootDir => {
      await withJestStub(rootDir, async () => {
        await withRuntimeRoot(FS.resolvePath('runtime-root', rootDir), async () => {
          const result = await runTaoCliForTest(['test', rootDir, '--name', 'runs('])

          Expect(result.exitCode).toBe(1)
          Expect(outputText(result)).toContain('--name "runs(" is not a valid regular expression')
          Expect(outputText(result)).not.toContain('runner args: ')
        })
      })
    })
  })
})
