import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { MountedActionBoundary } from '../TaoRuntime-src/TR-action-boundary-model'
import { actionOwner } from '../TaoRuntime-src/TR-action-transactions'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { TaoActionOwner } from '../TaoRuntime-src/TR-native-subscription'

function mountedOwner() {
  const boundary = new MountedActionBoundary()
  const unmount = boundary.mount()
  const owner = new TaoActionOwner()
  owner.boundary = boundary
  return {
    boundary,
    owner,
    dispose: () => {
      owner.dispose()
      unmount()
    },
  }
}

Describe('named event action ownership', () => {
  Test(
    'selects once, retains exact arguments and body context, and delivers after rollback to the dispatch owner',
    async () => {
      const first = mountedOwner()
      const second = mountedOwner()
      const gate = Deferred()
      const started = Deferred()
      const state = TR.Cell(TR.Value('before'))
      const argument = TR.Value({ input: 'exact' })
      const receiver = TR.CaptureActionReceiver(TR.Value({ row: 'captured' }), 'one')
      const auth = TR.Auth.CreateScope()
      const seen: unknown[] = []
      const delivered: string[] = []
      const stop = first.boundary.subscribe(() => delivered.push(state.evaluate().jsValue))
      const original = TR.Action((value: typeof argument) =>
        TR.ActionScope(async () => {
          seen.push(value, receiver, auth, actionOwner())
          state.set(TR.Value('during'))
          const continuation = TR.ActionContinuation()
          TR.Defer(() => {
            seen.push('cleanup')
          })
          started.resolve()
          await gate.promise
          TR.ResumeActionContinuation(continuation)
          throw new TaoActionFailure('InvalidInput', 'Use another title.')
        }), { name: 'NamedModule' })
      let reads = 0
      const selected = {
        evaluate() {
          reads++
          return original
        },
      }
      const bound = TR.BindEventAction(selected, first.owner)
      try {
        const pending = bound.jsValue.invoke(argument)
        await started.promise
        first.owner.boundary = second.boundary
        gate.resolve()
        await pending
        Expect(reads).toBe(1)
        Expect(seen).toEqual([argument, receiver, auth, first.owner, 'cleanup'])
        Expect(delivered).toEqual(['before'])
        Expect(first.boundary.failure?.action).toBe('NamedModule')
        Expect(second.boundary.failure).toBeUndefined()
      } finally {
        gate.resolve()
        stop()
        auth.dispose()
        first.dispose()
        second.dispose()
      }
    },
  )

  Test('keeps failed receipts observed and joined work owned by its existing caller transaction', async () => {
    const event = mountedOwner()
    const caller = mountedOwner()
    const state = TR.Cell(TR.Value(0))
    const seen: TaoActionOwner[] = []
    const original = TR.Action(() => {
      seen.push(actionOwner()!)
      state.set(TR.Value(1))
      throw new TaoActionFailure('InvalidInput', 'Rejected.')
    }, { name: 'NamedFailure' })
    const bound = TR.BindEventAction(original, event.owner)
    try {
      Expect((await bound.jsValue.invokeReceipt()).outcome).toBe('failed')
      Expect(event.boundary.failure).toBeUndefined()
      Expect(state.evaluate().jsValue).toBe(0)
      await TR.Action(() => TR.Do(bound), { owner: caller.owner, name: 'Caller' }).jsValue.invoke()
      Expect(event.boundary.failure).toBeUndefined()
      Expect(caller.boundary.failure?.message).toBe('Rejected.')
      Expect(seen).toEqual([event.owner, caller.owner])
      Expect(state.evaluate().jsValue).toBe(0)
    } finally {
      event.dispose()
      caller.dispose()
    }
  })

  Test('retains result identity and result-root ownership while nested results join their caller', async () => {
    const event = mountedOwner()
    const caller = mountedOwner()
    const result = TR.Value({ answer: 42 })
    const owners: (TaoActionOwner | undefined)[] = []
    const bound = TR.BindEventAction(
      TR.Action(() => {
        owners.push(actionOwner())
        return result
      }),
      event.owner,
    )
    try {
      Expect(await TR.DoResult(bound)).toBe(result)
      await TR.Action(async () => {
        Expect(await TR.DoResult(bound)).toBe(result)
      }, { owner: caller.owner }).jsValue.invoke()
      Expect(owners).toEqual([event.owner, caller.owner])
      const failing = TR.BindEventAction(
        TR.Action(() => {
          throw new TaoActionFailure('InvalidInput', 'Result rejected.')
        }),
        event.owner,
      )
      await Expect(TR.DoResult(failing)).rejects.toThrow('Result rejected.')
      Expect(event.boundary.failure).toBeUndefined()
    } finally {
      event.dispose()
      caller.dispose()
    }
  })

  Test(
    'shares latest scheduling across original and bound views, including abandoned receipts and result prohibition',
    async () => {
      const event = mountedOwner()
      const gate = Deferred()
      const started = Deferred()
      const calls: string[] = []
      const original = TR.ForeignAction(
        async (value: string) => {
          calls.push(value)
          if (value === 'first') {
            started.resolve()
            await gate.promise
          }
        },
        'LatestModule',
        [],
        { runs: 'latest' },
      )
      const bound = TR.BindEventAction(original, event.owner)
      try {
        const first = original.jsValue.invoke(TR.Value('first'))
        await started.promise
        const skipped = bound.jsValue.invokeReceipt(TR.Value('skipped'))
        const last = original.jsValue.invoke(TR.Value('last'))
        Expect((await skipped).outcome).toBe('abandoned')
        Expect(() => bound.jsValue.invokeJoinedResult(TR.Value('result')))
          .toThrow('An action that returns a value cannot use runs latest.')
        gate.resolve()
        await first
        await last
        Expect(calls).toEqual(['first', 'last'])
      } finally {
        gate.resolve()
        event.dispose()
      }
    },
  )

  Test('keeps explicit native ownership predicates and does not suppress ordinary bodies after disposal', async () => {
    const event = mountedOwner()
    const native = mountedOwner()
    const owners: (TaoActionOwner | undefined)[] = []
    const unowned: unknown[] = []
    const stop = TR.Errors.onUnowned(error => unowned.push(error))
    const bound = TR.BindEventAction(
      TR.Action(() => {
        owners.push(actionOwner())
        throw new TaoActionFailure('InvalidInput', 'Rejected.')
      }),
      event.owner,
    )
    try {
      await bound.jsValue.invokeOwned(native.owner, () => false)
      Expect(owners).toEqual([])
      await bound.jsValue.invokeOwned(native.owner, () => true)
      Expect(native.boundary.failure?.message).toBe('Rejected.')
      Expect(event.boundary.failure).toBeUndefined()
      event.owner.dispose()
      await bound.jsValue.invoke()
      Expect(owners).toEqual([native.owner, event.owner])
      Expect(unowned).toHaveLength(1)
      event.owner.active = true
      await bound.jsValue.invoke()
      Expect(event.boundary.failure?.message).toBe('Rejected.')
    } finally {
      stop()
      event.dispose()
      native.dispose()
    }
  })

  Test('pins latest queued delivery before owner retargeting, including an explicitly absent sink', async () => {
    for (const hadSink of [true, false]) {
      const first = mountedOwner()
      const second = mountedOwner()
      const gate = Deferred()
      const started = Deferred()
      const unowned: unknown[] = []
      const calls: string[] = []
      const stop = TR.Errors.onUnowned(error => unowned.push(error))
      if (!hadSink) {
        first.owner.boundary = undefined
      }
      const latest = TR.ForeignAction(
        async (key: string) => {
          calls.push(key)
          if (key === 'first') {
            started.resolve()
            await gate.promise
          } else {
            throw new TaoActionFailure('InvalidInput', 'Queued rejected.')
          }
        },
        'QueuedModule',
        [],
        { runs: 'latest' },
      )
      const bound = TR.BindEventAction(latest, first.owner)
      try {
        const running = latest.jsValue.invoke(TR.Value('first'))
        await started.promise
        const queued = bound.jsValue.invoke(TR.Value('queued'))
        first.dispose()
        first.owner.active = true
        first.owner.boundary = second.boundary
        gate.resolve()
        await running
        await queued
        Expect(calls).toEqual(['first', 'queued'])
        Expect(first.boundary.failure).toBeUndefined()
        Expect(second.boundary.failure).toBeUndefined()
        Expect(unowned).toHaveLength(1)
      } finally {
        gate.resolve()
        stop()
        first.dispose()
        second.dispose()
      }
    }
  })
})
