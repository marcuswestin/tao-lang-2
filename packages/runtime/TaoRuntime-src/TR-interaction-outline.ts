import React from 'react'
import { DataControls, type TaoEntityCommandPolicy } from './TR-data'
import { labelCorpus, primaryLabel } from './TR-interaction-labels'
import type { Evaluable } from './TR-navigation-presentables'
import type { Subscription } from './TR-navigation-state'
import type { TaoRuntimeJson } from './TR-runtime-capture'
import type { TaoProps } from './TR-TaoProps'

/** TaoOutlineTextPath is the member path one row-bound text reads from the row value. */
export type TaoOutlineTextPath = readonly string[]

/**
 * TaoOutlineLoopDescriptor is what the compiler emitted for one loop: the rows it iterates, how a
 * row's label ranks, and whether one native root can carry that label.
 */
export type TaoOutlineLoopDescriptor = Readonly<{
  /** collection names the collection expression when it is a name or a path, as a person reads it. */
  collection?: string
  declaration: string
  entity?: string
  kind: 'collection'
  name: string
  root: 'multiple' | 'single'
  selectable: boolean
  /** testTag privately joins a tagged loop to its rows in the Tao test harness. */
  testTag?: string
  texts: readonly TaoOutlineTextPath[]
}>

/** TaoOutlineControlDescriptor is what the compiler emitted for one render that wires an event. */
type TaoOutlineControlDescriptor = Readonly<{
  declaration: string
  kind: 'control'
  label?: string
  role: 'action' | 'input'
  /** view is the rendered view's name, the label of last resort for a control the site left unnamed. */
  view: string
}>

/** A sibling region groups the concrete roots beside one nav without adding a native wrapper. */
type TaoOutlineSiblingRegionDescriptor = Readonly<{
  declaration: string
  kind: 'region'
  label?: string
  members: readonly string[]
  nav: string
  role: 'nav-siblings'
}>

type TaoOutlineDescriptor =
  | TaoOutlineControlDescriptor
  | TaoOutlineLoopDescriptor
  | TaoOutlineSiblingRegionDescriptor

/**
 * TaoOutlineTable is what one module emits: its static outline nodes, keyed within the module. The
 * table is generated; describing and registering its nodes is not, which keeps the runtime
 * handwritten while the compiler still owns what a module contains.
 */
export type TaoOutlineTable = Readonly<{
  module: string
  nodes: Readonly<Record<string, TaoOutlineDescriptor>>
}>

/** A described node is a table entry that knows its module-qualified identity. */
type TaoOutlineDescribed<DescriptorT extends TaoOutlineDescriptor> = DescriptorT & Readonly<{ identity: string }>
export type TaoOutlineLoopNode = TaoOutlineDescribed<TaoOutlineLoopDescriptor>
export type TaoOutlineControlNode = TaoOutlineDescribed<TaoOutlineControlDescriptor>
export type TaoOutlineSiblingRegionNode = TaoOutlineDescribed<TaoOutlineSiblingRegionDescriptor>
/** The described table keeps each key's exact node type, so a site reads the node kind it references. */
export type TaoOutlineDescribedTable<TableT extends TaoOutlineTable = TaoOutlineTable> = {
  readonly [KeyT in keyof TableT['nodes']]: TaoOutlineDescribed<TableT['nodes'][KeyT]>
}

type TaoOutlineNodeKind = 'action' | 'collection' | 'input' | 'item' | 'region'
export type TaoOutlineProvenance = Readonly<Record<string, TaoRuntimeJson>>

/** TaoOutlineNode is one mounted node as a reader sees it: identity, kind, label, provenance. */
export type TaoOutlineNode = Readonly<{
  corpus?: readonly string[]
  identity: string
  kind: TaoOutlineNodeKind
  label?: string
  parent?: string
  provenance: TaoOutlineProvenance
}>

export type TaoOutlineSnapshot = Readonly<{ nodes: readonly TaoOutlineNode[] }>

