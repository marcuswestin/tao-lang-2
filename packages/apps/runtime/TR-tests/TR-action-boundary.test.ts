import TR from '@runtime/TR'
import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { MountedActionBoundary } from '../TaoRuntime-src/TR-action-boundary-model'
import { actionFailurePublicMessage, TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

Describe('mounted action failure ownership', () => {
  Test(
    'keeps raw diagnostics private through composed exits and legacy captures while modeled primary messages survive',
    async () => {
      const boundary = new MountedActionBoundary()
      const unmount = boundary.mount()
      const owner = new TaoActionOwner()
      owner.boundary = boundary
      try {
        await TR.Action(() =>
          TR.ActionScope(() => {
            TR.Defer(() => {
              throw new TypeError('cleanup private')
            })
            throw new TypeError('primary private')
          }), { owner, name: 'Composed' }).jsValue.invoke()
        Expect(boundary.failure?.message).toBe('primary private')
        Expect(boundary.failure?.publicMessage).toBe("Couldn't finish 'Composed.' Nothing was changed.")
        const legacy = { ...boundary.failure!, publicMessage: undefined }
        Expect(actionFailurePublicMessage(legacy)).toBe("Couldn't finish 'Composed.' Nothing was changed.")
        Expect(actionFailurePublicMessage({ ...legacy, retryEligible: false })).toBe("Couldn't finish 'Composed.'")
        boundary.recover()
        await TR.Action(() =>
          TR.ActionScope(() => {
            TR.Defer(() => {
              throw new TypeError('outer cleanup private')
            })
            return TR.ActionScope(() => {
              TR.Defer(() => {
                throw new TypeError('inner cleanup private')
              })
              throw new TaoActionFailure('InvalidInput', 'Authored safe sentence.')
            })
          }), { owner, name: 'Nested' }).jsValue.invoke()
        Expect(boundary.failure?.publicMessage).toBe('Authored safe sentence.')
        boundary.recover()
        const external = TR.ForeignAction(() => {}, 'Write', [])
        await TR.Action(async () => {
          await TR.Do(external)
          throw new TaoActionFailure('InvalidInput', 'Authored safe sentence.')
        }, { owner, name: 'SafeExternal' }).jsValue.invoke()
        Expect(boundary.failure?.publicMessage).toBe('Authored safe sentence.')
        Expect(boundary.failure?.retryEligible).toBe(false)
        boundary.recover()
        await TR.Action(() =>
          TR.ActionScope(async () => {
            TR.Defer(() => {
              throw new TypeError('private cleanup credentials')
            })
            await TR.Do(external)
          }), { owner, name: 'CleanupExternal' }).jsValue.invoke()
        Expect(boundary.failure?.publicMessage).toBe("Couldn't finish cleanup for 'CleanupExternal.'")
        Expect(boundary.failure?.message).toBe('private cleanup credentials')
        Expect(boundary.failure?.retryEligible).toBe(false)
      } finally {
        owner.dispose()
        unmount()
      }
    },
  )
  Test('renders no rollback promise after a durable foreign effect while Tao state rolls back', async () => {
    await withTaoFiles('tao-external-action-failure-', {}, async (_paths, root) => {
      await FS.symlink(Repo.resolvePath('packages/apps/expo-host/node_modules'), FS.resolvePath('node_modules', root))
      const program = FS.resolvePath('Check.ts', root)
      await FS.writeText(
        program,
        `
        import React from 'react'
        import { MockModule } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))}
        import { reactNativeStubs } from ${
          JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/TestReactNative.ts'))
        }
        import { runtimeConsole } from ${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/Platform.ts'))}
        MockModule('react-native', () => reactNativeStubs())
        const { default: TR } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR.ts'))
        })
        const { MountedActionBoundary } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-action-boundary-model.ts'))
        })
        const { TaoActionOwner } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-native-subscription.ts'))
        })
        const { TaoErrorBoundary } = await import(${
          JSON.stringify(Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-error-containment.tsx'))
        })
        const Renderer = require('react-test-renderer')
        ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
        const originalError = console.error
        const originalWarn = console.warn
        console.error = () => {}
        console.warn = () => {}
        const boundary = new MountedActionBoundary()
        const unmount = boundary.mount()
        const owner = new TaoActionOwner()
        owner.boundary = boundary
        const state = TR.Cell(TR.Value('before'))
        let durableCounter = 0
        const foreign = TR.ForeignAction(() => {
          durableCounter += 1
          throw new TypeError('private upload credentials')
        }, 'Upload', [])
        function Surface() {
          React.useSyncExternalStore(boundary.subscribe, boundary.snapshot, boundary.snapshot)
          return React.createElement(TaoErrorBoundary, {
            boundaryId: 'durable-action', frame: { boundary: 'app' }, stateKey: 'counter-test',
            actionFailure: boundary.failure,
          }, React.createElement('healthy'))
        }
        let mounted: any
        try {
          await Renderer.act(async () => { mounted = Renderer.create(React.createElement(Surface)) })
          await Renderer.act(async () => {
            await TR.Action(() => {
              state.set(TR.Value('during'))
              return TR.Do(foreign)
            }, { owner, name: 'Upload' }).jsValue.invoke()
          })
          runtimeConsole.info(JSON.stringify({ durableCounter, state: state.evaluate().jsValue,
            ui: JSON.stringify(mounted.toJSON()), publicMessage: boundary.failure?.publicMessage,
            diagnostic: boundary.failure?.message, retryEligible: boundary.failure?.retryEligible,
            history: TR.Errors.capture().find(report => report.action === 'Upload')?.message }))
        } finally {
          await Renderer.act(async () => { mounted?.unmount() })
          owner.dispose(); unmount(); console.error = originalError; console.warn = originalWarn
        }
      `,
      )
      const executed = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [program],
        cwd: root,
        processPolicy: 'test',
      })
      Expect({ exitCode: executed.exitCode, stderr: executed.stderr }).toEqual({ exitCode: 0, stderr: '' })
      const result = JSON.parse(executed.stdout)
      Expect(result.durableCounter).toBe(1)
      Expect(result.state).toBe('before')
      Expect(result.publicMessage).toBe("Couldn't finish 'Upload.'")
      Expect(result.ui).toContain("Couldn't finish 'Upload.'")
      Expect(result.ui).not.toContain('Nothing was changed')
      Expect(result.ui).not.toContain('private upload credentials')
      Expect(result.ui).not.toContain('Try again')
      Expect(result.diagnostic).toBe('private upload credentials')
      Expect(result.history).toBe('private upload credentials')
      Expect(result.retryEligible).toBe(false)
    })
  })
  Test(
    'delivers after asynchronous cleanup and rollback, latches once, and retains the original occurrence',
    async () => {
      const first = new MountedActionBoundary()
      const second = new MountedActionBoundary()
      const unmountFirst = first.mount()
      const unmountSecond = second.mount()
      const owner = new TaoActionOwner()
      owner.boundary = first
      const state = TR.Cell(TR.Value('before'))
      const events: string[] = []
      const unsubscribe = first.subscribe(() => events.push(state.evaluate().jsValue))
      let release!: () => void
      const gate = new Promise<void>(resolve => {
        release = resolve
      })
      const unowned: unknown[] = []
      const stop = TR.Errors.onUnowned(error => unowned.push(error))
      try {
        const pending = TR.Action(() =>
          TR.ActionScope(async () => {
            const continuation = TR.ActionContinuation()
            TR.Defer(async () => {
              events.push('cleanup')
              await Promise.resolve()
            })
            state.set(TR.Value('during'))
            await gate
            TR.ResumeActionContinuation(continuation)
            throw new TaoActionFailure('InvalidInput', 'Use another title.')
          }), { owner }).jsValue.invoke()
        owner.boundary = second
        release()
        await pending
        Expect(events).toEqual(['cleanup', 'before'])
        Expect(first.failure?.message).toBe('Use another title.')
        Expect(second.failure).toBeUndefined()
        Expect(unowned).toEqual([])
        const stale = first.capture()!
        const failure = first.failure!
        first.recover()
        Expect(stale(failure)).toBe(false)
        Expect(first.failure).toBeUndefined()
      } finally {
        unsubscribe()
        stop()
        owner.dispose()
        unmountFirst()
        unmountSecond()
      }
    },
  )

  Test('rejects disposed and recovered generations even after the same owner or host reactivates', async () => {
    const boundary = new MountedActionBoundary()
    const unmount = boundary.mount()
    const owner = new TaoActionOwner()
    owner.boundary = boundary
    const old = owner.captureFailureSink()!
    unmount()
    const dispose = boundary.mount()
    const failure = {
      action: 'Save',
      arguments: [],
      case: 'InvalidInput',
      message: 'Bad title.',
      retryEligible: true,
      frames: [],
      timestamp: 1,
    }
    Expect(old(failure)).toBe(false)
    const current = owner.captureFailureSink()!
    owner.dispose()
    owner.active = true
    Expect(current(failure)).toBe(false)
    Expect(owner.captureFailureSink()!(failure)).toBe(true)
    boundary.recover()
    dispose()
    Expect(boundary.capture()).toBeUndefined()
  })

  Test('preserves receipts, handled outcomes, detached failures and declined or broken sinks', async () => {
    const boundary = new MountedActionBoundary()
    const unmount = boundary.mount()
    const owner = new TaoActionOwner()
    owner.boundary = boundary
    const unowned: unknown[] = []
    const stop = TR.Errors.onUnowned(error => unowned.push(error))
    const fail = () => {
      throw new TaoActionFailure('InvalidInput', 'Bad title.')
    }
    try {
      const action = TR.Action(fail, { owner })
      Expect((await action.jsValue.invokeReceipt()).outcome).toBe('failed')
      Expect(boundary.failure).toBeUndefined()
      await TR.Action(async () => {
        await TR.WhenDo(() => TR.Do(action), { declared: [], name: 'Save' }, [['otherwise', () => {}]])
      }, { owner }).jsValue.invoke()
      Expect(boundary.failure).toBeUndefined()
      await TR.Action(() => {
        TR.Async(async () => fail())
      }, { owner }).jsValue.invoke()
      await TR.Action(() => {}).jsValue.invoke()
      Expect(boundary.failure).toBeUndefined()
      Expect(unowned).toHaveLength(1)
      unmount()
      await action.jsValue.invoke()
      Expect(unowned).toHaveLength(2)
      owner.captureFailureSink = () => () => {
        throw new TaoActionFailure('Unexpected', 'Delivery broke.')
      }
      await action.jsValue.invoke()
      Expect(unowned).toHaveLength(4)
    } finally {
      stop()
      owner.dispose()
      unmount()
    }
  })
})
