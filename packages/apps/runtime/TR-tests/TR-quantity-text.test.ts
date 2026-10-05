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
  defaultUnit: 'seconds',
  units: { seconds: 1, minutes: 60, tiny: 5e-324, huge: 1e308 },
}, TR.Value)
const Ratio = makeQuantityType({
  domain: 'Ratio',
  defaultUnit: 'unity',
  units: { unity: 1, percent: 0.01 },
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
  Test('interpolates quantities in their retained unit and samples each source once', () => {
    let reads = 0
    const source = TR.Alias(() => {
      reads += 1
      return Duration.fromUnit(reads === 1 ? 2 : 3, 'minutes')
    })
    Expect(TR.Interpolate([TR.Value('Wait '), source, TR.Value(undefined)]).jsValue).toBe('Wait 2 minutes')
    Expect(reads).toBe(1)
    Expect(TR.quantityToText(Ratio.fromUnit(50, 'percent'))).toBe('50 percent')
  })

  Test('renders canonical values in their selected units', () => {
    Expect(quantityToText(Duration.fromUnit(2, 'minutes'))).toBe('2 minutes')
    Expect(quantityToText(Duration.fromJSValue(120))).toBe('120 seconds')
    Expect(quantityToText(Ratio.fromUnit(50, 'percent'))).toBe('50 percent')
    Expect(quantityToText(Ratio.fromUnit(5, 'unity'))).toBe('5 unity')
  })

  Test('keeps signed and zero readings', () => {
    Expect(quantityToText(Duration.fromUnit(-2, 'minutes'))).toBe('-2 minutes')
    Expect(quantityToText(Duration.fromUnit(0, 'minutes'))).toBe('0 minutes')
  })

  Test('retains alternate and descendant unit views through runtime values', () => {
    const child = Duration.derive({ domain: 'ChildDuration' })
    const source = child.fromUnit(2, 'minutes')
    const minutes = Duration.inUnit(source, 'minutes')
    const seconds = child.inUnit(source, 'seconds')

    Expect(quantityToText(minutes)).toBe('2 minutes')
    Expect(quantityToText(seconds)).toBe('120 seconds')
    Expect(quantityToText(TR.Copy(seconds))).toBe('120 seconds')
  })

  Test('evaluates a changing wrapper once', () => {
    const first = Duration.fromUnit(2, 'minutes')
    const next = Duration.fromUnit(3, 'minutes')
    let evaluations = 0
    const changing = {
      evaluate() {
        evaluations += 1
        return { jsValue: evaluations === 1 ? first.jsValue : next.jsValue }
      },
    }

    Expect(quantityToText(changing)).toBe('2 minutes')
    Expect(evaluations).toBe(1)
  })

  Test('uses a finite canonical ratio expression when the selected reading overflows', () => {
    Expect(quantityToText(Duration.inUnit(Duration.fromJSValue(1e308), 'tiny')))
      .toBe('1e+308 / 5e-324 tiny')
  })

  Test('keeps a nonzero reading visible when selected unit division underflows', () => {
    Expect(quantityToText(Duration.inUnit(Duration.fromJSValue(5e-324), 'huge')))
      .toBe('5e-324 / 1e+308 huge')
  })

  Test('rejects forged quantity shapes without reading fields', () => {
    let reads = 0
    const getters = Object.defineProperties({}, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'Duration') },
      unit: { get: () => (reads += 1, 'seconds') },
    })
    const prototype = Object.create(Object.getPrototypeOf(Duration.fromJSValue(1).jsValue))
    Object.defineProperties(prototype, {
      canonical: { get: () => (reads += 1, 1) },
      domain: { get: () => (reads += 1, 'Duration') },
      unit: { get: () => (reads += 1, 'seconds') },
    })

    expectBadShape(getters)
    expectBadShape(prototype)
    Expect(reads).toBe(0)
  })
})
