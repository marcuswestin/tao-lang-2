import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

Describe('checked Wait through the runtime clock', () => {
  Test('holds a checked wait until its exact deadline and cancels an acquired wait', async () => {
    await withTaoFiles('tao-wait-clock-', {}, async (_paths, root) => {
      const program = FS.resolvePath('WaitClock.ts', root)
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {
        compilerOptions: {
          paths: {
            '@runtime/*': [Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/*')],
            react: [Repo.resolvePath('packages/apps/runtime/node_modules/react/index.js')],
          },
        },
      })
      await FS.writeText(
        program,
        `
        import TR from ${JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))}
        import { makeQuantityType } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-quantity-values.ts'))
        }
        import { runActionResult, runActionScope, captureActionContinuation, cancelActionContinuation } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-transactions.ts'))
        }
        import { TaoActionFailure } from ${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-errors.ts'))
        }
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        const Duration = makeQuantityType({
          domain: 'Duration', defaultUnit: 'seconds', units: { seconds: 1, milliseconds: 0.001 },
        }, TR.Value)
        const originalAfter = TR.Clock.after
        const discardCanceller = process.argv.includes('--discard-canceller')
        TR.Clock.beginTest(1000)
        try {
          let resolved = false
          const pending = TR.Wait(Duration.read, Duration.fromUnit(2, 'seconds')).then(() => { resolved = true })
          await Promise.resolve()
          const initiallyResolved = resolved
          TR.Clock.advance(1999)
          await Promise.resolve()
          const beforeDeadline = resolved
          TR.Clock.advance(1)
          await pending
          const atDeadline = resolved

          let continuation
          let reachedTail = false
          let scheduledCallbacks = 0
          let cancellationCalls = 0
          TR.Clock.after = function (milliseconds, callback) {
            const cancel = originalAfter.call(this, milliseconds, () => {
              scheduledCallbacks += 1
              callback()
            })
            return discardCanceller ? () => {} : () => {
              cancellationCalls += 1
              cancel()
            }
          }
          const cancelled = runActionResult('WaitClock', [], () => runActionScope(async () => {
            continuation = captureActionContinuation()
            await TR.Wait(Duration.read, Duration.fromUnit(3600, 'seconds'))
            reachedTail = true
          }))
          const acceptedCancellation = cancelActionContinuation(continuation)
          let failure
          try { await cancelled } catch (error) { failure = error }
          TR.Clock.advance(3600000)
          await Promise.resolve()
          runtimeConsole.info(JSON.stringify({
            initiallyResolved, beforeDeadline, atDeadline, acceptedCancellation, reachedTail,
            scheduledCallbacks, cancellationCalls,
            modeledCancellation: failure instanceof TaoActionFailure && failure.caseName === 'cancelled',
          }))
        } finally {
          TR.Clock.after = originalAfter
          TR.Clock.endTest()
        }
      `,
      )
      const execution = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: execution.exitCode, stderr: execution.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const expected = {
        initiallyResolved: false,
        beforeDeadline: false,
        atDeadline: true,
        acceptedCancellation: true,
        reachedTail: false,
        scheduledCallbacks: 0,
        cancellationCalls: 1,
        modeledCancellation: true,
      }
      Expect(JSON.parse(execution.stdout)).toEqual(expected)
      const discarded = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program, '--discard-canceller'],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: discarded.exitCode, stderr: discarded.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const negative = JSON.parse(discarded.stdout)
      Expect(negative).not.toEqual(expected)
      Expect(negative.scheduledCallbacks).toBe(1)
      Expect(negative.cancellationCalls).toBe(0)
    })
  })
})
