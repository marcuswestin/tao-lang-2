import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { Interval } from '../../stdlib/@tao/time/Time'
import { runAction, type TaoActionReceipt } from '../TaoRuntime-src/TR-action-transactions'
import { runEffectOutcome } from '../TaoRuntime-src/TR-effect-outcomes'
import { TaoActionFailure, UserInputError } from '../TaoRuntime-src/TR-errors'
import {
  isQuantityPayload,
  makeQuantityType,
  QuantityFailureCases,
  quantityPayloadJSValue,
  type TaoQuantityValue,
} from '../TaoRuntime-src/TR-quantity-values'

// Fixtures model declaration-owned metadata; production supplies no Duration/Ratio registry.
const durationDefinition = {
  domain: 'Duration',
  defaultUnit: 'Seconds',
  units: { Seconds: 1, Milliseconds: 0.001, Minutes: 60, Hours: 3600 },
} as const
const Duration = makeQuantityType(durationDefinition, TR.Value)
const Ratio = makeQuantityType({
  domain: 'Ratio',
  defaultUnit: 'Unity',
  units: { Unity: 1, Percent: 0.01, Permille: 0.001 },
}, TR.Value)
const Probability = makeQuantityType({
  domain: 'Probability',
  defaultUnit: 'Unity',
  units: { Unity: 1, Percent: 0.01 },
  invariant: canonical => canonical >= 0 && canonical <= 1,
}, TR.Value)

type DurationValue = TaoQuantityValue<'Duration', keyof typeof durationDefinition.units>

function expectFailure(body: () => unknown, expected: string): void {
  let raised: unknown
  try {
    body()
  } catch (error) {
    raised = error
  }
  Expect(raised).toBeInstanceOf(TaoActionFailure)
  Expect((raised as TaoActionFailure).caseName).toBe(expected)
}

// This explicitly authored contract chooses a domain and result view; storage grants no operators.
function addDuration(left: TR.Value<unknown>, right: TR.Value<unknown>): DurationValue {
  const first = Duration.read(left)
  const second = Duration.read(right)
  return Duration.inUnit(Duration.fromJSValue(first.canonical + second.canonical), first.unit)
}