/** TaoOutlineEntry is what a mounted node registers: its identity and the readers evaluated on demand. */
export type TaoOutlineEntry = {
  corpus?: () => readonly string[]
  identity: string
  kind: TaoOutlineNodeKind
  label: () => string | undefined
  parent?: string
  provenance: TaoOutlineProvenance
  /** testTag is mounted test metadata and is deliberately absent from public outline snapshots. */
  testTag?: string
  live?: TaoOutlineLiveEntry
}

export type TaoInteractionBounds = Readonly<{ height: number; width: number; x: number; y: number }>

type TaoMeasurableNode = {
  measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void
}

type TaoInteractionLayoutEvent = Readonly<{
  nativeEvent?: { layout?: Partial<TaoInteractionBounds> }
}>

/** InteractionMeasurements caches app-relative geometry; surfaces only read and never measure. */
class InteractionMeasurements {
  #bindings = new Map<string, {
    nativeProps: Record<string, unknown>
    onLayout(event: TaoInteractionLayoutEvent): void
    ref(node: TaoMeasurableNode | null): void
  }>()
  #bounds = new Map<string, TaoInteractionBounds>()
  #listeners = new Set<() => void>()
  #nodes = new Map<string, TaoMeasurableNode>()
  #revision = 0
  #root: TaoMeasurableNode | undefined
  #rootOrigin = { x: 0, y: 0 }
  #rootBinding: {
    nativeProps: Record<string, unknown>
    onLayout(event: TaoInteractionLayoutEvent): void
    ref(node: TaoMeasurableNode | null): void
  } | undefined

  readonly snapshot = (): number => this.#revision
  readonly subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  read(identity: string): TaoInteractionBounds | undefined {
    return this.#bounds.get(identity)
  }

  bind(identity: string, nativeProps: Record<string, unknown> = {}): Record<string, unknown> {
    let binding = this.#bindings.get(identity)
    if (!binding) {
      binding = {
        nativeProps,
        onLayout: event => {
          functionProperty(binding!.nativeProps, 'onLayout')?.(event)
          // onLayout coordinates are relative to the immediate parent. Only measureInWindow can
          // provide geometry in the interaction root's coordinate space for an arbitrarily nested
          // control, so an unavailable host measurement leaves the hint deliberately unanchored.
          this.measure(identity)
        },
        ref: node => {
          assignRef(binding!.nativeProps['ref'], node)
          if (node) {
            this.#nodes.set(identity, node)
          } else {
            this.#nodes.delete(identity)
            this.#bindings.delete(identity)
            this.delete(identity)
          }
        },
      }
      this.#bindings.set(identity, binding)
    }
    binding.nativeProps = nativeProps
    return {
      ...nativeProps,
      onLayout: binding.onLayout,
      ref: binding.ref,
    }
  }

  bindRoot(nativeProps: Record<string, unknown> = {}): Record<string, unknown> {
    let binding = this.#rootBinding
    if (!binding) {
      binding = {
        nativeProps,
        onLayout: event => {
          functionProperty(binding!.nativeProps, 'onLayout')?.(event)
          this.measureRoot()
        },
        ref: node => {
          assignRef(binding!.nativeProps['ref'], node)
          this.#root = node ?? undefined
          this.measureRoot()
        },
      }
      this.#rootBinding = binding
    }
    binding.nativeProps = nativeProps
    return {
      ...nativeProps,
      onLayout: binding.onLayout,
      ref: binding.ref,
    }
  }

  clear(): void {
    this.#bounds.clear()
    this.#bindings.clear()
    this.#nodes.clear()
    this.#root = undefined
    this.#rootBinding = undefined
    this.#rootOrigin = { x: 0, y: 0 }
    this.changed()
  }

  private measure(identity: string): void {
    const node = this.#nodes.get(identity)
    node?.measureInWindow?.((x, y, width, height) => {
      this.set(identity, {
        height,
        width,
        x: x - this.#rootOrigin.x,
        y: y - this.#rootOrigin.y,
      })
    })
  }

  private measureRoot(): void {
    this.#root?.measureInWindow?.((x, y) => {
      this.#rootOrigin = { x, y }
      for (const identity of this.#nodes.keys()) {
        this.measure(identity)
      }
    })
  }

  private set(identity: string, bounds: TaoInteractionBounds): void {
    const current = this.#bounds.get(identity)
    if (
      current
      && Object.keys(bounds).every(key =>
        bounds[key as keyof TaoInteractionBounds] === current[key as keyof TaoInteractionBounds]
      )
    ) {
      return
    }
    this.#bounds.set(identity, Object.freeze(bounds))
    this.changed()
  }

  private delete(identity: string): void {
    if (this.#bounds.delete(identity)) {
      this.changed()
    }
  }

  private changed(): void {
    this.#revision += 1
    for (const listener of [...this.#listeners]) {
      listener()
    }
  }
}

