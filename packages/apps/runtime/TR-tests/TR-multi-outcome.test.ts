import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import { captureActionContinuation, resumeActionContinuation } from '../TaoRuntime-src/TR-action-transactions'
import { runMultiOutcome } from '../TaoRuntime-src/TR-multi-outcome'

async function root(body: () => unknown): Promise<void> {
  const reports: unknown[] = []
  const stop = TR.Errors.onFailure(report => reports.push(report))
  try {
    await TR.Action(body, { name: 'MultiRoot' }).jsValue.invoke()
  } finally {
    stop()
  }
  Expect(reports).toEqual([])
}

Describe('Tao multi-match outcomes', () => {
  Test('observes once and captures every match and payload before a body changes the live source', async () => {
    const source = TR.Cell(TR.Value<Record<string, boolean>>({ refreshing: true, stale: true, loading: false }))
    const refreshing = { title: 'Refreshing payload' }
    const stale = { title: 'Stale payload' }
    const seen: string[] = []
    let observations = 0
    let results: unknown
    await root(() => {
      results = runMultiOutcome(() => {
        observations++
        seen.push('observe')
        return source
      }, (observation, caseName) => {
        seen.push(`match ${caseName}`)
        return {
          matched: observation.evaluate().jsValue[caseName] === true,
          payload: caseName === 'refreshing' ? refreshing : stale,
        }
      }, [
        ['refreshing', payload => {
          Expect(payload).toBe(refreshing)
          seen.push('body refreshing')
          TR.Set(source, () => TR.Value({ refreshing: false, stale: false, loading: false }))
          return 'refreshing result'
        }],
        ['stale', payload => {
          Expect(payload).toBe(stale)
          Expect(source.evaluate().jsValue['stale']).toBe(false)
          seen.push('body stale')
          return 'stale result'
        }],
        ['loading', () => {
          seen.push('body loading')
          return 'loading result'
        }],
      ])
    })

    Expect(observations).toBe(1)
    Expect(seen).toEqual([
      'observe',
      'match refreshing',
      'match stale',
      'match loading',
      'body refreshing',
      'body stale',
    ])
    Expect(results).toEqual(['refreshing result', 'stale result'])
  })

  Test('collects every selected rendering result synchronously in declared order', () => {
    const refreshing = TR.createElement(() => null, { Tag: 'Refreshing' })
    const stale = TR.createElement(() => null, { Tag: 'Stale' })
    let fallbacks = 0
    const results = runMultiOutcome(
      () => ({ refreshing: true, stale: true, loading: false } as Record<string, boolean>),
      (observation, caseName) => ({ matched: observation[caseName] === true, payload: undefined }),
      [
        ['stale', () => stale],
        ['loading', () => TR.createElement(() => null, { Tag: 'Loading' })],
        ['refreshing', () => refreshing],
      ],
      () => {
        fallbacks++
        return TR.createElement(() => null, { Tag: 'Fallback' })
      },
    )

    Expect(results).toEqual([stale, refreshing])
    Expect(Array.isArray(results)).toBe(true)
    if (Array.isArray(results)) {
      Expect(results[0]).toBe(stale)
      Expect(results[1]).toBe(refreshing)
    }
    Expect(fallbacks).toBe(0)
  })

  Test('runs fallback once only after every ordinary case fails to match', () => {
    const seen: string[] = []
    let observations = 0
    const results = runMultiOutcome(() => {
      observations++
      return 'No match'
    }, (_observation, caseName) => {
      seen.push(`match ${caseName}`)
      return { matched: false, payload: undefined }
    }, [
      ['first', () => {
        seen.push('first')
        return 'first'
      }],
      ['second', () => {
        seen.push('second')
        return 'second'
      }],
    ], () => {
      seen.push('fallback')
      return 'fallback result'
    })

    Expect(observations).toBe(1)
    Expect(seen).toEqual(['match first', 'match second', 'fallback'])
    Expect(results).toEqual(['fallback result'])
    Expect(runMultiOutcome(() => undefined, () => ({ matched: false, payload: undefined }), [])).toEqual([])
  })

  Test('captures payload identity even when the matcher reuses a mutable match record', () => {
    const first = { title: 'First' }
    const second = { title: 'Second' }
    const match = { matched: true, payload: first }
    const results = runMultiOutcome(() => undefined, (_observation, caseName) => {
      match.payload = caseName === 'first' ? first : second
      return match
    }, [
      ['first', payload => payload],
      ['second', payload => payload],
    ])

    Expect(Array.isArray(results)).toBe(true)
    if (Array.isArray(results)) {
      Expect(results[0]).toBe(first)
      Expect(results[1]).toBe(second)
    }
  })

  Test('joins gated action bodies in order before the enclosing scope drains cleanup', async () => {
    const gate = Deferred()
    const started = Deferred()
    const seen: string[] = []
    const count = TR.Cell(TR.Value(0))
    const first = TR.Action(() =>
      TR.ActionScope(async () => {
        TR.Defer(() => seen.push('first cleanup'))
        const continuation = captureActionContinuation()
        started.resolve()
        await gate.promise
        resumeActionContinuation(continuation)
        TR.Set(count, () => TR.Value(1))
        seen.push('first body')
      }), { name: 'FirstBody' })
    const second = TR.Action(() => {
      Expect(count.evaluate().jsValue).toBe(1)
      TR.Set(count, () => TR.Value(2))
      seen.push('second body')
    }, { name: 'SecondBody' })
    let pending: unknown
    const action = root(() =>
      TR.ActionScope(() => {
        TR.Defer(() => seen.push('root cleanup'))
        pending = runMultiOutcome(() => undefined, () => ({ matched: true, payload: undefined }), [
          ['first', () => TR.Do(first)],
          ['second', () => TR.Do(second)],
        ])
        seen.push('body end')
      })
    )
    await started.promise
    const beforeRelease = [...seen]
    const countBeforeRelease = count.evaluate().jsValue
    gate.resolve()
    const settled = await Promise.allSettled([action, Promise.resolve(pending)])

    Expect(beforeRelease).toEqual(['body end'])
    Expect(countBeforeRelease).toBe(0)
    Expect(settled).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: [undefined, undefined] },
    ])
    Expect(seen).toEqual(['body end', 'first body', 'first cleanup', 'second body', 'root cleanup'])
    Expect(count.evaluate().jsValue).toBe(2)
  })

  Test('propagates a matched action failure and suppresses later bodies, fallback and caller tail', async () => {
    const Failure = TR.Enum(
      TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'MultiOutcomes', 'enum', 'Failure']),
      ['Rejected'],
    )
    const count = TR.Cell(TR.Value(0))
    const seen: string[] = []
    const reports: unknown[] = []
    const stop = TR.Errors.onFailure(report => reports.push(report))
    const failing = TR.Action(async () => {
      const continuation = captureActionContinuation()
      await Promise.resolve()
      resumeActionContinuation(continuation)
      seen.push('first body')
      TR.Set(count, () => TR.Value(2))
      TR.Fail(Failure['Rejected']!, 'The matched body failed.')
    }, { name: 'FailingBody' })
    try {
      await TR.Action(() =>
        TR.ActionScope(async () => {
          TR.Defer(() => seen.push('cleanup'))
          TR.Set(count, () => TR.Value(1))
          await runMultiOutcome(() => undefined, (_observation, caseName) => {
            seen.push(`match ${caseName}`)
            return { matched: true, payload: undefined }
          }, [
            ['first', () => TR.Do(failing)],
            ['second', () => {
              seen.push('second body')
            }],
          ], () => {
            seen.push('fallback')
          })
          seen.push('tail')
        }), { name: 'MultiRoot' }).jsValue.invoke()
    } finally {
      stop()
    }

    Expect(seen).toEqual(['match first', 'match second', 'first body', 'cleanup'])
    Expect(count.evaluate().jsValue).toBe(0)
    Expect(reports).toEqual([Expect['objectContaining']({
      action: 'MultiRoot',
      case: 'Rejected',
      frames: ['MultiRoot', 'FailingBody'],
      message: 'The matched body failed.',
    })])
  })
})
