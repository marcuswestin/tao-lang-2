import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { beginActionLaunch } from '../TaoRuntime-src/TR-action-transactions'
import { makeQuantityType } from '../TaoRuntime-src/TR-quantity-values'

Describe('foreign action results', () => {
  Test('retains checked quantity wrappers while ordinary native arguments remain data', async () => {
    const duration = makeQuantityType({
      domain: 'Duration',
      units: { seconds: 1, minutes: 60 },
      defaultUnit: 'seconds',
    }, TR.Value)
    const supplied = duration.fromUnit(2, 'minutes')
    const lookalike = { canonical: 120, unit: 'minutes', domain: 'Duration' }
    const received: unknown[] = []
    const native = TR.ForeignAction(
      (quantity, plain) => {
        received.push(quantity, plain)
        Expect(quantity).toBe(supplied)
        Expect(duration.read(quantity)).toEqual({ canonical: 120, unit: 'minutes' })
      },
      'Read',
      [],
    )
    await TR.Action(async () => {
      await TR.Do(native, supplied, TR.Value(lookalike))
    }).jsValue.invoke()
    Expect(received).toEqual([supplied, lookalike])
  })

  Test('preserves evaluated source values and treats native lookalikes as data', async () => {
    const value = TR.Value('ready').evaluate()
    const source = TR.Action(() => value)
    const lookalike = { jsValue: 'native', evaluate: () => 'native method' }
    const native = TR.ForeignAction(() => lookalike, 'Read', [])
    await TR.Action(async () => {
      const sourceResult = await TR.DoResult<string>(source)
      Expect(sourceResult.jsValue).toBe('ready')
      Expect(sourceResult.evaluate().jsValue).toBe('ready')
      const nativeResult = await TR.DoResult<typeof lookalike>(native)
      Expect(nativeResult.jsValue).toBe(lookalike)
    }).jsValue.invoke()
  })

  Test('preserves false, zero, nullable and structured native results', async () => {
    const results: unknown[] = []
    for (const value of [false, 0, null, { Message: 'ready' }]) {
      const foreign = TR.ForeignAction(async () => value, 'Read', [])
      await TR.Action(async () => {
        results.push((await TR.DoResult<unknown>(foreign)).jsValue)
      }).jsValue.invoke()
    }
    Expect(results).toEqual([false, 0, null, { Message: 'ready' }])
  })

  Test('awaits the native result and commits caller writes together in order', async () => {
    let release!: (value: string) => void
    const pending = new Promise<string>(resolve => {
      release = resolve
    })
    const order: string[] = []
    const state = TR.Cell(TR.Value('initial'))
    const read = TR.ForeignAction(
      () => {
        order.push('native')
        return pending
      },
      'Read',
      [],
    )
    const root = TR.Action(async () => {
      const continuation = TR.ActionContinuation()
      await TR.Set(state, () => TR.Value('before'))
      TR.ResumeActionContinuation(continuation)
      const result = await TR.DoResult<string>(read)
      TR.ResumeActionContinuation(continuation)
      order.push(result.jsValue)
      await TR.Set(state, () => result)
    })
    const running = root.jsValue.invoke()
    await Promise.resolve()
    Expect(order).toEqual(['native'])
    release('after')
    await running
    Expect(order).toEqual(['native', 'after'])
    Expect(state.evaluate().jsValue).toBe('after')
  })

  Test('never resumes the caller with a fabricated value after native rejection', async () => {
    const reached: unknown[] = []
    const state = TR.Cell(TR.Value('initial'))
    const reports: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const failed = TR.ForeignAction(
      async () => {
        TR.Errors.failHost('Read failed.')
      },
      'Read',
      [],
    )
    try {
      await TR.Action(async () => {
        await TR.Set(state, () => TR.Value('temporary'))
        reached.push(await TR.DoResult<string>(failed))
      }, { name: 'Caller' }).jsValue.invoke()
    } finally {
      stop()
    }
    Expect(reached).toEqual([])
    Expect(state.evaluate().jsValue).toBe('initial')
    Expect(reports).toHaveLength(1)
    Expect(reports[0]).toEqual(
      Expect['objectContaining']({ action: 'Caller', frames: ['Caller', 'Read'], message: 'Read failed.' }),
    )
  })

  Test('rejects a result that arrives after its launch was abandoned', async () => {
    let release!: (value: string) => void
    const pending = new Promise<string>(resolve => {
      release = resolve
    })
    const reached: unknown[] = []
    const root = TR.Action(async () => {
      reached.push(await TR.DoResult<string>(TR.ForeignAction(() => pending, 'Read', [])))
    })
    const running = root.jsValue.invoke()
    beginActionLaunch()
    release('stale')
    await running
    Expect(reached).toEqual([])
  })
})