export const interactionMeasurements = new InteractionMeasurements()

function functionProperty(
  object: Record<string, unknown>,
  name: string,
): ((...arguments_: any[]) => unknown) | undefined {
  return typeof object[name] === 'function' ? object[name] as (...arguments_: any[]) => unknown : undefined
}

function assignRef(ref: unknown, value: TaoMeasurableNode | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref && typeof ref === 'object' && 'current' in ref) {
    ;(ref as { current: TaoMeasurableNode | null }).current = value
  }
}

/** TaoOutlineLiveEntry is private mounted capability state and never enters a public snapshot. */
export type TaoOutlineLiveEntry = {
  activate?(): unknown
  active?: () => boolean
  blur?(): void
  commandPolicy?: TaoEntityCommandPolicy
  enabled?: () => boolean
  engage?(): void
  entityType?: string
  focus?(): void
  label?(): string | undefined
  measure?(): TaoInteractionBounds | undefined
  modal?: boolean
  primary?: boolean
  runtimeValue?: Evaluable
  scrollIntoView?(): void
}

/** TaoOutlineLiveNode is the ordered mounted record consumed only by the attention reducer. */
export type TaoOutlineLiveNode =
  & TaoOutlineEntry
  & Readonly<{
    mount: number
    order: number
  }>

type MeasuredOutlineNode = Readonly<{
  bounds: TaoInteractionBounds
  node: TaoOutlineLiveNode
  registration: number
}>

type VisualRow = {
  bottom: number
  nodes: MeasuredOutlineNode[]
  top: number
}

/**
 * visualOrder puts nodes in structural rows before reading each row from left to right. Nodes whose
 * vertical spans share a band belong to one row even when their heights and top edges differ; a row
 * boundary exists only where the preceding row ends before the next begins. This makes scrolling a
 * coordinate translation rather than a reorder and keeps a tall control aligned with shorter peers.
 * Registration order stays the final tiebreak, and stays the whole answer while any node is
 * unmeasured: a partially measured list has no complete visual structure to read.
 */
export function visualOrder(nodes: readonly TaoOutlineLiveNode[]): readonly TaoOutlineLiveNode[] {
  const measured = nodes.map((node, registration) => ({ bounds: node.live?.measure?.(), node, registration }))
  const anchored: MeasuredOutlineNode[] = measured.flatMap(entry =>
    entry.bounds === undefined ? [] : [{ ...entry, bounds: entry.bounds }]
  )
  if (anchored.length !== measured.length) {
    return nodes
  }
  const rows: VisualRow[] = []
  for (
    const entry of [...anchored].sort((left, right) =>
      left.bounds.y - right.bounds.y || left.registration - right.registration
    )
  ) {
    const entryBottom = entry.bounds.y + entry.bounds.height
    const row = rows.find(candidate => entry.bounds.y < candidate.bottom && entryBottom > candidate.top)
    if (row === undefined) {
      rows.push({ bottom: entryBottom, nodes: [entry], top: entry.bounds.y })
      continue
    }
    // Keep the band every member shares. A very tall node cannot bridge two otherwise separate rows.
    row.top = Math.max(row.top, entry.bounds.y)
    row.bottom = Math.min(row.bottom, entryBottom)
    row.nodes.push(entry)
  }
  return [...rows]
    .sort((left, right) => left.top - right.top)
    .flatMap(row =>
      [...row.nodes].sort((left, right) => left.bounds.x - right.bounds.x || left.registration - right.registration)
    )
    .map(entry => entry.node)
}

