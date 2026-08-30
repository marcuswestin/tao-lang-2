const reactiveValueBrand = Symbol('TaoReactiveValue')

/** TaoReactiveValue is a runtime-owned library value that can notify a mounted holder when it changes. */
export type TaoReactiveValue = {
  subscribe(listener: () => void): () => void
}

/** TaoReactiveSource owns the subscriptions behind one reactive library value. */
export type TaoReactiveSource = TaoReactiveValue & {
  readonly listenerCount: number
  notify(): void
}

/** createReactiveSource creates independent, mutation-safe subscriptions for a reactive value. */
export function createReactiveSource(): TaoReactiveSource {
  const listeners = new Set<() => void>()

  return markReactiveValue({
    get listenerCount() {
      return listeners.size
    },
    notify() {
      for (const listener of [...listeners]) {
        listener()
      }
    },
    subscribe(listener) {
      // Store a distinct subscription so subscribing the same callback twice remains independent.
      const subscription = () => listener()
      listeners.add(subscription)
      return () => listeners.delete(subscription)
    },
  })
}

/** markReactiveValue prevents app-authored sidecar values with lookalike subscribe methods matching. */
export function markReactiveValue<ValueT extends TaoReactiveValue>(value: ValueT): ValueT {
  Object.defineProperty(value, reactiveValueBrand, { value: true })
  return value
}

/** isReactiveValue reports whether a runtime value can drive holder re-renders as it changes. */
export function isReactiveValue(value: unknown): value is TaoReactiveValue {
  return typeof value === 'object'
    && value !== null
    && (value as Record<symbol, unknown>)[reactiveValueBrand] === true
    && typeof (value as TaoReactiveValue).subscribe === 'function'
}
