import TR from '@runtime/TR'
import { Assert, FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import * as ts from 'typescript'
import { Interval } from '../../stdlib/@tao/time/Time'
import { runAction, type TaoActionReceipt } from '../TaoRuntime-src/TR-action-transactions'
import { runEffectOutcome } from '../TaoRuntime-src/TR-effect-outcomes'
import { TaoActionFailure, UserInputError } from '../TaoRuntime-src/TR-errors'
import {
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
    Expect(TR.isQuantityPayload(nested.jsValue.Amount)).toBe(true)
  })

  Test('serializes extracted canonical data and restores the declared default when decoding', () => {
    const value = Duration.inUnit(Duration.fromUnit(2, 'Minutes'), 'Milliseconds')
    const serialized = JSON.stringify(quantityPayloadJSValue(value.jsValue))
    Expect(serialized).toBe('120')
    Expect(Duration.read(Duration.fromJSValue(JSON.parse(serialized)))).toEqual({ canonical: 120, unit: 'Seconds' })
    Expect(quantityPayloadJSValue(TR.Value(120).jsValue)).toBeUndefined()
    Expect(quantityPayloadJSValue(undefined)).toBeUndefined()
  })

  Test('exposes canonical native numbers through value copies, readonly views, aliases and cells', () => {
    for (const canonical of [120, 0, -0]) {
      const value = Duration.inUnit(Duration.fromJSValue(canonical), 'Minutes')
      const copied = TR.Copy(value)
      const readonly = TR.Readonly<typeof value.jsValue>(copied)
      const cell = TR.Cell(value)
      const alias = TR.Alias(() => cell.evaluate())
      // This assignment also proves the public conditional native output type is number.
      const native: number = readonly.getJSValue()
      Expect(Object.is(native, canonical)).toBe(true)
      Expect(Object.is(value.getJSValue(), canonical)).toBe(true)
      Expect(Object.is(copied.getJSValue(), canonical)).toBe(true)
      Expect(Object.is(cell.getJSValue(), canonical)).toBe(true)
      Expect(Object.is(alias.getJSValue(), canonical)).toBe(true)
      Expect(TR.isQuantityPayload(readonly.jsValue)).toBe(true)
      Expect(readonly.jsValue).toBe(value.jsValue)
      Expect(Duration.read(readonly).unit).toBe('Minutes')
      cell.set(Duration.fromUnit(3, 'Hours'))
      Expect(alias.getJSValue()).toBe(10800)
      Expect(Duration.read(alias).unit).toBe('Hours')
    }
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
    expectFailure(
      () => Duration.inUnit(Ratio.fromJSValue(1) as TR.Value<unknown>, 'Seconds'),
      QuantityFailureCases.DomainMismatch,
    )
    expectFailure(() => addDuration(Duration.fromJSValue(1), Ratio.fromJSValue(1)), QuantityFailureCases.DomainMismatch)
    Expect(Duration.read(Duration.fromJSValue(1))).toEqual({ canonical: 1, unit: 'Seconds' })
  })

  Test('rejects foreign shapes and forged prototypes before extracting private storage', () => {
    for (const input of ['120', null, {}, true, new Number(120)]) {
      expectFailure(() => Duration.fromJSValue(input), QuantityFailureCases.BadShape)
    }
    const forged = Object.create(Object.getPrototypeOf(Duration.fromJSValue(1).jsValue))
    Expect(TR.isQuantityPayload(forged)).toBe(false)
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

Describe('authenticated quantity parents', () => {
  Test('admits descendants transitively while exact ownership and reverse admission stay nominal', () => {
    const child = Duration.derive({ domain: 'ChildDuration' })
    const grandchild = child.derive({ domain: 'GrandchildDuration' })
    const sibling = Duration.derive({ domain: 'SiblingDuration' })
    const unrelated = makeQuantityType({ ...durationDefinition, domain: 'ChildDuration' }, TR.Value)
    const parentValue = Duration.fromJSValue(120)
    const childValue = child.fromUnit(2, 'Minutes')
    const grandchildValue = grandchild.fromUnit(2, 'Minutes')
    Expect(Duration.read(childValue)).toEqual({ canonical: 120, unit: 'Minutes' })
    Expect(Duration.read(grandchildValue)).toEqual({ canonical: 120, unit: 'Minutes' })
    Expect(child.read(grandchildValue)).toEqual({ canonical: 120, unit: 'Minutes' })
    for (
      const [factory, exact, accepted] of [
        [Duration, [true, false, false], [true, true, true]],
        [child, [false, true, false], [false, true, true]],
        [grandchild, [false, false, true], [false, false, true]],
      ] as const
    ) {
      const payloads = [parentValue.jsValue, childValue.jsValue, grandchildValue.jsValue]
      Expect(payloads.map(payload => factory.ownsPayload(payload))).toEqual(exact)
      Expect(payloads.map(payload => factory.acceptsPayload(payload))).toEqual(accepted)
      for (const forged of [null, {}, { ...childValue.jsValue }, Object.create(childValue.jsValue)]) {
        Expect(factory.acceptsPayload(forged)).toBe(false)
        Expect(factory.ownsPayload(forged)).toBe(false)
      }
    }
    expectFailure(() => child.read(parentValue), QuantityFailureCases.DomainMismatch)
    expectFailure(() => grandchild.read(childValue), QuantityFailureCases.DomainMismatch)
    expectFailure(() => child.read(sibling.fromJSValue(120)), QuantityFailureCases.DomainMismatch)
    expectFailure(() => child.read(unrelated.fromJSValue(120)), QuantityFailureCases.DomainMismatch)
    Expect(Duration.acceptsPayload(unrelated.fromJSValue(120).jsValue)).toBe(false)
    Expect(sibling.acceptsPayload(childValue.jsValue)).toBe(false)
  })

  Test('uses an explicit upward union adapter with one evaluation, payload getter and admitted read', () => {
    const child = Duration.derive({ domain: 'UnionChild' })
    const grandchild = child.derive({ domain: 'UnionGrandchild' })
    const value = grandchild.fromUnit(2, 'Minutes')
    let evaluations = 0
    let getters = 0
    let reads = 0
    const native = {
      evaluate() {
        evaluations += 1
        return {
          get jsValue() {
            getters += 1
            return value.jsValue
          },
        }
      },
    }
    const adapter = {
      ownsPayload: Duration.acceptsPayload,
      read(input: Parameters<typeof Duration.read>[0]) {
        reads += 1
        Expect(Duration.read(input)).toEqual({ canonical: 120, unit: 'Minutes' })
      },
    }
    Expect(TR.admitQuantityUnion(native, [adapter], 'Duration')).toBeUndefined()
    Expect([evaluations, getters, reads]).toEqual([1, 1, 1])
    expectFailure(() => TR.admitQuantityUnion(value, [Duration], 'Duration'), QuantityFailureCases.DomainMismatch)
    expectFailure(
      () =>
        TR.admitQuantityUnion(
          Duration.fromJSValue(120),
          [{ ownsPayload: child.acceptsPayload, read: child.read }],
          'UnionChild',
        ),
      QuantityFailureCases.DomainMismatch,
    )
    const sibling = Duration.derive({ domain: 'UnionSibling' })
    expectFailure(
      () =>
        TR.admitQuantityUnion(
          sibling.fromJSValue(120),
          [{ ownsPayload: child.acceptsPayload, read: child.read }],
          'UnionChild',
        ),
      QuantityFailureCases.DomainMismatch,
    )
    const unrelated = makeQuantityType(durationDefinition, TR.Value)
    expectFailure(
      () => TR.admitQuantityUnion(unrelated.fromJSValue(120), [adapter], 'Duration'),
      QuantityFailureCases.DomainMismatch,
    )
    Expect(reads).toBe(1)
  })

  Test('ancestor-selected views retain the concrete child, signed backing and admission without rechecking', () => {
    const checks: string[] = []
    const parent = makeQuantityType({
      domain: 'SignedParent',
      defaultUnit: 'Base',
      units: { Base: 1, Double: 2, Tiny: Number.MIN_VALUE },
      invariant: () => {
        checks.push('parent')
        return true
      },
    }, TR.Value)
    const child = parent.derive({
      domain: 'SignedChild',
      invariant: () => {
        checks.push('child')
        return true
      },
    })
    const grandchild = child.derive({
      domain: 'SignedGrandchild',
      invariant: () => {
        checks.push('grandchild')
        return true
      },
    })
    for (const input of [-4, -0]) {
      checks.length = 0
      const original = grandchild.fromUnit(input, 'Double')
      const viewed = parent.inUnit(child.inUnit(original, 'Base'), 'Tiny')
      Expect(checks).toEqual(['parent', 'child', 'grandchild'])
      Expect(Object.is(viewed.getJSValue(), input === 0 ? -0 : -8)).toBe(true)
      Expect(grandchild.read(viewed).unit).toBe('Tiny')
      Expect(parent.read(viewed).unit).toBe('Tiny')
      Expect(viewed.jsValue.domain).toBe('SignedGrandchild')
      Expect(grandchild.ownsPayload(viewed.jsValue)).toBe(true)
      Expect(child.ownsPayload(viewed.jsValue)).toBe(false)
      Expect(parent.ownsPayload(viewed.jsValue)).toBe(false)
      Expect(parent.acceptsPayload(viewed.jsValue)).toBe(true)
      TR.admitQuantityUnion(viewed, [grandchild], 'SignedGrandchild')
      Expect(checks).toEqual(['parent', 'child', 'grandchild'])
      Expect(original.jsValue.unit).toBe('Double')
      Expect(viewed.jsValue).not.toBe(original.jsValue)
    }
  })

  Test('checks finite normalized backing and inherited invariants once in ancestor order', () => {
    const checks: string[] = []
    const parent = makeQuantityType({
      domain: 'Nonnegative',
      defaultUnit: 'Base',
      units: { Base: 1, Double: 2 },
      invariant: canonical => {
        checks.push(`parent:${canonical}`)
        return canonical >= 0
      },
    }, TR.Value)
    const child = parent.derive({
      domain: 'Bounded',
      invariant: canonical => {
        checks.push(`child:${canonical}`)
        return canonical <= 10
      },
    })
    const grandchild = child.derive({
      domain: 'Integral',
      invariant: canonical => {
        checks.push(`grandchild:${canonical}`)
        return Number.isInteger(canonical)
      },
    })
    const value = grandchild.fromUnit(4, 'Double')
    Expect(checks).toEqual(['parent:8', 'child:8', 'grandchild:8'])
    Expect(grandchild.read(parent.inUnit(value, 'Base'))).toEqual({ canonical: 8, unit: 'Base' })
    Expect(checks).toEqual(['parent:8', 'child:8', 'grandchild:8'])
    const failures = [
      [-1, ['parent:-1']],
      [11, ['parent:11', 'child:11']],
      [1.5, ['parent:1.5', 'child:1.5', 'grandchild:1.5']],
    ] as const
    for (const [canonical, expected] of failures) {
      checks.length = 0
      expectFailure(() => grandchild.fromJSValue(canonical), QuantityFailureCases.Invariant)
      Expect(checks).toEqual(expected)
    }
    checks.length = 0
    for (const canonical of [NaN, Infinity, -Infinity]) {
      expectFailure(() => grandchild.fromJSValue(canonical), QuantityFailureCases.NonFinite)
    }
    expectFailure(() => grandchild.fromUnit(Number.MAX_VALUE, 'Double'), QuantityFailureCases.NonFinite)
    Expect(checks).toEqual([])
  })

  Test('inherits the exact frozen unit table and snapshots child defaults and invariants', () => {
    const source = {
      domain: 'MetadataParent',
      defaultUnit: 'Base' as 'Base' | 'Double',
      units: { Base: 1, Double: 2 },
      invariant: (canonical: number) => canonical >= 0,
    }
    const parent = makeQuantityType(source, TR.Value)
    const childDefinition = {
      domain: 'MetadataChild',
      defaultUnit: 'Double' as 'Base' | 'Double',
      invariant: (canonical: number) => canonical <= 10,
    }
    const child = parent.derive(childDefinition)
    const grandchild = child.derive({ domain: 'MetadataGrandchild' })
    source.domain = 'ChangedParent'
    source.units.Double = 200
    source.defaultUnit = 'Double'
    source.invariant = () => true
    childDefinition.domain = 'ChangedChild'
    childDefinition.defaultUnit = 'Base'
    childDefinition.invariant = () => true
    Expect(child.definition.units).toBe(parent.definition.units)
    Expect(grandchild.definition.units).toBe(parent.definition.units)
    Expect(parent.read(parent.fromJSValue(2)).unit).toBe('Base')
    Expect(child.read(child.fromJSValue(2)).unit).toBe('Double')
    Expect(grandchild.read(grandchild.fromJSValue(2)).unit).toBe('Double')
    Expect(grandchild.read(grandchild.fromUnit(4, 'Double'))).toEqual({ canonical: 8, unit: 'Double' })
    Expect(child.fromJSValue(2).jsValue.domain).toBe('MetadataChild')
    expectFailure(() => grandchild.fromJSValue(-1), QuantityFailureCases.Invariant)
    expectFailure(() => grandchild.fromJSValue(11), QuantityFailureCases.Invariant)
    for (const factory of [child, grandchild]) {
      Expect(Object.isFrozen(factory)).toBe(true)
      Expect(Object.isFrozen(factory.definition)).toBe(true)
      Expect(Object.isFrozen(factory.definition.units)).toBe(true)
      Expect(Reflect.set(factory.definition.units, 'Double', 200)).toBe(false)
      Expect(Reflect.set(factory.definition.units, 'Other', 3)).toBe(false)
      Expect(Reflect.set(factory.definition, 'units', { Base: 100 })).toBe(false)
      expectFailure(() => factory.fromUnit(1, 'Other' as never), QuantityFailureCases.UnknownUnit)
    }
  })

  Test('preserves actual unit keys exactly and rejects unsupported or coerced child defaults', () => {
    const parent = makeQuantityType({
      domain: 'ExactKeys',
      defaultUnit: 'Base',
      units: { Base: 1, MiX: 2, mix: 3, ['__proto__']: 4, toString: 5 },
    }, TR.Value)
    const child = parent.derive({ domain: 'KeyChild', defaultUnit: 'MiX' })
    Expect(child.read(child.fromJSValue(7))).toEqual({ canonical: 7, unit: 'MiX' })
    Expect(child.read(child.fromUnit(2, 'MiX'))).toEqual({ canonical: 4, unit: 'MiX' })
    Expect(child.read(child.fromUnit(2, 'mix'))).toEqual({ canonical: 6, unit: 'mix' })
    Expect(child.read(child.fromUnit(2, '__proto__'))).toEqual({ canonical: 8, unit: '__proto__' })
    Expect(child.read(child.fromUnit(2, 'toString'))).toEqual({ canonical: 10, unit: 'toString' })
    for (const unit of ['MIX', 'base', 'Other', 'constructor', new String('MiX')]) {
      Expect(() => parent.derive({ domain: 'InvalidDefault', defaultUnit: unit } as never)).toThrow(UserInputError)
      expectFailure(() => child.fromUnit(1, unit as never), QuantityFailureCases.UnknownUnit)
      expectFailure(() => parent.inUnit(child.fromJSValue(1), unit as never), QuantityFailureCases.UnknownUnit)
    }
    Expect(() => parent.derive({ domain: new String('Bad') } as never)).toThrow(UserInputError)
    Expect(() => parent.derive({ domain: 'BadInvariant', invariant: true } as never)).toThrow(UserInputError)
    Expect(() => parent.derive({ domain: 'NullDefault', defaultUnit: null } as never)).toThrow(UserInputError)
    Expect(() => parent.derive({ domain: 'ExtraUnit', units: { Other: 1 } } as never)).toThrow(UserInputError)
    Expect(() => parent.derive({ domain: 'OverrideUnit', units: { Base: 100 } } as never)).toThrow(UserInputError)
    Expect(() => parent.derive({ domain: 'ForgedParent', parent: child } as never)).toThrow(UserInputError)
  })

  Test('authenticates derive against its captured receiver rather than matching metadata or prototypes', () => {
    const child = Duration.derive({ domain: 'ReceiverChild' })
    const sameName = makeQuantityType(durationDefinition, TR.Value)
    for (const receiver of [null, undefined, {}, { ...Duration }, Object.create(Duration), sameName, child]) {
      Expect(() => Reflect.apply(Duration.derive, receiver, [{ domain: 'ForgedChild' }])).toThrow(UserInputError)
    }
    const detached = Duration.derive
    Expect(() => detached({ domain: 'DetachedChild' })).toThrow(UserInputError)
    Expect(() => Reflect.apply(child.derive, Duration, [{ domain: 'BorrowedChild' }])).toThrow(UserInputError)
    const authentic = Reflect.apply(Duration.derive, Duration, [{ domain: 'AuthenticChild' }])
    Expect(Duration.read(authentic.fromJSValue(2))).toEqual({ canonical: 2, unit: 'Seconds' })
  })

  Test('keeps lineage immutable through metadata and cycle attempts without trusting copied descriptors', () => {
    const child = Duration.derive({ domain: 'ImmutableChild' })
    const grandchild = child.derive({ domain: 'ImmutableGrandchild' })
    for (const factory of [Duration, child, grandchild]) {
      Expect(Reflect.set(factory, 'parent', grandchild)).toBe(false)
      Expect(Reflect.set(factory.definition, 'parent', grandchild)).toBe(false)
      Expect(Reflect.setPrototypeOf(factory, grandchild)).toBe(false)
    }
    const copied = makeQuantityType(child.definition, TR.Value)
    const value = grandchild.fromJSValue(2)
    Expect(Duration.acceptsPayload(value.jsValue)).toBe(true)
    Expect(child.acceptsPayload(value.jsValue)).toBe(true)
    Expect(grandchild.ownsPayload(value.jsValue)).toBe(true)
    Expect(copied.acceptsPayload(value.jsValue)).toBe(false)
    expectFailure(() => Duration.read(copied.fromJSValue(2)), QuantityFailureCases.DomainMismatch)
    expectFailure(() => copied.read(value), QuantityFailureCases.DomainMismatch)
  })

  Test('retains child admission through real aliases, cells, readonly views, copies and arguments', () => {
    const child = Duration.derive({ domain: 'StoredChild' })
    const grandchild = child.derive({ domain: 'StoredGrandchild' })
    const original = grandchild.fromUnit(2, 'Minutes')
    const cell = TR.Cell(original)
    cell.set(Duration.inUnit(original, 'Milliseconds'))
    const alias = TR.Alias(() => cell.evaluate())
    const copy = TR.Copy(alias)
    const readonly = TR.Readonly<typeof copy.jsValue>(copy)
    const throughArgument = (value: TR.Value<unknown>) => value.evaluate()
    for (const value of [cell, alias, copy, readonly, throughArgument(copy)]) {
      Expect(Duration.read(value)).toEqual({ canonical: 120, unit: 'Milliseconds' })
      Expect(child.read(value)).toEqual({ canonical: 120, unit: 'Milliseconds' })
      // A live alias carries the current payload on its evaluated value.
      Expect(grandchild.ownsPayload(value.evaluate().jsValue)).toBe(true)
      Expect(value.getJSValue()).toBe(120)
      TR.admitQuantityUnion(value, [{ ownsPayload: Duration.acceptsPayload, read: Duration.read }], 'Duration')
    }
    Expect(copy.jsValue).toBe(cell.evaluate().jsValue)
    const nested = TR.Copy(TR.Value({ Amount: readonly.jsValue }))
    Expect(grandchild.read(TR.Value(nested.jsValue.Amount))).toEqual({ canonical: 120, unit: 'Milliseconds' })
    cell.set(grandchild.fromJSValue(-0))
    Expect(Object.is(alias.getJSValue(), -0)).toBe(true)
    Expect(Duration.read(alias).unit).toBe('Seconds')
  })

  Test(
    'proves upward covariance, retained child proofs and canonical number output with real TypeScript diagnostics',
    () => {
      // Virtual files stay under the runtime package for normal dependency resolution, without
      // writing compile-only fixtures to a test glob or creating an external temporary directory.
      const scratch = FS.resolvePath('packages/apps/runtime/.scratch', Repo.getRoot())
      const prelude = `
import { makeQuantityType, type TaoQuantityPayload, type TaoQuantityValue } from '../TaoRuntime-src/TR-quantity-values'
import type { TaoRuntimeValue } from '../TaoRuntime-src/TR-reactive-values'
import type { TaoEvaluable } from '../TaoRuntime-src/TR-action-values'
declare const wrap: <T>(payload: T) => TaoRuntimeValue<T>
declare const ParentSymbol: unique symbol
declare const ChildSymbol: unique symbol
declare const GrandchildSymbol: unique symbol
declare const SiblingSymbol: unique symbol
declare const UnrelatedSymbol: unique symbol
type ParentProof = { readonly [ParentSymbol]: true }
type ChildProof = { readonly [ChildSymbol]: true }
type GrandchildProof = { readonly [GrandchildSymbol]: true }
type SiblingProof = { readonly [SiblingSymbol]: true }
type UnrelatedProof = { readonly [UnrelatedSymbol]: true }
const units = { Base: 1, Double: 2 } as const
type Unit = keyof typeof units
const Parent = makeQuantityType<'SameLabel', typeof units, ParentProof>({ domain: 'SameLabel', defaultUnit: 'Base', units }, wrap)
const Child = Parent.derive<'SameLabel', ChildProof>({ domain: 'SameLabel' })
const Grandchild = Child.derive<'SameLabel', GrandchildProof>({ domain: 'SameLabel' })
const Sibling = Parent.derive<'SameLabel', SiblingProof>({ domain: 'SameLabel' })
const Unrelated = makeQuantityType<'SameLabel', typeof units, UnrelatedProof>({ domain: 'SameLabel', defaultUnit: 'Base', units }, wrap)
type ParentValue = TaoQuantityValue<'SameLabel', Unit, ParentProof>
type ChildValue = TaoQuantityValue<'SameLabel', Unit, ParentProof & ChildProof>
type GrandchildValue = TaoQuantityValue<'SameLabel', Unit, ParentProof & ChildProof & GrandchildProof>
const parentValue = Parent.fromJSValue(1)
const childValue = Child.fromJSValue(1)
const grandchildValue = Grandchild.fromJSValue(1)
const siblingValue = Sibling.fromJSValue(1)
const unrelatedValue = Unrelated.fromJSValue(1)
`
      const fixtures = [
        {
          name: 'positive',
          body: `
const upward: ParentValue = childValue
const transitiveUpward: ParentValue = grandchildValue
const immediateUpward: ChildValue = grandchildValue
const parentPayload: TaoQuantityPayload<'SameLabel', Unit, ParentProof> = childValue.jsValue
const childView: ChildValue = Parent.inUnit(childValue, 'Double')
const grandchildView: GrandchildValue = Parent.inUnit(Child.inUnit(grandchildValue, 'Base'), 'Double')
const canonical: number = childValue.getJSValue()
const viewCanonical: number = childView.getJSValue()
const grandchildCanonical: number = grandchildView.getJSValue()
const erased: TaoEvaluable<unknown> = unrelatedValue
const checkedErasedInput: ParentValue = Parent.inUnit(erased, 'Base')
const LegacyParent = makeQuantityType({ domain: 'LegacyParent', defaultUnit: 'Base', units }, wrap)
const LegacyChild = LegacyParent.derive({ domain: 'LegacyChild' })
const legacyUpward: TaoQuantityValue<'LegacyParent', Unit> = LegacyChild.fromJSValue(1)
const legacyCanonical: number = LegacyChild.fromJSValue(1).getJSValue()
`,
        },
        { name: 'reverse', body: 'const reverse: ChildValue = parentValue', code: 2322, proof: 'ChildSymbol' },
        { name: 'sibling', body: 'const sibling: ChildValue = siblingValue', code: 2322, proof: 'ChildSymbol' },
        { name: 'unrelated', body: 'const unrelated: ParentValue = unrelatedValue', code: 2322, proof: 'ParentSymbol' },
        { name: 'sibling-view', body: "Child.inUnit(siblingValue, 'Base')", code: 2769, proof: 'ChildSymbol' },
        { name: 'reverse-view', body: "Child.inUnit(parentValue, 'Base')", code: 2769, proof: 'ChildSymbol' },
        { name: 'unrelated-view', body: "Parent.inUnit(unrelatedValue, 'Base')", code: 2769, proof: 'ParentSymbol' },
      ]
      const sources = new Map(fixtures.map(fixture => [
        FS.resolvePath(`quantity-parent-${fixture.name}.ts`, scratch),
        `${prelude}\n${fixture.body}\n`,
      ]))
      const configPath = FS.resolvePath('packages/apps/runtime/tsconfig.json', Repo.getRoot())
      const config = ts.readConfigFile(configPath, ts.sys.readFile)
      Expect(config.error).toBeUndefined()
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, FS.dirname(configPath))
      Expect(parsed.errors).toEqual([])
      const options: ts.CompilerOptions = {
        ...parsed.options,
        noUnusedLocals: false,
        noUnusedParameters: false,
        noEmit: true,
      }
      const host = ts.createCompilerHost(options)
      const originalGetSourceFile = host.getSourceFile.bind(host)
      host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
        const source = sources.get(path)
        return source === undefined
          ? originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
          : ts.createSourceFile(path, source, languageVersion, true)
      }
      const program = ts.createProgram([...sources.keys()], options, host)
      const diagnostics = ts.getPreEmitDiagnostics(program)
      // A missing-import or unrelated compiler failure cannot stand in for a rejected assignment.
      const failures = diagnostics.map(diagnostic => {
        Assert.defined(diagnostic.file, 'quantity type diagnostic names its isolated fixture')
        Assert.defined(diagnostic.start, 'quantity type diagnostic has a source position')
        const fixture = fixtures.find(item =>
          diagnostic.file?.fileName === FS.resolvePath(`quantity-parent-${item.name}.ts`, scratch)
        )
        Assert.defined(fixture, 'quantity type diagnostic belongs to an isolated fixture')
        const line = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
        const sourceLine = diagnostic.file.text.split('\n')[line]
        Expect(sourceLine).toBe(fixture.body)
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        Assert.defined(fixture.proof, 'a negative quantity fixture names the missing nominal proof')
        Expect(message).toContain(fixture.proof)
        if (fixture.code === 2769) {
          Expect(message).toContain('No overload matches this call.')
        }
        return { fixture: fixture.name, code: diagnostic.code }
      })
      Expect(failures.sort((left, right) => left.fixture.localeCompare(right.fixture))).toEqual(
        fixtures.filter(fixture => fixture.code !== undefined).map(fixture => ({
          fixture: fixture.name,
          code: fixture.code,
        })).sort((left, right) => left.fixture.localeCompare(right.fixture)),
      )
    },
  )
})
