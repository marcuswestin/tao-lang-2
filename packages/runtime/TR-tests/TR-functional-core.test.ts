import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'

Describe('TR functional core', () => {
  Test('evaluates operators, interpolation, functions, total conditionals, and members', () => {
    Expect(TR.Binary(TR.Value(2), '+', TR.Value(3)).jsValue).toBe(5)
    Expect(TR.Binary(TR.Value(3), '>', TR.Value(2)).jsValue).toBe(true)
    Expect(TR.Binary(TR.Value(true), 'and', TR.Value(false)).jsValue).toBe(false)
    Expect(TR.Unary('not', TR.Value(false)).jsValue).toBe(true)
    Expect(TR.Interpolate([TR.Value('Count: '), TR.Value(2), TR.Value(null)]).jsValue).toBe('Count: 2')
    Expect(TR.Member(TR.Value(['one']), ['Empty']).jsValue).toBe(false)
    Expect(TR.Member(TR.Value(['one']), ['Count']).jsValue).toBe(1)

    const next = TR.Function((value: TR.Value<number>) => TR.Binary(value, '+', TR.Value(1)))
    Expect(TR.Call<number>(next, TR.Value(2)).jsValue).toBe(3)
    let skipped = 0
    Expect(
      TR.When([
        [() => TR.Value(false), () => {
          skipped += 1
          return TR.Value('no')
        }],
        [() => TR.Value(true), () => TR.Value('yes')],
      ], () => {
        skipped += 1
        return TR.Value('fallback')
      }).jsValue,
    ).toBe('yes')
    Expect(skipped).toBe(0)

    const actions: string[] = []
    TR.WhenAction(
      [
        [() => TR.Value(false), () => actions.push('first')],
        [() => TR.Value(true), () => actions.push('second')],
      ],
      () => actions.push('otherwise'),
    )
    Expect(actions).toEqual(['second'])
    Expect(TR.WhenRender([[() => TR.Value(false), () => 'first']], () => 'otherwise')).toBe('otherwise')
  })
})
