import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { TaoActionFailure } from '../TaoRuntime-src/TR-errors'
import {
  makeQuantityType,
  QuantityFailureCases,
  quantityToText,
} from '../TaoRuntime-src/TR-quantity-values'

const Duration = makeQuantityType({
  domain: 'Duration',
  defaultUnit: 'Seconds',
  units: { Seconds: 1, Minutes: 60, Tiny: 5e-324, Huge: 1e308 },
}, TR.Value)
const Ratio = makeQuantityType({
  domain: 'Ratio',
  defaultUnit: 'Unity',
  units: { Unity: 1, Percent: 0.01 },
}, TR.Value)

function expectBadShape(value: unknown): void {
  let failure: unknown
  try {
    quantityToText({ evaluate: () => ({ jsValue: value }) })
  } catch (error) {
    failure = error
  }
  Expect(failure).toBeInstanceOf(TaoActionFailure)
  Expect((failure as TaoActionFailure).caseName).toBe(QuantityFailureCases.BadShape)
}

Describe('quantity text formatting', () => {
  Test('renders canonical values in their selected units', () => {
    Expect(quantityToText(Duration.fromUnit(2, 'Minutes'))).toBe('2 Minutes')
    Expect(quantityToText(Duration.fromJSValue(120))).toBe('120 Seconds')
    Expect(quantityToText(Ratio.fromUnit(50, 'Percent'))).toBe('50 Percent')
    Expect(quantityToText(Ratio.fromUnit(5, 'Unity'))).toBe('5 Unity')
  })

  Test('keeps signed and zero readings', () => {
    Expect(quantityToText(Duration.fromUnit(-2, 'Minutes'))).toBe('-2 Minutes')
    Expect(quantityToText(Duration.fromUnit(0, 'Minutes'))).toBe('0 Minutes')
  })

  Test('retains alternate and descendant unit views through runtime values', () => {
    const child = Duration.derive({ domain: 'ChildDuration' })
    const source = child.fromUnit(2, 'Minutes')
    const minutes = Duration.inUnit(source, 'Minutes')
    const seconds = child.inUnit(source, 'Seconds')

    Expect(quantityToText(minutes)).toBe('2 Minutes')
    Expect(quantityToText(seconds)).toBe('120 Seconds')
    Expect(quantityToText(TR.Copy(seconds))).toBe('120 Seconds')
  })

  Test('evaluates a changing wrapper once', () => {
    const first = Duration.fromUnit(2, 'Minutes')
    const next = Duration.fromUnit(3, 'Minutes')
    let evaluations = 0
    const changing = {
      evaluate() {
        evaluations += 1
        return { jsValue: evaluations === 1 ? first.jsValue : next.jsValue }
      },
    }

    Expect(quantityToText(changing)).toBe('2 Minutes')
    Expect(evaluations).toBe(1)
  })

  Test('uses a finite canonical ratio expression when the selected reading overflows', () => {
    Expect(quantityToText(Duration.inUnit(Duration.fromJSValue(1e308), 'Tiny')))
      .toBe('1e+308 / 5e-324 Tiny')
  })

  Test('keeps a nonzero reading visible when selected unit division underflows', () => {
    Expect(quantityToText(Duration.inUnit(Duration.fromJSValue(5e-324), 'Huge')))
      .toBe('5e-324 / 1e+308 Huge')
  })

  Test('rejects forged quantity shapes without reading fields', () => {
    let reads = 0
    const getters = Object.defineProperties({}, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'Duration') },
      unit: { get: () => (reads += 1, 'Seconds') },
    })
    const prototype = Object.create(Object.getPrototypeOf(Duration.fromJSValue(1).jsValue))
    Object.defineProperties(prototype, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'Duration') },
      unit: { get: () => (reads += 1, 'Seconds') },
    })

    expectBadShape(getters)
    expectBadShape(prototype)
    Expect(reads).toBe(0)
  })
})