/** TaoOutlineRowRoot is what a loop row hands the native root that renders it. */
export type TaoOutlineRowRoot = Readonly<{ label: string }>

/**
 * InteractionOutline is the registry every mounted outline node joins for exactly as long as it is
 * mounted. Existence is always registered; what a reader sees — labels, the narrowing corpus, a
 * change notification — is evaluated only when a reader asks, and a subscriber is told only when
 * what it would read has actually changed.
 */
export class InteractionOutline implements Subscription {
  #entries = new Map<number, TaoOutlineEntry>()
  #coalesced = new Map<string, { entry: TaoOutlineEntry; key: number; refs: number }>()
  #liveListeners = new Set<() => void>()
  #listeners = new Set<() => void>()
  #liveRevision = 0
  #liveFingerprint: string | undefined
  #liveRefreshScheduled = false
  #liveStructureDirty = false
  #sequence = 0
  #revision = 0
  #fingerprint: string | undefined
  #refreshScheduled = false

  readonly snapshot = (): number => this.#revision
  readonly liveSnapshot = (): number => this.#liveRevision

  readonly subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener)
    // The baseline a subscriber is later notified against is what it can read right now.
    this.#fingerprint ??= fingerprintOf(this.read())
    return () => {
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) {
        this.#fingerprint = undefined
      }
    }
  }

  /** register adds one mounted node and returns the withdrawal its owner keeps for unmount. */
  register(entry: TaoOutlineEntry): () => void {
    const key = ++this.#sequence
    this.#entries.set(key, entry)
    this.changed()
    return () => {
      this.#entries.delete(key)
      this.changed()
    }
  }

  /** registerCoalesced ref-counts concrete roots that describe one wrapper-free logical region. */
  registerCoalesced(identity: string, entry: TaoOutlineEntry): () => void {
    const existing = this.#coalesced.get(identity)
    if (existing) {
      existing.refs += 1
      existing.entry = entry
      this.#entries.set(existing.key, entry)
      this.changed()
      return () => this.withdrawCoalesced(identity)
    }
    const key = ++this.#sequence
    this.#coalesced.set(identity, { entry, key, refs: 1 })
    this.#entries.set(key, entry)
    this.changed()
    return () => this.withdrawCoalesced(identity)
  }

  /** update replaces one mounted entry's live readers without changing its render order. */
  update(mount: number, entry: TaoOutlineEntry): void {
    if (!this.#entries.has(mount)) {
      return
    }
    this.#entries.set(mount, entry)
    this.changed()
  }

  /** liveNodes is the private ordered channel; callers must never publish these records. */
  liveNodes(): readonly TaoOutlineLiveNode[] {
    return [...this.#entries.entries()].map(([mount, entry], order) => ({ ...entry, mount, order }))
  }

  /** itemIdentityForTestTag resolves the selected occurrence of a tagged loop without label inference. */
  itemIdentityForTestTag(tag: string, index: number, parentIdentity?: string): string | undefined {
    const entries = [...this.#entries.values()]
    const collections = new Set(
      entries.filter(entry =>
        entry.kind === 'collection'
        && entry.testTag === tag
        && (parentIdentity === undefined || entryDescendsFrom(entry, parentIdentity, entries))
      ).map(entry => entry.identity),
    )
    return entries.filter(entry => entry.kind === 'item' && entry.parent && collections.has(entry.parent))[index - 1]
      ?.identity
  }

  /** subscribeLive observes structure and capability changes independently of public snapshots. */
  subscribeLive(listener: () => void): () => void {
    this.#liveListeners.add(listener)
    this.#liveFingerprint ??= liveFingerprintOf(this.liveNodes())
    this.#liveStructureDirty = false
    return () => {
      this.#liveListeners.delete(listener)
      if (this.#liveListeners.size === 0) {
        this.#liveFingerprint = undefined
        this.#liveStructureDirty = false
      }
    }
  }

  /** read evaluates the outline as it is right now: a reader's act, so it is where the corpus is read. */
  read(): TaoOutlineSnapshot {
    const nodes = [...this.#entries.values()].map(entry => {
      const label = entry.label()
      const corpus = entry.corpus?.()
      return Object.freeze({
        identity: entry.identity,
        kind: entry.kind,
        ...(entry.parent === undefined ? {} : { parent: entry.parent }),
        ...(label === undefined ? {} : { label }),
        provenance: entry.provenance,
        ...(corpus === undefined ? {} : { corpus: Object.freeze([...corpus]) }),
      })
    })
    return Object.freeze({ nodes: Object.freeze(nodes) })
  }

  /** mounted counts the registered nodes, which is all that exists without a reader. */
  get mounted(): number {
    return this.#entries.size
  }

  /**
   * refresh asks the outline to notice a change. Without a subscriber it costs nothing; with one,
   * the commits of one render pass fold into a single comparison of what a subscriber would read.
   */
  refresh(): void {
    if (this.#listeners.size === 0 || this.#refreshScheduled) {
      return
    }
    this.#refreshScheduled = true
    queueMicrotask(() => {
      this.#refreshScheduled = false
      if (this.#listeners.size === 0) {
        return
      }
      const fingerprint = fingerprintOf(this.read())
      if (fingerprint === this.#fingerprint) {
        return
      }
      this.#fingerprint = fingerprint
      this.#revision += 1
      for (const listener of [...this.#listeners]) {
        listener()
      }
    })
  }

  /** refreshLive notices stable-identity active/enabled capability changes after a React commit. */
  refreshLive(): void {
    if (this.#liveListeners.size === 0 || this.#liveRefreshScheduled) {
      return
    }
    this.#liveRefreshScheduled = true
    queueMicrotask(() => {
      this.#liveRefreshScheduled = false
      if (this.#liveListeners.size === 0) {
        return
      }
      const fingerprint = liveFingerprintOf(this.liveNodes())
      if (this.#liveStructureDirty) {
        // changed() already notified every live consumer. Establish one post-batch baseline without
        // turning N registrations into scans over 1..N mounted entries or emitting a second change.
        this.#liveStructureDirty = false
        this.#liveFingerprint = fingerprint
        return
      }
      if (fingerprint === this.#liveFingerprint) {
        return
      }
      this.#liveFingerprint = fingerprint
      this.#liveRevision += 1
      for (const listener of [...this.#liveListeners]) {
        listener()
      }
    })
  }

  /** clear empties the outline between checks, the way every other runtime registry resets. */
  clear(): void {
    this.#entries.clear()
    this.#coalesced.clear()
    this.#fingerprint = undefined
    this.#liveFingerprint = undefined
    this.#liveStructureDirty = false
    interactionMeasurements.clear()
    this.changed()
  }

  private changed(): void {
    if (this.#liveListeners.size === 0) {
      this.#liveFingerprint = undefined
      this.#liveStructureDirty = false
    } else {
      this.#liveStructureDirty = true
    }
    this.#liveRevision += 1
    for (const listener of [...this.#liveListeners]) {
      listener()
    }
    this.refreshLive()
    this.refresh()
  }

  private withdrawCoalesced(identity: string): void {
    const record = this.#coalesced.get(identity)
    if (!record) {
      return
    }
    record.refs -= 1
    if (record.refs > 0) {
      return
    }
    this.#coalesced.delete(identity)
    this.#entries.delete(record.key)
    this.changed()
  }
}

function fingerprintOf(snapshot: TaoOutlineSnapshot): string {
  return JSON.stringify(snapshot.nodes)
}

function liveFingerprintOf(nodes: readonly TaoOutlineLiveNode[]): string {
  return JSON.stringify(nodes.map(node => [
    node.identity,
    node.live?.active?.() ?? true,
    node.live?.enabled?.() ?? true,
    node.live?.modal ?? false,
    node.live?.primary ?? false,
  ]))
}

function entryDescendsFrom(
  entry: TaoOutlineEntry,
  ancestor: string,
  entries: readonly TaoOutlineEntry[],
): boolean {
  let parent = entry.parent
  while (parent !== undefined) {
    if (parent === ancestor) {
      return true
    }
    parent = entries.find(candidate => candidate.identity === parent)?.parent
  }
  return false
}

export const interactionOutline = new InteractionOutline()

/** resetInteractionOutline joins the test and launch boundaries beside the navigation reset. */
export function resetInteractionOutline(): void {
  interactionOutline.clear()
}

/** describeOutlineTable freezes one module's table and gives every node its module-qualified identity. */
export function describeOutlineTable<TableT extends TaoOutlineTable>(table: TableT): TaoOutlineDescribedTable<TableT> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(table.nodes).map(([key, descriptor]) => [
        key,
        Object.freeze({ ...descriptor, identity: `${table.module}#${key}` }),
      ]),
    ),
  ) as TaoOutlineDescribedTable<TableT>
}

