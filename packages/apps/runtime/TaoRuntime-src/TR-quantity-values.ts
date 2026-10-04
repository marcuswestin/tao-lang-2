import type { TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { TaoActionFailure } from './TR-errors'
import type { TaoRuntimeValue } from './TR-reactive-values'

/** QuantityFailureCases belong only to checked quantity construction/admission, not all effects. */
export const QuantityFailureCases = Object.freeze(
  {
    BadShape: 'QuantityBadShape',
    NonFinite: 'QuantityNonFinite',
    Invariant: 'QuantityInvariant',
    DomainMismatch: 'QuantityDomainMismatch',
    UnknownUnit: 'QuantityUnknownUnit',
  } as const,
)

type QuantityFailureCase = typeof QuantityFailureCases[keyof typeof QuantityFailureCases]
type UnitNames<Units> = Extract<keyof Units, string>
type QuantityWrapper = <ValueT>(payload: ValueT) => TaoRuntimeValue<ValueT>

/** TaoQuantityDefinition is declaration-owned metadata. Publish one factory per nominal domain. */
export type TaoQuantityDefinition<Domain extends string, Units extends Readonly<Record<string, number>>> = Readonly<{
  domain: Domain
  units: Units
  defaultUnit: NoInfer<UnitNames<Units>>
  /** Declared invariants must be pure and stable; freezing metadata cannot freeze closure state. */
  invariant?: (canonical: number) => boolean
}>

/** TaoQuantityPayload is opaque finite canonical storage with a separately retained unit view. */
export type TaoQuantityPayload<Domain extends string, Unit extends string> = QuantityPayload<Domain, Unit>

/** TaoQuantityValue uses the existing runtime wrapper; jsValue is opaque, not a raw magnitude. */
export type TaoQuantityValue<Domain extends string, Unit extends string> = TaoRuntimeValue<
  TaoQuantityPayload<Domain, Unit>
>

/** TaoQuantityFactory checks native backing and preserves the declaration's nominal identity. */
export type TaoQuantityFactory<Domain extends string, Units extends Readonly<Record<string, number>>> = Readonly<{
  definition: TaoQuantityDefinition<Domain, Readonly<Units>>
  fromJSValue(canonical: unknown): TaoQuantityValue<Domain, UnitNames<Units>>
  fromUnit(input: unknown, unit: UnitNames<Units>): TaoQuantityValue<Domain, UnitNames<Units>>
  inUnit(value: TaoEvaluable<unknown>, unit: UnitNames<Units>): TaoQuantityValue<Domain, UnitNames<Units>>
  read(value: TaoEvaluable<unknown>): Readonly<{ canonical: number; unit: UnitNames<Units> }>
}>

const constructionKey = Object.freeze({})

class QuantityPayload<Domain extends string, Unit extends string> {
  readonly #identity: object
  readonly #domain: Domain
  readonly #canonical: number
  readonly #unit: Unit

  constructor(key: object, identity: object, domain: Domain, canonical: number, unit: Unit) {
    RuntimeAssert(key === constructionKey, 'quantity payloads are constructed by their checked factory')
    this.#identity = identity
    this.#domain = domain
    this.#canonical = canonical
    this.#unit = unit
    Object.freeze(this)
  }

  get canonical(): number {
    return this.#canonical
  }
  get domain(): Domain {
    return this.#domain
  }
  get unit(): Unit {
    return this.#unit
  }

  belongsTo(identity: object): boolean {
    return this.#identity === identity
  }

  static is(input: unknown): input is QuantityPayload<string, string> {
    return typeof input === 'object' && input !== null && #canonical in input
  }
}

// Instances expose this prototype to trusted native code. Keep getters, admission and branding
// immutable too, so changing them cannot bypass the backing and domain checks.
Object.freeze(QuantityPayload.prototype)
Object.freeze(QuantityPayload)

/** isQuantityPayload recognizes real immutable backing, including after ordinary runtime copies. */
export function isQuantityPayload(input: unknown): input is TaoQuantityPayload<string, string> {
  return QuantityPayload.is(input)
}

/** quantityPayloadJSValue is the leaf seam a uniform accessor can call on evaluated jsValue data. */
export function quantityPayloadJSValue(input: unknown): number | undefined {
  return QuantityPayload.is(input) ? input.canonical : undefined
}

/**
 * makeQuantityType snapshots declaration metadata and supplies checked construction, not operators.
 * Inject the existing runtime wrapper so its later accessor may import this leaf without a cycle.
 * Re-export the one owner-created factory: identical diagnostic names do not merge nominal domains.
 */
export function makeQuantityType<
  const Domain extends string,
  const Units extends Readonly<Record<string, number>>,
>(
  definition: TaoQuantityDefinition<Domain, Units>,
  wrap: QuantityWrapper,
): TaoQuantityFactory<Domain, Units> {
  type Unit = UnitNames<Units>
  const units = Object.freeze({ ...definition.units }) as Readonly<Units>
  const metadata: TaoQuantityDefinition<Domain, Readonly<Units>> = Object.freeze({
    domain: definition.domain,
    units,
    defaultUnit: definition.defaultUnit,
    invariant: definition.invariant,
  })
  RuntimeAssert.input(typeof metadata.domain === 'string', 'A quantity needs a string domain name.')
  RuntimeAssert.input(
    typeof metadata.defaultUnit === 'string' && Object.hasOwn(units, metadata.defaultUnit),
    'A quantity needs a declared default unit.',
  )
  RuntimeAssert.input(
    metadata.invariant === undefined || typeof metadata.invariant === 'function',
    'A quantity invariant must be a function.',
  )
  for (const scale of Object.values(units)) {
    RuntimeAssert.input(
      typeof scale === 'number' && Number.isFinite(scale) && scale > 0,
      'Quantity unit scales must be finite, positive numbers.',
    )
  }
  const identity = Object.freeze({})
  const fail = (caseName: QuantityFailureCase, sentence: string): never => {
    throw new TaoActionFailure(caseName, sentence)
  }
  const finite = (input: unknown): number => {
    if (typeof input !== 'number') {
      return fail(QuantityFailureCases.BadShape, `A '${metadata.domain}' value needs numeric backing.`)
    }
    if (!Number.isFinite(input)) {
      return fail(QuantityFailureCases.NonFinite, `A '${metadata.domain}' value needs finite backing.`)
    }
    return input
  }
  const checkUnit = (unit: Unit): void => {
    if (typeof unit !== 'string' || !Object.hasOwn(units, unit)) {
      fail(QuantityFailureCases.UnknownUnit, `The unit must belong to '${metadata.domain}'.`)
    }
  }
  const checkedCanonical = (input: unknown): number => {
    const canonical = finite(input)
    if (metadata.invariant && !metadata.invariant(canonical)) {
      fail(QuantityFailureCases.Invariant, `The '${metadata.domain}' value does not satisfy its declared invariant.`)
    }
    return canonical
  }
  const fromCanonical = (canonical: number, unit: Unit): TaoQuantityValue<Domain, Unit> =>
    wrap(new QuantityPayload(constructionKey, identity, metadata.domain, canonical, unit))
  const readPayload = (value: TaoEvaluable<unknown>): QuantityPayload<Domain, Unit> => {
    const payload = value.evaluate().jsValue
    if (!QuantityPayload.is(payload)) {
      return fail(QuantityFailureCases.BadShape, `A checked '${metadata.domain}' quantity value is required.`)
    }
    if (!payload.belongsTo(identity)) {
      return fail(QuantityFailureCases.DomainMismatch, `The quantity must have the '${metadata.domain}' domain.`)
    }
    return payload as QuantityPayload<Domain, Unit>
  }
  return Object.freeze({
    definition: metadata,
    fromJSValue: (input: unknown) => fromCanonical(checkedCanonical(input), metadata.defaultUnit),
    fromUnit(input: unknown, unit: Unit) {
      checkUnit(unit)
      return fromCanonical(checkedCanonical(finite(input) * units[unit]), unit)
    },
    inUnit(value: TaoEvaluable<unknown>, unit: Unit) {
      const payload = readPayload(value)
      checkUnit(unit)
      // Trusted immutable canonical backing already passed its invariant. Only the view changes.
      return fromCanonical(payload.canonical, unit)
    },
    read(value: TaoRuntimeValue<unknown>) {
      const payload = readPayload(value)
      return Object.freeze({ canonical: payload.canonical, unit: payload.unit })
    },
  })
}
