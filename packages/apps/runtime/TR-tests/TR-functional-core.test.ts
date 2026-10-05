import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

function identity(name: string): TR.DeclarationIdentity {
  return TR.Navigation.Identity(['tao.declaration', 1, 'tests', '@workspace', 'FunctionalCore', 'enum', name])
}

Describe('TR functional core', () => {
  Test('preserves omitted leading slots while a wrapped none suppresses the default', () => {
    let defaults = 0
    const format = TR.Function((prefix: TR.Value<string | null> | undefined, count: TR.Value<number>) => {
      const selected = prefix ?? (() => {
        defaults += 1
        return TR.Value('default')
      })()
      return TR.Value([selected.getJSValue(), count.getJSValue()])
    })
    Expect(TR.Call(format, undefined, TR.Value(2)).getJSValue()).toEqual(['default', 2])
    Expect(TR.Call(format, TR.Value(null), TR.Value(3)).getJSValue()).toEqual([null, 3])
    Expect(defaults).toBe(1)
  })

  Test('evaluates operators, interpolation, functions, subject cases, guards, and members', () => {
    Expect(TR.Binary(TR.Value(2), '+', TR.Value(3)).jsValue).toBe(5)
    Expect(TR.Binary(TR.Value(3), '>', TR.Value(2)).jsValue).toBe(true)
    Expect(TR.Binary(TR.Value(true), 'and', TR.Value(false)).jsValue).toBe(false)
    Expect(TR.Unary('not', TR.Value(false)).jsValue).toBe(true)
    Expect(TR.Interpolate([TR.Value('Count: '), TR.Value(2), TR.Value(null)]).jsValue).toBe('Count: 2')
    Expect(TR.Member(TR.Value(['one']), ['Count']).jsValue).toBe(1)
    Expect(TR.Member(TR.Value({}), ['Missing']).jsValue).toBe(null)

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
    Expect(TR.IsCase(TR.Value(''), 'empty').jsValue).toBe(true)
    Expect(TR.IsCase(TR.Value([]), 'empty').jsValue).toBe(true)

    const confirmResult = TR.Enum(identity('ConfirmResult'), ['Confirmed', 'Cancelled'])
    Expect(
      TR.WhenCase(confirmResult['Confirmed']!, [['Confirmed', () => TR.Value('matched')]], () => TR.Value('missed'))
        .jsValue,
    ).toBe('matched')
    Expect(
      TR.WhenCaseRender(
        confirmResult['Cancelled']!,
        [['Confirmed', () => 'wrong'], ['Cancelled', () => 'cancelled']],
        () => 'missed',
      ),
    ).toBe('cancelled')
    Expect(TR.WhenCaseRender(TR.Value({ caseName: 'Confirmed' }), [['Confirmed', () => 'forged']], () => 'safe')).toBe(
      'safe',
    )
    const otherResult = TR.Enum(identity('OtherResult'), ['Confirmed'])
    TR.Enum(identity('ConfirmResult'), ['Confirmed', 'Cancelled'])
    Expect(TR.WhenCaseRender(confirmResult['Confirmed']!, [['Confirmed', () => 'original mount']], () => 'missed'))
      .toBe('original mount')
    Expect(TR.IsCase(confirmResult['Confirmed']!, confirmResult['Confirmed']!).jsValue).toBe(true)
    Expect(TR.IsCase(confirmResult['Confirmed']!, otherResult['Confirmed']!).jsValue).toBe(false)
    Expect(TR.IsCase(TR.Value(false), TR.Value(false)).jsValue).toBe(true)
    let ifRuns = 0
    TR.If(TR.Value(false), () => ifRuns++)
    TR.If(TR.Value(true), () => ifRuns++)
    Expect(ifRuns).toBe(1)
    // A check reports a stop whenever its validated boolean is not true.
    Expect(TR.Check(TR.Value(true))).toBe(false)
    Expect(TR.Check(TR.Value(false))).toBe(true)
    // A required field is missing when it reads as none or as an empty text or list.
    const required = [['Title', 'Name it'], ['Tags', 'Tag it'], ['Due', 'Date it'], ['Count', 'Count it']] as const
    const draft = TR.Value({ Title: '', Tags: [], Due: null, Count: 0 })
    Expect(TR.Problems(draft, required).jsValue).toEqual(['Name it', 'Tag it', 'Date it'])
    Expect(TR.Incomplete(draft, required).jsValue).toBe(true)
    const done = TR.Value({ Title: 'Ready', Tags: ['one'], Due: 1, Count: 0 })
    Expect(TR.Problems(done, required).jsValue).toEqual([])
    Expect(TR.Incomplete(done, required).jsValue).toBe(false)

    const query = [] as unknown as unknown[] & { Loading: boolean; Error: string }
    Object.defineProperties(query, {
      Loading: { value: true, configurable: true },
      Error: { value: '', configurable: true },
    })
    Expect(TR.IsCase(TR.Value(query), 'empty').jsValue).toBe(false)
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
    Expect(TR.IsCase(TR.Value(query), 'empty').jsValue).toBe(false)

    Object.defineProperty(query, 'Error', { value: '', configurable: true })
    Expect(TR.IsCase(TR.Value(query), 'empty').jsValue).toBe(true)
  })
})