/**
 * OutlineParentContext carries the nearest mounted outline node down the React tree, which is how
 * an item knows its collection, a control its row, and a collection the region it sits in.
 */
const OutlineParentContext = React.createContext<string | undefined>(undefined)

/** useOutlineParentIdentity exposes the mounted structural scope to interaction-owned hooks. */
export function useOutlineParentIdentity(): string | undefined {
  return React.useContext(OutlineParentContext)
}

/** OutlineScope provides one node's identity as the parent of everything rendered inside it. */
export function OutlineScope(props: { children?: React.ReactNode; identity: string | undefined }): React.ReactNode {
  return props.identity === undefined
    ? props.children
    : React.createElement(OutlineParentContext.Provider, { value: props.identity }, props.children)
}

let mountSequence = 0

/** useMountSequence gives one mounted hook site a number no other site shares for the process. */
function useMountSequence(): number {
  const sequence = React.useRef(0)
  if (sequence.current === 0) {
    sequence.current = ++mountSequence
  }
  return sequence.current
}

/** useRegisteredNode registers one entry for the lifetime of its identity and parent. */
function useRegisteredNode(entry: TaoOutlineEntry | undefined): void {
  const current = React.useRef(entry)
  current.current = entry
  const identity = entry?.identity
  const parent = entry?.parent
  React.useEffect(() => {
    if (identity === undefined) {
      return
    }
    const registered = current.current
    if (!registered) {
      return
    }
    // The registry reads through this record, so the readers a later render supplies are seen.
    const live: TaoOutlineEntry = {
      corpus: () => current.current?.corpus?.() ?? [],
      identity,
      kind: registered.kind,
      label: () => current.current?.label(),
      ...(registered.live === undefined ? {} : { live: liveEntry(current) }),
      ...(parent === undefined ? {} : { parent }),
      provenance: registered.provenance,
      ...(registered.testTag === undefined ? {} : { testTag: registered.testTag }),
    }
    if (registered.corpus === undefined) {
      delete live.corpus
    }
    return interactionOutline.register(live)
  }, [identity, parent])
  // A label the row re-rendered may have changed; the outline only looks when someone is listening.
  React.useEffect(() => {
    if (identity !== undefined) {
      interactionOutline.refresh()
      interactionOutline.refreshLive()
    }
  })
}

