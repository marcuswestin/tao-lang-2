import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR functional core', () => {
  Test('evaluates operators, interpolation, functions, subject cases, guards, and members', () => {
    Expect(TR.Binary(TR.Value(2), '+', TR.Value(3)).jsValue).toBe(5)
    Expect(TR.Binary(TR.Value(3), '>', TR.Value(2)).jsValue).toBe(true)
    Expect(TR.Binary(TR.Value(true), 'and', TR.Value(false)).jsValue).toBe(false)
    Expect(TR.Unary('not', TR.Value(false)).jsValue).toBe(true)
    Expect(TR.Interpolate([TR.Value('Count: '), TR.Value(2), TR.Value(null)]).jsValue).toBe('Count: 2')
    Expect(TR.Member(TR.Value(['one']), ['Count']).jsValue).toBe(1)

    const next = TR.Function((value: TR.Value<number>) => TR.Binary(value, '+', TR.Value(1)))
    Expect(TR.Call<number>(next, TR.Value(2)).jsValue).toBe(3)
    let subjectEvaluations = 0
    const subject = {
      evaluate: () => {
        subjectEvaluations += 1
        return TR.Value(true)
      },
    }
    let skipped = 0
    Expect(
      TR.WhenCase(subject, [
        ['false', () => {
          skipped += 1
          return TR.Value('no')
        }],
        ['true', () => TR.Value('yes')],
      ], () => {
        skipped += 1
        return TR.Value('fallback')
      }).jsValue,
    ).toBe('yes')
    Expect(subjectEvaluations).toBe(1)
    Expect(skipped).toBe(0)

    const actions: string[] = []
    const stopped = TR.GuardAction(TR.Value(true), [
      ['false', () => actions.push('first')],
      ['true', () => actions.push('second')],
    ])
    Expect(stopped).toBe(true)
    Expect(actions).toEqual(['second'])
    Expect(TR.GuardAction(TR.Value(false), [['true', () => actions.push('unexpected')]])).toBe(false)
    Expect(TR.WhenCaseRender(TR.Value(false), [['true', () => 'first']], () => 'otherwise')).toBe('otherwise')
    Expect(TR.GuardRender(TR.Value(false), [['true', () => 'first']], () => 'remaining')).toBe('remaining')
    Expect(TR.IsEmpty(TR.Value('')).jsValue).toBe(true)
    Expect(TR.IsEmpty(TR.Value([])).jsValue).toBe(true)

    const confirmResult = TR.Enum(['Confirmed', 'Cancelled'])
    const otherResult = TR.Enum(['Confirmed'])
    Expect(TR.IsCase(confirmResult['Confirmed']!, confirmResult['Confirmed']!).jsValue).toBe(true)
    Expect(TR.IsCase(confirmResult['Confirmed']!, otherResult['Confirmed']!).jsValue).toBe(false)
    Expect(TR.IsCase(TR.Value(false), TR.Value(false)).jsValue).toBe(true)
    let ifRuns = 0
    TR.If(TR.Value(false), () => ifRuns++)
    TR.If(TR.Value(true), () => ifRuns++)
    Expect(ifRuns).toBe(1)

    const query = [] as unknown as unknown[] & { Loading: boolean; Error: string }
    Object.defineProperties(query, {
      Loading: { value: true, configurable: true },
      Error: { value: '', configurable: true },
    })
    Expect(TR.IsEmpty(TR.Value(query)).jsValue).toBe(false)
    Expect(TR.GuardAction(TR.Value(query), [['loading', () => actions.push('loading')]])).toBe(true)
    Expect(actions).toEqual(['second', 'loading'])

    Object.defineProperties(query, {
      Loading: { value: false, configurable: true },
      Error: { value: 'disk full', configurable: true },
    })
    let message = ''
    Expect(TR.GuardAction(TR.Value(query), [['error', payload => {
      message = payload.jsValue
    }]])).toBe(true)
    Expect(message).toBe('disk full')
    Expect(TR.IsEmpty(TR.Value(query)).jsValue).toBe(false)

    Object.defineProperty(query, 'Error', { value: '', configurable: true })
    Expect(TR.IsEmpty(TR.Value(query)).jsValue).toBe(true)
  })
})
