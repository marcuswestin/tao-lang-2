import type TR from './TR'
import type { TaoEvaluable } from './TR-action-values'
import { RuntimeAssert } from './TR-assert'
import { getJSValue } from './TR-js-value'
import { isRuntimeValue, registerCompleteRuntimeValue, type TaoRuntimeValue } from './TR-reactive-values'

declare const capabilityBrand: unique symbol

/** A capability carries selected methods while retaining its concrete source's current reads. */
export type TaoCapability<ValueT = unknown> = TaoRuntimeValue<ValueT> & {
  readonly [capabilityBrand]: true
}

type CapabilityMetadata = {
  source: TaoEvaluable<unknown>
  witnesses: ReadonlyMap<string, TR.Function>
}

const ownedCapabilities = new WeakMap<object, CapabilityMetadata>()

// The erased nominal brand does not emit a class field; runtime ownership lives in the WeakMap.
interface Capability<ValueT> {
  readonly [capabilityBrand]: true
}

class Capability<ValueT> implements TaoCapability<ValueT> {
  readonly #source: TaoEvaluable<ValueT>

  constructor(source: TaoEvaluable<ValueT>) {
    this.#source = source
    registerCompleteRuntimeValue(this)
  }

  evaluate(): this {
    return this
  }

  get jsValue(): ValueT {
    return this.#source.evaluate().jsValue
  }

  getJSValue() {
    return getJSValue(this)
  }
}

/** Creates capability operations using the ordinary runtime function factory, without importing it. */
export function createCapabilityRuntime(functionFactory: typeof TR.Function) {
  function create<ValueT>(
    source: TaoEvaluable<ValueT>,
    witnesses: ReadonlyMap<string, TR.Function>,
  ): TaoCapability<ValueT> {
    const carrier = new Capability(source)
    ownedCapabilities.set(carrier, { source, witnesses })
    return carrier
  }

  function metadata(carrier: TaoCapability): CapabilityMetadata {
    const selected = ownedCapabilities.get(carrier)
    RuntimeAssert.defined(selected, 'a capability constructed by the runtime')
    return selected
  }

  function witness(selected: CapabilityMetadata, key: string): TR.Function {
    const implementation = selected.witnesses.get(key)
    RuntimeAssert.defined(implementation, 'a selected witness for the required capability method')
    return implementation
  }

  return {
    /** Witnesses are validated ordinary functions whose first argument is the concrete receiver. */
    attach<ValueT>(
      originalSource: TaoEvaluable<ValueT>,
      witnesses: Readonly<Record<string, TR.Function>>,
    ): TaoCapability<ValueT> {
      RuntimeAssert(!ownedCapabilities.has(originalSource), 'a concrete source rather than an attached capability')
      return create(originalSource, new Map(Object.entries(witnesses)))
    },

    /** A validated contextual Self result keeps selected witnesses but binds them to its new receiver. */
    rebind<ValueT>(
      donor: TaoCapability,
      newSource: TaoEvaluable<ValueT>,
    ): TaoCapability<ValueT> {
      const selected = metadata(donor)
      RuntimeAssert(isRuntimeValue(newSource), 'a runtime-owned contextual Self result')
      const concreteSource = ownedCapabilities.get(newSource)?.source ?? newSource
      return create(concreteSource as TaoEvaluable<ValueT>, selected.witnesses)
    },

    /** Maps each receiving requirement key to an already selected key; unrequested methods disappear. */
    reproject<ValueT>(
      carrier: TaoCapability<ValueT>,
      validatedRequiredKeyMap: Readonly<Record<string, string>>,
      validatedWitnessAdapters: Readonly<Record<string, (selected: TR.Function) => TR.Function>> = {},
    ): TaoCapability<ValueT> {
      const selected = metadata(carrier)
      const adapters = new Map(Object.entries(validatedWitnessAdapters))
      const witnesses = new Map(
        Object.entries(validatedRequiredKeyMap).map(([requiredKey, selectedKey]) => {
          const implementation = witness(selected, selectedKey)
          const adapt = adapters.get(requiredKey)
          return [requiredKey, adapt ? adapt(implementation) : implementation] as const
        }),
      )
      return create(selected.source as TaoEvaluable<ValueT>, witnesses)
    },

    /** Binding performs no reads; invocation supplies the exact original receiver before caller arguments. */
    method(carrier: TaoCapability, requiredKey: string): TR.Function {
      const selected = metadata(carrier)
      const implementation = witness(selected, requiredKey)
      return functionFactory((...args: TR.Evaluable[]) =>
        implementation.invoke(selected.source as TR.Evaluable, ...args)
      )
    },
  }
}
