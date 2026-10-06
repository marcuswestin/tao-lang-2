import { Arrays } from './core/RuntimeCore'
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
type LegacyRole<Domain extends string> = string extends Domain ? object : Readonly<Record<Domain, true>>
declare const quantityRoleProof: unique symbol

type DerivedDefinition<Domain extends string, Unit extends string> = Readonly<{
  domain: Domain
  defaultUnit?: Unit
  invariant?: (canonical: number) => boolean
}>

type QuantityOwner = Readonly<{
  domain: string
  parent?: QuantityOwner
  invariant?: (canonical: number) => boolean
}>

const quantityFactoriesByOwner = new WeakMap<
  QuantityOwner,
  TaoQuantityFactory<string, Readonly<Record<string, number>>, object>
>()

/** TaoQuantityDefinition is declaration-owned metadata. Publish one factory per nominal domain. */
export type TaoQuantityDefinition<Domain extends string, Units extends Readonly<Record<string, number>>> = Readonly<{
  domain: Domain
  units: Units
  defaultUnit: NoInfer<UnitNames<Units>>
  /** Declared invariants must be pure and stable; freezing metadata cannot freeze closure state. */
  invariant?: (canonical: number) => boolean
}>

/** TaoQuantityPayload is opaque finite canonical storage with a separately retained unit view. */
export type TaoQuantityPayload<
  Domain extends string,
  Unit extends string,
  RoleProof extends object = LegacyRole<Domain>,
> = QuantityPayload<Unit> & { readonly [quantityRoleProof]: RoleProof }

/** TaoQuantityValue uses the existing runtime wrapper; jsValue is opaque, not a raw magnitude. */
export type TaoQuantityValue<
  Domain extends string,
  Unit extends string,
  RoleProof extends object = LegacyRole<Domain>,
> = TaoRuntimeValue<
  TaoQuantityPayload<Domain, Unit, RoleProof>
>

/** TaoQuantityView changes only the selected unit while retaining every concrete role proof. */
type TaoQuantityView<Payload, Unit extends string> = Omit<Payload, 'unit'> & QuantityPayload<Unit>

/** TaoQuantityFactory checks native backing and preserves the declaration's nominal identity. */
export type TaoQuantityFactory<
  Domain extends string,
  Units extends Readonly<Record<string, number>>,
  RoleProof extends object = LegacyRole<Domain>,
> = Readonly<{
  definition: TaoQuantityDefinition<Domain, Readonly<Units>>
  fromJSValue(canonical: unknown): TaoQuantityValue<Domain, UnitNames<Units>, RoleProof>
  fromUnit(input: unknown, unit: UnitNames<Units>): TaoQuantityValue<Domain, UnitNames<Units>, RoleProof>
  inUnit<Payload extends TaoQuantityPayload<string, string, RoleProof>>(
    value: TaoEvaluable<Payload>,
    unit: UnitNames<Units>,
  ): TaoRuntimeValue<TaoQuantityView<Payload, UnitNames<Units>>>
  inUnit<Payload>(
    value: TaoEvaluable<Payload> & (unknown extends Payload ? unknown : never),
    unit: UnitNames<Units>,
  ): TaoQuantityValue<Domain, UnitNames<Units>, RoleProof>
  read(value: TaoEvaluable<unknown>): Readonly<{ canonical: number; unit: UnitNames<Units> }>
  /** Tests exact concrete ownership without reading a wrapper or exposing nominal identity. */
  ownsPayload(payload: unknown): boolean
  /** Admits only this owner and its authenticated descendants without reading user fields. */
  acceptsPayload(payload: unknown): boolean
  derive<const ChildDomain extends string, ChildProof extends object = LegacyRole<ChildDomain>>(
    definition: DerivedDefinition<ChildDomain, UnitNames<Units>>,
  ): TaoQuantityFactory<ChildDomain, Units, RoleProof & ChildProof>
}>

const constructionKey = Object.freeze({})

class QuantityPayload<Unit extends string> {
  readonly #owner: QuantityOwner
  readonly #canonical: number
  readonly #unit: Unit

