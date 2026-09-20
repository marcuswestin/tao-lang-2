/**
 * RuntimeListeners is the one subscriber set the runtime keeps. Nearly every runtime domain — data
 * loads, the debug journal, dev mode, navigation diagnostics, interaction state, persisted state —
 * had its own `Set` plus the same add/delete/iterate triple around it; this is that triple once.
 *
 * `notify` walks a copy of the set, so a listener that unsubscribes, or subscribes another, while
 * it is being notified cannot change the round it is already in. Subscribing the same function
 * twice registers once, as a `Set` does; a caller that needs two independent registrations passes
 * two distinct closures.
 */
export type RuntimeListeners<ArgsT extends readonly unknown[] = []> = Readonly<{
  /** clear drops every subscriber at once, for an owner that is being disposed. */
  clear(): void
  count(): number
  notify(...args: ArgsT): void
  subscribe(listener: (...args: ArgsT) => void): () => void
}>

/**
 * RuntimeRevisionStore is the `useSyncExternalStore` contract every mounted runtime domain
 * implements: a version React re-reads on, and one `changed` that advances it and publishes.
 */
export type RuntimeRevisionStore = Readonly<{
  changed(): void
  /** clear drops every subscriber at once, for an owner that is being disposed. */
  clear(): void
  snapshot(): number
  subscribe(listener: () => void): () => void
}>

/** runtimeRevisionStore creates one independent version-and-subscribers pair. */
export function runtimeRevisionStore(): RuntimeRevisionStore {
  const listeners = runtimeListeners()
  let revision = 0
  return {
    changed: () => {
      revision += 1
      listeners.notify()
    },
    clear: listeners.clear,
    snapshot: () => revision,
    subscribe: listeners.subscribe,
  }
}

/** runtimeListeners creates one independent subscriber set. */
export function runtimeListeners<ArgsT extends readonly unknown[] = []>(): RuntimeListeners<ArgsT> {
  const listeners = new Set<(...args: ArgsT) => void>()
  return {
    clear: () => listeners.clear(),
    count: () => listeners.size,
    notify: (...args) => {
      for (const listener of [...listeners]) {
        listener(...args)
      }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
