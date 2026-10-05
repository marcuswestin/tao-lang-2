import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure, UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { makeQuantityType, QuantityFailureCases } from '../TaoRuntime-src/TR-quantity-values'

const definition = { domain: 'Reading', defaultUnit: 'Base', units: { Base: 1, Double: 2 } } as const
const First = makeQuantityType(definition, TR.Value)
const Second = makeQuantityType(definition, TR.Value)
const Foreign = makeQuantityType(definition, TR.Value)

Describe('native quantity owner admission', () => {
  Test('admits either declared owner without changing its wrapper or unit view', () => {
    for (const owner of [First, Second]) {
      const value = owner.fromUnit(-2, 'Double')
      TR.admitQuantityUnion(value, [First, Second], 'Choice')
      Expect(owner.read(value)).toEqual({ canonical: -4, unit: 'Double' })
      Expect(value.getJSValue()).toBe(-4)
    }
  })

  Test('evaluates an unknown native wrapper once and reads its snapshot payload once', () => {
    let evaluations = 0
    let reads = 0
    const payload = Second.fromUnit(3, 'Double').jsValue
    const value = {
      evaluate() {
        Expect(this === value).toBe(true)
        evaluations += 1
        return {
          get jsValue() {
            reads += 1
            return payload
          },
        }
      },
    }
    TR.admitQuantityUnion(value, [First, Second], 'Choice')
    Expect([evaluations, reads]).toEqual([1, 1])
  })

  Test('rejects an undeclared owner even when names, units and canonical data agree', () => {
    let failure: unknown
    try {
      TR.admitQuantityUnion(Foreign.fromJSValue(2), [First, Second], 'Choice')
    } catch (error) {
      failure = error
    }
    Expect(failure).toBeInstanceOf(TaoActionFailure)
    Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.DomainMismatch)
    Expect(First.ownsPayload(Second.fromJSValue(2).jsValue)).toBe(false)
    Expect(First.ownsPayload(First.fromJSValue(2).jsValue)).toBe(true)
  })

  Test('rejects raw backing, raw payloads, forged payloads and invalid wrapper snapshots', () => {
    for (
      const value of [
        2,
        null,
        First.fromJSValue(2).jsValue,
        TR.Value(2),
        TR.Value({ canonical: 2, domain: 'Reading' }),
        { evaluate: 1 },
        { evaluate: () => null },
        { evaluate: () => 2 },
      ]
    ) {
      let failure: unknown
      try {
        TR.admitQuantityUnion(value, [First, Second], 'Choice')
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(TaoActionFailure)
      Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.BadShape)
    }
  })

  Test('owner predicates inspect only private branding, without invoking foreign property getters', () => {
    let probes = 0
    const foreign = {
      get canonical() {
        probes += 1
        return 2
      },
      get domain() {
        probes += 1
        return 'Reading'
      },
    }
    Expect(First.ownsPayload(foreign)).toBe(false)
    Expect(probes).toBe(0)
    Expect(() => TR.admitQuantityUnion(First.fromJSValue(2), [], 'Choice')).toThrow(UnexpectedBehaviorError)
  })
})
