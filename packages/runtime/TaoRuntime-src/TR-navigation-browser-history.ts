export type BrowserNavigationPosition = Readonly<{
  epoch: string
  sequence: number
}>

export type BrowserNavigationHistoryDriver = {
  go(delta: number): void
  onActivate?(listener: () => void): () => void
  push(position: BrowserNavigationPosition): void
  replace(position: BrowserNavigationPosition): void
  subscribe(listener: (position: BrowserNavigationPosition | undefined) => void): () => void
}

export type BrowserNavigationEntry = Readonly<{
  arguments: Readonly<Record<string, unknown>>
  context?: string
  instanceId: number
  kind: 'ask' | 'content' | 'overlay'
  owner: object
  presentable: unknown
  replay?: () => void
}>

export type BrowserNavigationRemoval = Readonly<{
  context?: string
  instanceId?: number
  owner?: object
}>

/** BrowserNavigationHistory mirrors reducer mutations without ever becoming app-state authority. */
export class BrowserNavigationHistory {
  private readonly activeEntries: BrowserNavigationEntry[] = []
  private browserSequence = 0
  private currentSequence = 0
  private detachActivation: (() => void) | undefined
  private detachDriver: (() => void) | undefined
  private driver: BrowserNavigationHistoryDriver | undefined
  private epoch = createBrowserNavigationEpoch()
  private handlingPop = false
  private maximumSequence = 0
  private readonly redoEntries = new Map<number, BrowserNavigationEntry>()
  private readonly replayUnsafeOwners = new Set<object>()
  private traversalTarget: number | undefined

  constructor(private readonly backReducer: () => boolean) {}

  attach(driver: BrowserNavigationHistoryDriver): () => void {
    this.detach()
    this.driver = driver
    // A host remount must retain the reducer mirror. Rebuild an equivalent live browser chain under
    // a fresh epoch so earlier-page and pre-reload entries cannot resolve into this journal.
    this.rebuildBrowserChain(driver)
    this.detachActivation = driver.onActivate?.(() => this.rebuildBrowserChain(driver))
    this.detachDriver = driver.subscribe(position => this.reconcilePop(position))
    return () => {
      if (this.driver === driver) {
        this.detach()
      }
    }
  }

  record(entry: BrowserNavigationEntry): void {
    if (this.handlingPop) {
      return
    }
    this.pruneRedo()
    this.currentSequence += 1
    const recorded = this.replayUnsafeOwners.has(entry.owner) ? withoutReplay(entry) : entry
    this.activeEntries.push(recorded)
    this.maximumSequence = this.currentSequence
    this.redoEntries.delete(this.currentSequence)
    this.synchronizeBrowser()
  }

  /** invalidateRedo drops browser-forward mutations after a history-free navigation change. */
  invalidateRedo(): void {
    if (!this.handlingPop) {
      this.pruneRedo()
    }
  }

  /** invalidateOwnerReplay keeps Back authoritative when a structural mount hides active context. */
  invalidateOwnerReplay(owner: object): void {
    this.replayUnsafeOwners.add(owner)
    for (let index = 0; index < this.activeEntries.length; index += 1) {
      const entry = this.activeEntries[index]!
      if (entry.owner === owner && entry.replay) {
        this.activeEntries[index] = withoutReplay(entry)
      }
    }
    for (const [sequence, entry] of this.redoEntries) {
      if (entry.owner === owner && entry.replay) {
        this.redoEntries.set(sequence, withoutReplay(entry))
      }
    }
    this.invalidateRedo()
  }

  /** reducerBackCompleted reconciles Back initiated by UI, hardware, dismissal, or a pop handler. */
  reducerBackCompleted(removal: BrowserNavigationRemoval = {}): void {
    if (this.currentSequence === 0) {
      return
    }
    const removedIndex = this.removedEntryIndex(removal)
    const removed = removedIndex < 0 ? undefined : this.activeEntries.splice(removedIndex, 1)[0]
    this.currentSequence -= 1
    if (removed) {
      this.redoEntries.set(this.currentSequence + 1, removed)
    } else {
      this.redoEntries.delete(this.currentSequence + 1)
    }
    if (!this.handlingPop) {
      this.synchronizeBrowser()
    }
  }