  constructor(key: object, owner: QuantityOwner, canonical: number, unit: Unit) {
    RuntimeAssert(key === constructionKey, 'quantity payloads are constructed by their checked factory')
    this.#owner = owner
    this.#canonical = canonical
    this.#unit = unit
    Object.freeze(this)
  }

  get canonical(): number {
    return this.#canonical
  }
  get domain(): string {
    return this.#owner.domain
  }
  get unit(): Unit {
    return this.#unit
  }

  belongsTo(identity: object): boolean {
    return this.#owner === identity
  }

  isAdmittedBy(identity: object): boolean {
    for (let owner: QuantityOwner | undefined = this.#owner; owner; owner = owner.parent) {
      if (owner === identity) {
        return true
      }
    }
    return false
  }

  withUnit<NextUnit extends string>(key: object, unit: NextUnit): QuantityPayload<NextUnit> {
    RuntimeAssert(key === constructionKey, 'quantity views are selected by their checked factory')
    return new QuantityPayload(key, this.#owner, this.#canonical, unit)
  }

  static is(input: unknown): input is QuantityPayload<string> {
    return typeof input === 'object' && input !== null && #canonical in input
  }

  static factoryOf(
    input: QuantityPayload<string>,
  ): TaoQuantityFactory<string, Readonly<Record<string, number>>, object> {
    const factory = quantityFactoriesByOwner.get(input.#owner)
    RuntimeAssert.defined(factory, 'a checked quantity payload retains its registered factory')
    return factory
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

/** Returns the exact declaration factory carried by an authenticated quantity payload. */
export function factoryOfQuantityInput(
  value: TaoEvaluable<unknown>,
): TaoQuantityFactory<string, Readonly<Record<string, number>>, object> {
  return QuantityPayload.factoryOf(authenticatedQuantityPayload(value.evaluate().jsValue))
}

/** Renders an authenticated quantity in its retained selected unit view. */
export function quantityToText(value: TaoEvaluable<unknown>): string {
  const payload = authenticatedQuantityPayload(value.evaluate().jsValue)
  const factory = QuantityPayload.factoryOf(payload)
  const canonical = payload.canonical
  const unit = payload.unit
  const scale = factory.definition.units[unit]
  RuntimeAssert.defined(scale, 'a selected quantity view retains its declared unit scale')
  const reading = canonical / scale
  return Number.isFinite(reading) && (reading !== 0 || canonical === 0)
    ? `${reading} ${unit}`
    : `${canonical} / ${scale} ${unit}`
}

function authenticatedQuantityPayload(input: unknown): QuantityPayload<string> {
  if (!QuantityPayload.is(input)) {
    throw new TaoActionFailure(QuantityFailureCases.BadShape, 'A checked quantity value is required.')
  }
  return input
}

/**
 * makeQuantityType snapshots declaration metadata and supplies checked construction, not operators.
 * Inject the existing runtime wrapper so its later accessor may import this leaf without a cycle.
 * Re-export the one owner-created factory: identical diagnostic names do not merge nominal domains.
 */
export function makeQuantityType<
  const Domain extends string,
  const Units extends Readonly<Record<string, number>>,
  RoleProof extends object = LegacyRole<Domain>,
>(
  definition: TaoQuantityDefinition<Domain, Units>,
  wrap: QuantityWrapper,
): TaoQuantityFactory<Domain, Units, RoleProof> {
  return createQuantityFactory<Domain, Units, RoleProof>(definition, wrap)
}

function createQuantityFactory<
  const Domain extends string,
  const Units extends Readonly<Record<string, number>>,
  RoleProof extends object,
>(
  definition: TaoQuantityDefinition<Domain, Units>,
  wrap: QuantityWrapper,
  parent?: QuantityOwner,
  inheritedUnits?: Readonly<Units>,
): TaoQuantityFactory<Domain, Units, RoleProof> {
  type Unit = UnitNames<Units>
  const units = inheritedUnits ?? Object.freeze({ ...definition.units }) as Readonly<Units>
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
  const owner: QuantityOwner = Object.freeze({
    domain: metadata.domain,
    parent,
    invariant: metadata.invariant,
  })
  const ancestry: QuantityOwner[] = []
  for (let current: QuantityOwner | undefined = owner; current; current = current.parent) {
    ancestry.push(current)
  }
  const invariantOwners = Object.freeze(Arrays.reversed(ancestry))
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
    for (const current of invariantOwners) {
      if (current.invariant && !current.invariant(canonical)) {
        fail(QuantityFailureCases.Invariant, `The '${current.domain}' value does not satisfy its declared invariant.`)
      }
    }
    return canonical
  }
  const fromCanonical = (canonical: number, unit: Unit): TaoQuantityValue<Domain, Unit, RoleProof> =>
    wrap(new QuantityPayload(constructionKey, owner, canonical, unit) as TaoQuantityPayload<Domain, Unit, RoleProof>)
  const readPayload = (value: TaoEvaluable<unknown>): QuantityPayload<Unit> => {
    const payload = value.evaluate().jsValue
    if (!QuantityPayload.is(payload)) {
      return fail(QuantityFailureCases.BadShape, `A checked '${metadata.domain}' quantity value is required.`)
    }
    if (!payload.isAdmittedBy(owner)) {
      return fail(QuantityFailureCases.DomainMismatch, `The quantity must have the '${metadata.domain}' domain.`)
    }
    return payload as QuantityPayload<Unit>
  }
  function inUnit<Payload extends TaoQuantityPayload<string, string, RoleProof>>(
    value: TaoEvaluable<Payload>,
    unit: Unit,
  ): TaoRuntimeValue<TaoQuantityView<Payload, Unit>>
  function inUnit<Payload>(
    value: TaoEvaluable<Payload> & (unknown extends Payload ? unknown : never),
    unit: Unit,
  ): TaoQuantityValue<Domain, Unit, RoleProof>
  function inUnit(value: TaoEvaluable<unknown>, unit: Unit): TaoRuntimeValue<unknown> {
    const payload = readPayload(value)
    checkUnit(unit)
    // Views retain the concrete descendant and its already-checked invariant chain.
    return wrap(payload.withUnit(constructionKey, unit))
  }
  const factory: TaoQuantityFactory<Domain, Units, RoleProof> = Object.freeze({
    definition: metadata,
    fromJSValue: (input: unknown) => fromCanonical(checkedCanonical(input), metadata.defaultUnit),
    fromUnit(input: unknown, unit: Unit) {
      checkUnit(unit)
      return fromCanonical(checkedCanonical(finite(input) * units[unit]), unit)
    },
    inUnit,
    read(value: TaoRuntimeValue<unknown>) {
      const payload = readPayload(value)
      return Object.freeze({ canonical: payload.canonical, unit: payload.unit })
    },
    ownsPayload(payload: unknown): boolean {
      return QuantityPayload.is(payload) && payload.belongsTo(owner)
    },
    acceptsPayload(payload: unknown): boolean {
      return QuantityPayload.is(payload) && payload.isAdmittedBy(owner)
    },
    derive<const ChildDomain extends string, ChildProof extends object = LegacyRole<ChildDomain>>(
      child: DerivedDefinition<ChildDomain, Unit>,
    ): TaoQuantityFactory<ChildDomain, Units, RoleProof & ChildProof> {
      RuntimeAssert.input(this === factory, 'A quantity descendant must be derived through its owning factory.')
      RuntimeAssert.input(
        child !== null && typeof child === 'object',
        'A quantity descendant needs declaration metadata.',
      )
      RuntimeAssert.input(
        !Object.hasOwn(child, 'units') && !Object.hasOwn(child, 'parent'),
        'A quantity descendant inherits its owning factory and unit table.',
      )
      const defaultUnit = child.defaultUnit
      return createQuantityFactory<ChildDomain, Units, RoleProof & ChildProof>(
        {
          domain: child.domain,
          units,
          defaultUnit: defaultUnit === undefined ? metadata.defaultUnit : defaultUnit,
          invariant: child.invariant,
        },
        wrap,
        owner,
        units,
      )
    },
  })
  // The registry erases only static role proofs; its private owner key retains the exact factory.
  // Generic conditional native-output types cannot express that erasure as structural covariance.
  quantityFactoriesByOwner.set(
    owner,
    factory as unknown as TaoQuantityFactory<string, Readonly<Record<string, number>>, object>,
  )
  return factory
}