Describe('checked quantity values', () => {
  Test('normalizes a signed unit input once and treats native input as canonical', () => {
    const minutes = Duration.fromUnit(-2, 'Minutes')
    Expect(Duration.read(minutes)).toEqual({ canonical: -120, unit: 'Minutes' })
    Expect(Duration.read(Duration.fromJSValue(120))).toEqual({ canonical: 120, unit: 'Seconds' })
    Expect(quantityPayloadJSValue(minutes.jsValue)).toBe(-120)
    Expect(Duration.read(Duration.fromUnit(1500, 'Milliseconds')).canonical).toBe(1.5)
  })

  Test('retains canonical data while selecting views without repeating the invariant', () => {
    let checks = 0
    const measured = makeQuantityType({
      domain: 'Measured',
      defaultUnit: 'Base',
      units: { Base: 1, Double: 2, Tiny: Number.MIN_VALUE },
      invariant: () => {
        checks += 1
        return true
      },
    }, TR.Value)
    const value = measured.fromUnit(4, 'Double')
    const tinyView = measured.inUnit(measured.inUnit(value, 'Base'), 'Tiny')
    Expect(measured.read(tinyView)).toEqual({ canonical: 8, unit: 'Tiny' })
    Expect(checks).toBe(1)
    Expect(quantityPayloadJSValue(tinyView.jsValue)).toBe(8)
    const negativeZero = measured.inUnit(measured.fromJSValue(-0), 'Double')
    Expect(Object.is(measured.read(negativeZero).canonical, -0)).toBe(true)
  })

  Test('preserves the domain and view through real cells, aliases, argument passing and copies', () => {
    const minutes = Duration.fromUnit(2, 'Minutes')
    const cell = TR.Cell(minutes)
    cell.set(Duration.inUnit(minutes, 'Milliseconds'))
    const alias = TR.Alias(() => cell.evaluate())
    const throughArgument = (value: TR.Value<unknown>) => value.evaluate()
    const copy = TR.Copy(alias)
    Expect(Duration.read(throughArgument(copy))).toEqual({ canonical: 120, unit: 'Milliseconds' })
    Expect(copy.jsValue).toBe(cell.evaluate().jsValue)
    const nested = TR.Copy(TR.Value({ Amount: cell.evaluate().jsValue }))
    Expect(Duration.read(TR.Value(nested.jsValue.Amount))).toEqual({ canonical: 120, unit: 'Milliseconds' })
    Expect(isQuantityPayload(nested.jsValue.Amount)).toBe(true)
  })

  Test('serializes extracted canonical data and restores the declared default when decoding', () => {
    const value = Duration.inUnit(Duration.fromUnit(2, 'Minutes'), 'Milliseconds')
    const serialized = JSON.stringify(quantityPayloadJSValue(value.jsValue))
    Expect(serialized).toBe('120')
    Expect(Duration.read(Duration.fromJSValue(JSON.parse(serialized)))).toEqual({ canonical: 120, unit: 'Seconds' })
    Expect(quantityPayloadJSValue(TR.Value(120).jsValue)).toBeUndefined()
    Expect(quantityPayloadJSValue(undefined)).toBeUndefined()
  })

  Test('keeps Ratio signed and unbounded while an authored Duration contract selects its result view', () => {
    Expect(Ratio.read(Ratio.fromUnit(150, 'Percent'))).toEqual({ canonical: 1.5, unit: 'Percent' })
    Expect(Ratio.read(Ratio.fromUnit(-250, 'Permille'))).toEqual({ canonical: -0.25, unit: 'Permille' })
    Expect(Duration.read(addDuration(Duration.fromUnit(2, 'Minutes'), Duration.fromUnit(500, 'Milliseconds'))))
      .toEqual({ canonical: 120.5, unit: 'Minutes' })
  })

  Test('rejects different nominal domains even when factories share a diagnostic name', () => {
    const sibling = makeQuantityType(durationDefinition, TR.Value)
    expectFailure(() => Duration.read(sibling.fromJSValue(120)), QuantityFailureCases.DomainMismatch)
    expectFailure(() => Duration.inUnit(Ratio.fromJSValue(1), 'Seconds'), QuantityFailureCases.DomainMismatch)
    expectFailure(() => addDuration(Duration.fromJSValue(1), Ratio.fromJSValue(1)), QuantityFailureCases.DomainMismatch)
    Expect(Duration.read(Duration.fromJSValue(1))).toEqual({ canonical: 1, unit: 'Seconds' })
  })

  Test('rejects foreign shapes and forged prototypes before extracting private storage', () => {
    for (const input of ['120', null, {}, true, new Number(120)]) {
      expectFailure(() => Duration.fromJSValue(input), QuantityFailureCases.BadShape)
    }
    const forged = Object.create(Object.getPrototypeOf(Duration.fromJSValue(1).jsValue))
    Expect(isQuantityPayload(forged)).toBe(false)
    Expect(quantityPayloadJSValue(forged)).toBeUndefined()
    expectFailure(() => Duration.read(TR.Value(forged)), QuantityFailureCases.BadShape)
    expectFailure(() => Duration.read(TR.Value({ canonical: 120, unit: 'Seconds' })), QuantityFailureCases.BadShape)
  })

  Test('protects canonical access, domain admission and branding from prototype or constructor replacement', () => {
    const value = Duration.fromJSValue(2)
    const prototype = Object.getPrototypeOf(value.jsValue)
    const constructor = prototype.constructor
    Expect(Reflect.defineProperty(prototype, 'canonical', { get: () => Infinity })).toBe(false)
    Expect(Reflect.set(prototype, 'belongsTo', () => true)).toBe(false)
    Expect(Reflect.set(constructor, 'is', () => true)).toBe(false)
    Expect(quantityPayloadJSValue(value.jsValue)).toBe(2)
    Expect(quantityPayloadJSValue({ canonical: Infinity })).toBeUndefined()
    Expect(Duration.read(Duration.inUnit(value, 'Minutes'))).toEqual({ canonical: 2, unit: 'Minutes' })
    expectFailure(() => Duration.read(Ratio.fromJSValue(2)), QuantityFailureCases.DomainMismatch)
  })

  Test('rejects nonfinite backing, unit normalization and authored results', () => {
    for (const input of [NaN, Infinity, -Infinity]) {
      expectFailure(() => Duration.fromJSValue(input), QuantityFailureCases.NonFinite)
      expectFailure(() => Duration.fromUnit(input, 'Seconds'), QuantityFailureCases.NonFinite)
    }
    expectFailure(() => Duration.fromUnit(Number.MAX_VALUE, 'Hours'), QuantityFailureCases.NonFinite)
    expectFailure(
      () => addDuration(Duration.fromJSValue(Number.MAX_VALUE), Duration.fromJSValue(Number.MAX_VALUE)),
      QuantityFailureCases.NonFinite,
    )
    expectFailure(() => Ratio.fromJSValue(1 / 0), QuantityFailureCases.NonFinite)
  })

  Test('checks declared invariants on construction and authored results', () => {
    expectFailure(() => Probability.fromUnit(101, 'Percent'), QuantityFailureCases.Invariant)
    expectFailure(() => Probability.fromJSValue(-0.01), QuantityFailureCases.Invariant)
    const first = Probability.fromJSValue(0.75)
    const second = Probability.fromJSValue(0.5)
    expectFailure(
      () => Probability.fromJSValue(Probability.read(first).canonical + Probability.read(second).canonical),
      QuantityFailureCases.Invariant,
    )
    Expect(Probability.read(Probability.fromUnit(100, 'Percent'))).toEqual({ canonical: 1, unit: 'Percent' })
  })

  Test('rejects unrelated and inherited unit names without defaulting them', () => {
    for (const name of ['Percent', 'toString', '__proto__']) {
      expectFailure(() => Duration.fromUnit(1, name as never), QuantityFailureCases.UnknownUnit)
      expectFailure(() => Duration.inUnit(Duration.fromJSValue(1), name as never), QuantityFailureCases.UnknownUnit)
    }
    expectFailure(() => Duration.fromUnit(1, new String('Seconds') as never), QuantityFailureCases.UnknownUnit)
  })

  Test('snapshots and freezes declaration metadata against later caller mutation', () => {
    const source = {
      domain: 'MutableMetadata',
      defaultUnit: 'Seconds' as 'Seconds' | 'Minutes',
      units: { Seconds: 1, Minutes: 60 },
      invariant: (canonical: number) => canonical >= 0,
    }
    const factory = makeQuantityType(source, TR.Value)
    source.units.Minutes = 600
    source.defaultUnit = 'Minutes'
    source.invariant = () => true
    Expect(factory.read(factory.fromUnit(2, 'Minutes'))).toEqual({ canonical: 120, unit: 'Minutes' })
    Expect(factory.read(factory.fromJSValue(120)).unit).toBe('Seconds')
    expectFailure(() => factory.fromJSValue(-1), QuantityFailureCases.Invariant)
    Expect(Object.isFrozen(factory)).toBe(true)
    Expect(Object.isFrozen(factory.definition)).toBe(true)
    Expect(Object.isFrozen(factory.definition.units)).toBe(true)
    Expect(Object.isFrozen(factory.fromJSValue(1).jsValue)).toBe(true)
  })

  Test('rejects invalid descriptor defaults and nonpositive or nonfinite scales', () => {
    Expect(() => makeQuantityType({ domain: 'Bad', defaultUnit: 'toString', units: { Base: 1 } } as never, TR.Value))
      .toThrow(UserInputError)
    Expect(() =>
      makeQuantityType({ domain: 'Bad', defaultUnit: new String('Base'), units: { Base: 1 } } as never, TR.Value)
    )
      .toThrow(UserInputError)
    Expect(() =>
      makeQuantityType({ domain: new String('Bad'), defaultUnit: 'Base', units: { Base: 1 } } as never, TR.Value)
    )
      .toThrow(UserInputError)
    Expect(() =>
      makeQuantityType({ domain: 'Bad', defaultUnit: 'Base', units: { Base: 1 }, invariant: true } as never, TR.Value)
    )
      .toThrow(UserInputError)
    for (const scale of [0, -1, NaN, Infinity]) {
      Expect(() => makeQuantityType({ domain: 'Bad', defaultUnit: 'Base', units: { Base: scale } }, TR.Value))
        .toThrow(UserInputError)
    }
    // compile-only: the default is inferred from unit-map keys, not a widening anchor.
    if (false) {
      // @ts-expect-error Undeclared default units must not widen the unit union.
      makeQuantityType({ domain: 'Bad', defaultUnit: 'Other', units: { Base: 1 } }, TR.Value)
      // @ts-expect-error A Duration factory admits all its declared units, and no Ratio unit.
      Duration.fromUnit(1, 'Percent')
    }
  })

  Test('contains a modeled quantity failure at the real savepoint and preserves the earlier view', async () => {
    const cell = TR.Cell(Duration.fromUnit(1, 'Seconds'))
    let receipt: TaoActionReceipt | undefined
    await runAction(
      'quantity savepoint',
      [],
      () => {
        cell.set(Duration.fromUnit(2, 'Minutes'))
        runEffectOutcome(
          () => {
            cell.set(Duration.fromUnit(3, 'Hours'))
            Probability.fromJSValue(2)
          },
          { declared: [QuantityFailureCases.Invariant], name: 'checked factory' },
          [[QuantityFailureCases.Invariant, () => {}]],
        )
      },
      false,
      false,
      undefined,
      value => {
        receipt = value
      },
    )
    Expect(receipt?.outcome).toBe('committed')
    Expect(Duration.read(cell)).toEqual({ canonical: 120, unit: 'Minutes' })
  })

  Test('rolls back a root on an unhandled modeled result and skips subsequent work', async () => {
    const cell = TR.Cell(Duration.fromUnit(2, 'Minutes'))
    let later = false
    let receipt: TaoActionReceipt | undefined
    await runAction(
      'quantity root',
      [],
      () => {
        cell.set(Duration.fromUnit(3, 'Hours'))
        Ratio.fromJSValue(1 / 0)
        later = true
      },
      false,
      false,
      undefined,
      value => {
        receipt = value
      },
    )
    Expect(receipt?.outcome).toBe('failed')
    Expect(receipt?.failure?.case).toBe(QuantityFailureCases.NonFinite)
    Expect(later).toBe(false)
    Expect(Duration.read(cell)).toEqual({ canonical: 120, unit: 'Minutes' })
  })

  Test('converts new seconds explicitly while retaining legacy native Interval nanosecond behavior', () => {
    // Adapter-owned conversion, not a Duration registry or an implicit runtime reinterpretation.
    const toLegacy = (value: DurationValue): number => {
      const nanoseconds = Duration.read(value).canonical * 1e9
      if (!Number.isFinite(nanoseconds)) {
        throw new TaoActionFailure(QuantityFailureCases.NonFinite, 'The legacy duration conversion must be finite.')
      }
      return nanoseconds
    }
    const fromLegacy = (nanoseconds: number) => Duration.fromJSValue(nanoseconds / 1e9)
    const converted = toLegacy(Duration.fromUnit(2000, 'Milliseconds'))
    Expect(converted).toBe(2e9)
    Expect(Duration.read(fromLegacy(converted))).toEqual({ canonical: 2, unit: 'Seconds' })
    expectFailure(() => toLegacy(Duration.fromJSValue(Number.MAX_VALUE)), QuantityFailureCases.NonFinite)
    TR.Clock.beginTest(1000)
    try {
      let legacyTicks = 0
      let convertedTicks = 0
      const legacy = Interval(TR.Units.Build(TR.Value(2), 1e9).jsValue)
      const adapted = Interval(converted)
      const stopLegacy = legacy.subscribe(() => {
        legacyTicks += 1
      })
      const stopConverted = adapted.subscribe(() => {
        convertedTicks += 1
      })
      try {
        TR.Clock.advance(1999)
        Expect([legacyTicks, convertedTicks]).toEqual([0, 0])
        TR.Clock.advance(1)
        Expect([legacyTicks, convertedTicks]).toEqual([1, 1])
        Expect(adapted.Value).toBe(3000)
      } finally {
        stopLegacy()
        stopConverted()
      }
    } finally {
      TR.Clock.endTest()
    }
  })
})