function useRegisteredCoalescedNode(entry: TaoOutlineEntry | undefined): void {
  const current = React.useRef(entry)
  current.current = entry
  const identity = entry?.identity
  React.useEffect(() => {
    const registered = current.current
    if (!registered || identity === undefined) {
      return
    }
    const mounted: TaoOutlineEntry = {
      corpus: () => current.current?.corpus?.() ?? [],
      identity,
      kind: registered.kind,
      label: () => current.current?.label(),
      ...(registered.live === undefined ? {} : { live: liveEntry(current) }),
      ...(registered.parent === undefined ? {} : { parent: registered.parent }),
      provenance: registered.provenance,
    }
    if (registered.corpus === undefined) {
      delete mounted.corpus
    }
    return interactionOutline.registerCoalesced(identity, mounted)
  }, [identity])
  React.useEffect(() => {
    if (identity !== undefined) {
      interactionOutline.refresh()
      interactionOutline.refreshLive()
    }
  })
}

function liveEntry(current: React.MutableRefObject<TaoOutlineEntry | undefined>): TaoOutlineLiveEntry {
  const live: TaoOutlineLiveEntry = {}
  for (
    const key of [
      'commandPolicy',
      'entityType',
      'modal',
      'primary',
      'runtimeValue',
    ] as const
  ) {
    Object.defineProperty(live, key, { enumerable: true, get: () => current.current?.live?.[key] })
  }
  for (
    const key of [
      'activate',
      'active',
      'blur',
      'enabled',
      'engage',
      'focus',
      'measure',
      'scrollIntoView',
    ] as const
  ) {
    Object.defineProperty(live, key, {
      enumerable: true,
      get: () => {
        const operation = current.current?.live?.[key] as ((...arguments_: never[]) => unknown) | undefined
        return operation === undefined ? undefined : (...arguments_: never[]) => operation(...arguments_)
      },
    })
  }
  return live
}