  /** reset starts a fresh reducer root without retaining stale browser positions or replay entries. */
  reset(): void {
    this.activeEntries.length = 0
    this.currentSequence = 0
    this.maximumSequence = 0
    this.redoEntries.clear()
    this.replayUnsafeOwners.clear()
    this.traversalTarget = undefined
    if (this.driver) {
      this.rebuildBrowserChain(this.driver)
    }
  }

  private abandonMirrorAtReducerRoot(driver: BrowserNavigationHistoryDriver): void {
    this.activeEntries.length = 0
    this.currentSequence = 0
    this.maximumSequence = 0
    this.redoEntries.clear()
    this.traversalTarget = undefined
    this.epoch = createBrowserNavigationEpoch()
    this.browserSequence = 0
    driver.replace(this.position(0))
    // If there is no earlier entry, History.go is a specified no-op. No controller flag depends on
    // a follow-up popstate, so a direct-entry tab remains live for later navigation.
    driver.go(-1)
  }

  private detach(): void {
    this.detachActivation?.()
    this.detachActivation = undefined
    this.detachDriver?.()
    this.detachDriver = undefined
    this.driver = undefined
    this.traversalTarget = undefined
  }

  private position(sequence: number): BrowserNavigationPosition {
    return { epoch: this.epoch, sequence }
  }

  private pruneRedo(): void {
    for (const sequence of this.redoEntries.keys()) {
      if (sequence > this.currentSequence) {
        this.redoEntries.delete(sequence)
      }
    }
    this.maximumSequence = this.currentSequence
  }

  private rebuildBrowserChain(driver: BrowserNavigationHistoryDriver): void {
    this.epoch = createBrowserNavigationEpoch()
    this.browserSequence = 0
    this.traversalTarget = undefined
    this.redoEntries.clear()
    this.maximumSequence = this.currentSequence
    driver.replace(this.position(0))
    for (let sequence = 1; sequence <= this.currentSequence; sequence += 1) {
      driver.push(this.position(sequence))
    }
    this.browserSequence = this.currentSequence
  }

  private reconcilePop(position: BrowserNavigationPosition | undefined): boolean {
    const driver = this.driver
    if (!driver) {
      return false
    }
    if (!position) {
      if (this.traversalTarget !== undefined) {
        // A programmatic traversal unexpectedly left the live epoch. Rebuild from reducer state so
        // future records cannot remain permanently queued behind a popstate that will never arrive.
        this.rebuildBrowserChain(driver)
      }
      return false
    }
    if (position.epoch !== this.epoch) {
      // A namespaced position from an earlier attachment or page lifetime is known to be Tao but
      // has no live journal. Make it inert and stamp the reducer's live position onto this entry.
      this.rearm(driver)
      return true
    }
    if (position.sequence > this.maximumSequence) {
      this.rearm(driver)
      return true
    }

    this.browserSequence = position.sequence
    if (this.traversalTarget !== undefined) {
      this.traversalTarget = undefined
      this.synchronizeBrowser()
      return true
    }
    if (position.sequence === this.currentSequence) {
      return true
    }

    this.handlingPop = true
    try {
      if (position.sequence < this.currentSequence) {
        while (this.currentSequence > position.sequence) {
          if (!this.backReducer()) {
            // Browser depth drifted beyond state the semantic reducer can remove. Root is the
            // authority: invalidate the mirror and let the platform perform its normal root Back.
            this.abandonMirrorAtReducerRoot(driver)
            return true
          }
        }
        return true
      }

      while (this.currentSequence < position.sequence) {
        const next = this.redoEntries.get(this.currentSequence + 1)
        if (!next?.replay) {
          this.rearm(driver)
          return true
        }
        next.replay()
        this.activeEntries.push(next)
        this.currentSequence += 1
      }
      return true
    } finally {
      this.handlingPop = false
    }
  }

  private rearm(driver: BrowserNavigationHistoryDriver): void {
    driver.replace(this.position(this.currentSequence))
    this.browserSequence = this.currentSequence
    this.traversalTarget = undefined
  }

  private removedEntryIndex(removal: BrowserNavigationRemoval): number {
    if (removal.instanceId !== undefined) {
      return this.activeEntries.findLastIndex(entry => entry.instanceId === removal.instanceId)
    }
    if (removal.owner) {
      const overlay = this.activeEntries.findLastIndex(entry =>
        entry.owner === removal.owner && (entry.kind === 'overlay' || entry.kind === 'ask')
      )
      return overlay >= 0
        ? overlay
        : this.activeEntries.findLastIndex(entry =>
          entry.owner === removal.owner
          && (removal.context === undefined || entry.context === removal.context)
        )
    }
    return this.activeEntries.length - 1
  }

