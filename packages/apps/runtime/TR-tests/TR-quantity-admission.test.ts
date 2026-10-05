import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure, UnexpectedBehaviorError } from '../TaoRuntime-src/TR-errors'
import { makeQuantityType, QuantityFailureCases } from '../TaoRuntime-src/TR-quantity-values'

const definition = { domain: 'Reading', defaultUnit: 'Base', units: { Base: 1, Double: 2 } } as const
const First = makeQuantityType(definition, TR.Value)
const Second = makeQuantityType(definition, TR.Value)
const Foreign = makeQuantityType(definition, TR.Value)

Describe('native quantity owner admission', () => {
  Test('categorizes runtime quantities and live wrappers without reading their backing', () => {
    let reads = 0
    const value = First.fromUnit(3, 'Double')
    const alias = TR.Alias(() => {
      reads += 1
      return value
    })
    const readonly = TR.Readonly(alias)
    for (const wrapper of [value, alias, readonly]) {
      Expect(TR.isRuntimeValue(wrapper)).toBe(true)
    }
    Expect(reads).toBe(0)
    TR.admitQuantityUnion(readonly, [First, Second], 'Choice')
    Expect(reads).toBe(1)
  })

  Test('leaves raw record and array wrapper-shaped fields and prototypes untouched', () => {
    let probes = 0
    const record = Object.defineProperties({}, {
      evaluate: {
        get: () => {
          probes += 1
          return () => record
        },
      },
      jsValue: {
        get: () => {
          probes += 1
          return First.fromJSValue(2).jsValue
        },
      },
      getJSValue: {
        get: () => {
          probes += 1
          return () => 2
        },
      },
    })
    const array = Object.defineProperties([], Object.getOwnPropertyDescriptors(record))
    const proxy = new Proxy(record, {
      getPrototypeOf: target => {
        probes += 1
        return Reflect.getPrototypeOf(target)
      },
    })
    const forged = Object.create(Object.getPrototypeOf(First.fromJSValue(2)))
    for (const data of [record, array, proxy, forged, 2, null, First.fromJSValue(2).jsValue]) {
      Expect(TR.isRuntimeValue(data)).toBe(false)
    }
    Expect(probes).toBe(0)
  })

  Test('adapts a legacy native result without probing or mutating it before exact admission', () => {
    let evaluations = 0
    let reads = 0
    let accessorProbes = 0
    const payload = Second.fromUnit(-3, 'Double').jsValue
    const legacy = {
      evaluate() {
        Expect(this === legacy).toBe(true)
        evaluations += 1
        return {
          get jsValue() {
            reads += 1
            return payload
          },
        }
      },
      get getJSValue() {
        accessorProbes += 1
        return () => -6
      },
    }
    const before = Object.getOwnPropertyDescriptors(legacy)
    Expect(TR.isRuntimeValue(legacy)).toBe(false)
    const adapted = TR.nativeQuantityResult(legacy)
    Expect(TR.isRuntimeValue(adapted)).toBe(true)
    Expect(TR.isRuntimeValue(legacy)).toBe(false)
    Expect([evaluations, reads, accessorProbes]).toEqual([0, 0, 0])
    Expect(Object.getOwnPropertyDescriptors(legacy)).toEqual(before)
    TR.admitQuantityUnion(adapted, [First, Second], 'Choice')
    Expect([evaluations, reads, accessorProbes]).toEqual([1, 1, 0])
    Expect(TR.nativeQuantityResult(adapted)).toBe(adapted)
    Expect(Second.read(adapted)).toEqual({ canonical: -6, unit: 'Double' })
  })

  Test('explicit category adaptation grants no nominal ownership and rejects malformed payloads', () => {
    for (
      const [payload, expected] of [
        [Foreign.fromUnit(2, 'Double').jsValue, QuantityFailureCases.DomainMismatch],
        [2, QuantityFailureCases.BadShape],
      ] as const
    ) {
      const adapted = TR.nativeQuantityResult({ evaluate: () => ({ jsValue: payload }) })
      let failure: unknown
      try {
        TR.admitQuantityUnion(adapted, [First, Second], 'Choice')
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(TaoActionFailure)
      Expect((failure as TaoActionFailure).caseName).toBe(expected)
    }
  })

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