/** useOutlineCollection registers one mounted loop and returns the identity its rows hang under. */
export function useOutlineCollection(descriptor: TaoOutlineLoopNode | undefined): string | undefined {
  const parent = React.useContext(OutlineParentContext)
  const sequence = useMountSequence()
  const identity = descriptor ? `${descriptor.identity}#${sequence}` : undefined
  useRegisteredNode(
    descriptor && identity !== undefined
      ? {
        identity,
        kind: 'collection',
        label: () => descriptor.collection ?? descriptor.name,
        ...(parent === undefined ? {} : { parent }),
        provenance: {
          loop: descriptor.identity,
          ...(descriptor.entity === undefined ? {} : { entity: descriptor.entity }),
        },
        ...(descriptor.testTag === undefined ? {} : { testTag: descriptor.testTag }),
      }
      : undefined,
  )
  return identity
}

const rowRoots = new WeakMap<object, TaoOutlineRowRoot>()

/**
 * useOutlineItem registers one mounted row, with its identity from the collection and its stable
 * key, and returns the primary label the row carries to the platform right now.
 */
export function useOutlineItem(
  descriptor: TaoOutlineLoopNode | undefined,
  value: { evaluate(): { jsValue: unknown }; jsValue: unknown },
  key: number | string,
  index: number,
  activate?: () => unknown,
): { capabilities: TaoOutlineLiveEntry; identity: string | undefined; label: string | undefined } {
  const collection = React.useContext(OutlineParentContext)
  const identity = descriptor && collection !== undefined ? `${collection}/${String(key)}` : undefined
  const label = descriptor ? primaryLabel(descriptor, value.jsValue, index) : undefined
  const capabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  capabilities.activate = activate
  capabilities.measure = identity === undefined ? undefined : () => interactionMeasurements.read(identity)
  capabilities.commandPolicy = undefined
  capabilities.entityType = undefined
  capabilities.runtimeValue = undefined
  if (descriptor && label !== undefined && !descriptor.selectable && descriptor.root === 'single') {
    rowRoots.set(value, Object.freeze({ label }))
  }
  useRegisteredNode(
    descriptor && identity !== undefined
      ? (() => {
        const entity = DataControls.EntityInteraction(value.jsValue)
        return {
          corpus: () => labelCorpus(descriptor, value.jsValue),
          identity,
          kind: 'item',
          label: () => label,
          live: Object.assign(
            capabilities,
            entity === undefined
              ? {}
              : {
                commandPolicy: entity.policy,
                entityType: entity.entity,
                runtimeValue: value,
              },
          ),
          ...(collection === undefined ? {} : { parent: collection }),
          provenance: itemProvenance(descriptor, value.jsValue, key),
        }
      })()
      : undefined,
  )
  return { capabilities, identity, label }
}

function itemProvenance(descriptor: TaoOutlineLoopNode, value: unknown, key: number | string): TaoOutlineProvenance {
  const id = typeof value === 'object' && value !== null ? (value as { Id?: unknown }).Id : undefined
  return descriptor.entity !== undefined && typeof id === 'string'
    ? { entity: descriptor.entity, handle: id }
    : { key }
}