  private synchronizeBrowser(): void {
    const driver = this.driver
    if (!driver || this.handlingPop || this.traversalTarget !== undefined) {
      return
    }
    if (this.browserSequence > this.currentSequence) {
      this.traversalTarget = this.currentSequence
      driver.go(this.currentSequence - this.browserSequence)
      return
    }
    for (let sequence = this.browserSequence + 1; sequence <= this.currentSequence; sequence += 1) {
      driver.push(this.position(sequence))
    }
    this.browserSequence = this.currentSequence
  }
}

function withoutReplay(entry: BrowserNavigationEntry): BrowserNavigationEntry {
  const { replay: _replay, ...inert } = entry
  return inert
}

const taoHistoryStateKey = '__taoNavigation'
const taoPreviousHistoryStateKey = '__taoPreviousState'
type BrowserHistoryLease = {
  activate(): void
  token: symbol
}

const browserHistoryLeases: BrowserHistoryLease[] = []

type BrowserHistoryLike = {
  go(delta: number): void
  pushState(data: unknown, unused: string): void
  replaceState(data: unknown, unused: string): void
  state?: unknown
}

type BrowserWindowLike = {
  addEventListener(type: 'popstate', listener: (event: { state: unknown }) => void): void
  history: BrowserHistoryLike
  removeEventListener(type: 'popstate', listener: (event: { state: unknown }) => void): void
}

export function browserNavigationHistoryDriver(): BrowserNavigationHistoryDriver | undefined {
  const candidate = (globalThis as { window?: Partial<BrowserWindowLike> }).window
  const history = candidate?.history
  if (
    !candidate?.addEventListener || !candidate.removeEventListener || !history?.pushState
    || !history.replaceState || !history.go
  ) {
    return undefined
  }
  const window = candidate as BrowserWindowLike
  let activationListener: (() => void) | undefined
  const lease: BrowserHistoryLease = {
    activate: () => activationListener?.(),
    token: Symbol('Tao browser navigation history'),
  }
  browserHistoryLeases.push(lease)
  const active = () => browserHistoryLeases.at(-1) === lease
  return {
    go: delta => {
      if (active()) {
        history.go(delta)
      }
    },
    onActivate(listener) {
      activationListener = listener
      return () => {
        if (activationListener === listener) {
          activationListener = undefined
        }
      }
    },
    push: position => {
      if (active()) {
        history.pushState(mergeHistoryState(history.state, position), '')
      }
    },
    replace: position => {
      if (active()) {
        history.replaceState(mergeHistoryState(history.state, position), '')
      }
    },
    subscribe(listener) {
      const onPopState = (event: { state: unknown }) => {
        if (active()) {
          listener(readHistoryPosition(event.state))
        }
      }
      window.addEventListener('popstate', onPopState)
      return () => {
        window.removeEventListener('popstate', onPopState)
        const wasActive = active()
        const index = browserHistoryLeases.indexOf(lease)
        if (index >= 0) {
          browserHistoryLeases.splice(index, 1)
        }
        if (wasActive) {
          browserHistoryLeases.at(-1)?.activate()
        }
      }
    },
  }
}

function createBrowserNavigationEpoch(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?(): string } }).crypto
  return crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function mergeHistoryState(
  state: unknown,
  position: BrowserNavigationPosition,
): Record<string, unknown> {
  const preserved = isRecord(state)
    ? state
    : state === undefined
    ? {}
    : { [taoPreviousHistoryStateKey]: state }
  return { ...preserved, [taoHistoryStateKey]: [position.epoch, position.sequence] }
}

function readHistoryPosition(state: unknown): BrowserNavigationPosition | undefined {
  if (!isRecord(state)) {
    return undefined
  }
  const stored = state[taoHistoryStateKey]
  if (
    !Array.isArray(stored) || stored.length !== 2 || typeof stored[0] !== 'string'
    || !Number.isSafeInteger(stored[1]) || (stored[1] as number) < 0
  ) {
    return undefined
  }
  return { epoch: stored[0], sequence: stored[1] as number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
