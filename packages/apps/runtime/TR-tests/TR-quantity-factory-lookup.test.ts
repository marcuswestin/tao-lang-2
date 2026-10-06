import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import { QuantityArithmetic, quantityOperand, scalarOperand } from '../TaoRuntime-src/TR-quantity-arithmetic'
import {
  factoryOfQuantityInput,
  makeQuantityType,
  QuantityFailureCases,
} from '../TaoRuntime-src/TR-quantity-values'

const units = { Base: 1, minutes: 60 } as const
const First = makeQuantityType({ domain: 'SameDomain', defaultUnit: 'Base', units }, TR.Value)
const Second = makeQuantityType({ domain: 'SameDomain', defaultUnit: 'Base', units }, TR.Value)

function checkedFactoryOf(value: Parameters<typeof factoryOfQuantityInput>[0]): unknown {
  return factoryOfQuantityInput(value)
}

function expectBadShape(value: unknown): void {
  let failure: unknown
  try {
    factoryOfQuantityInput({ evaluate: () => ({ jsValue: value }) })
  } catch (error) {
    failure = error
  }
  Expect(failure).toBeInstanceOf(TaoActionFailure)
  Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.BadShape)
}

Describe('quantity factory lookup', () => {
  Test('returns exact factory identity for same-named declarations and descendants', () => {
    const child = First.derive({ domain: 'SameDomain', invariant: canonical => canonical >= 0 })
    const grandchild = child.derive({ domain: 'SameDomain', invariant: canonical => canonical <= 10 })
    const firstValue = First.fromJSValue(2)
    const secondValue = Second.fromJSValue(2)
    const descendantValue = grandchild.fromJSValue(2)
    const view = First.inUnit(descendantValue, 'Base')

    Expect(checkedFactoryOf(firstValue)).toBe(First)
    Expect(checkedFactoryOf(secondValue)).toBe(Second)
    Expect(checkedFactoryOf(descendantValue)).toBe(grandchild)
    Expect(checkedFactoryOf(view)).toBe(grandchild)
  })

  Test('resolves authentic payloads carried through cells, aliases, copies and readonly values', () => {
    const child = First.derive({ domain: 'StoredChild' })
    const value = child.inUnit(child.fromJSValue(2), 'minutes')
    const cell = TR.Cell(value)
    const alias = TR.Alias(() => cell.evaluate())
    const copy = TR.Copy(alias)
    const readonly = TR.Readonly<typeof copy.jsValue>(copy)

    for (const evaluable of [value, cell, alias, copy, readonly]) {
      Expect(checkedFactoryOf(evaluable)).toBe(child)
    }
  })

  Test('evaluates once and arithmetic keeps derived constraints through the returned factory', () => {
    let evaluations = 0
    const child = First.derive({ domain: 'Bounded', invariant: canonical => canonical >= 0 && canonical <= 10 })
    const value = child.fromJSValue(2)
    const view = child.inUnit(value, 'minutes')
    const once = {
      evaluate() {
        evaluations += 1
        return { jsValue: view.jsValue }
      },
    }
    const factory = factoryOfQuantityInput(once)

    Expect(evaluations).toBe(1)
    Expect(factory).toBe(child)
    Expect(factory.read(view)).toEqual({ canonical: 2, unit: 'minutes' })
    const result = QuantityArithmetic.add(factory, quantityOperand(factory, view), scalarOperand(1))
    Expect(factoryOfQuantityInput(result)).toBe(child)
    Expect(factory.read(result)).toEqual({
      canonical: 3,
      unit: 'minutes',
    })
    for (
      const body of [
        () => QuantityArithmetic.add(factory, scalarOperand(-2), scalarOperand(1)),
        () => QuantityArithmetic.add(factory, scalarOperand(6), scalarOperand(5)),
      ]
    ) {
      let failure: unknown
      try {
        body()
      } catch (error) {
        failure = error
      }
      Expect(failure).toBeInstanceOf(TaoActionFailure)
      Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.Invariant)
    }
  })

  Test('rejects forged prototypes and getter shapes without reading their fields', () => {
    let reads = 0
    const getters = Object.defineProperties({}, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'SameDomain') },
      unit: { get: () => (reads += 1, 'Base') },
    })
    const prototype = Object.create(Object.getPrototypeOf(First.fromJSValue(1).jsValue))
    const prototypeGetters = Object.defineProperties(prototype, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'SameDomain') },
      unit: { get: () => (reads += 1, 'Base') },
    })

    expectBadShape(getters)
    expectBadShape(prototypeGetters)
    expectBadShape({
      get canonical() {
        reads += 1
        return 1
      },
      get domain() {
        reads += 1
        return 'SameDomain'
      },
    })
    Expect(reads).toBe(0)
  })
})