/** rowRootOf returns what the row that produced `value` hands the native root rendering it. */
export function rowRootOf(value: object): TaoOutlineRowRoot | undefined {
  return rowRoots.get(value)
}

/**
 * useOutlineOccurrence registers the control a generated view was rendered as, when its render site
 * wired an event. The outermost control in a caller chain is the one that exists: a view whose root
 * is itself a control renders one button, not two.
 */
export type TaoInteractionOccurrence = Readonly<{
  control?: string
  capabilities: TaoOutlineLiveEntry
  region?: string
  regionDeclaration?: string
  regionSubjects?: readonly string[]
  scope: string
}>

export function useOutlineOccurrence(
  props: TaoProps | undefined,
  owner?: TaoInteractionOccurrence,
): TaoInteractionOccurrence {
  const control = props?.interaction?.control
  const region = props?.interaction?.region
  const parent = React.useContext(OutlineParentContext)
  const sequence = useMountSequence()
  const wrapped = control !== undefined && controlInChain(props?.callerProps) !== undefined
  const scope = `view#${sequence}`
  const regionIdentity = region ? siblingRegionIdentity(region.identity, owner?.scope ?? parent ?? scope) : undefined
  const capabilities = React.useRef<TaoOutlineLiveEntry>({}).current
  const effectiveRegionIdentity = regionIdentity ?? owner?.region
  useRegisteredCoalescedNode(
    region && regionIdentity !== undefined
      ? {
        identity: regionIdentity,
        kind: 'region',
        label: () => region.label,
        live: { active: () => true },
        ...(parent === undefined ? {} : { parent }),
        provenance: { declaration: region.declaration, nav: region.nav, role: region.role },
      }
      : undefined,
  )
  const controlIdentity = control && !wrapped ? `${control.identity}#${sequence}` : undefined
  if (controlIdentity !== undefined) {
    capabilities.measure = () => interactionMeasurements.read(controlIdentity)
  }
  useRegisteredNode(
    control && controlIdentity !== undefined
      ? {
        identity: controlIdentity,
        kind: control.role,
        label: () => capabilities.label?.() ?? control.label ?? control.view,
        live: capabilities,
        ...((effectiveRegionIdentity ?? parent) === undefined ? {} : { parent: effectiveRegionIdentity ?? parent }),
        provenance: { occurrence: control.identity },
      }
      : undefined,
  )
  return {
    capabilities,
    ...(controlIdentity === undefined ? {} : { control: controlIdentity }),
    ...(regionIdentity === undefined
      ? {
        ...(owner?.region === undefined ? {} : { region: owner.region }),
        ...(owner?.regionDeclaration === undefined ? {} : { regionDeclaration: owner.regionDeclaration }),
        ...(owner?.regionSubjects === undefined ? {} : { regionSubjects: owner.regionSubjects }),
      }
      : {
        region: regionIdentity,
        regionDeclaration: region?.declaration,
        regionSubjects: region!.members,
      }),
    scope,
  }
}

/** siblingRegionIdentity coalesces roots within one owner occurrence and separates duplicate owners. */
export function siblingRegionIdentity(descriptor: string, ownerScope: string): string {
  return `${descriptor}#${ownerScope}`
}

function controlInChain(props: TaoProps | undefined): TaoOutlineControlNode | undefined {
  if (!props) {
    return undefined
  }
  return props.interaction?.control ?? controlInChain(props.callerProps)
}

/** useOutlineNode registers any handwritten node — a region — for as long as it is mounted. */
export function useOutlineNode(entry: Omit<TaoOutlineEntry, 'parent'> | undefined): string | undefined {
  const parent = React.useContext(OutlineParentContext)
  const sequence = useMountSequence()
  const identity = entry ? `${entry.identity}#${sequence}` : undefined
  useRegisteredNode(
    entry && identity !== undefined
      ? { ...entry, identity, ...(parent === undefined ? {} : { parent }) }
      : undefined,
  )
  return identity
}
