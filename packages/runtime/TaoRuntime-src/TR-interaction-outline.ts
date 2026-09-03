import React from 'react'
import { DataControls, type TaoEntityCommandPolicy } from './TR-data'
import { labelCorpus, primaryLabel } from './TR-interaction-labels'
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
  texts: readonly TaoOutlineTextPath[]
}>

/** TaoOutlineControlDescriptor is what the compiler emitted for one render that wires an event. */
export type TaoOutlineControlDescriptor = Readonly<{
  declaration: string
  kind: 'control'
  label?: string
  role: 'action' | 'input'
  /** view is the rendered view's name, the label of last resort for a control the site left unnamed. */
  view: string
}>

/** A sibling region groups the concrete roots beside one nav without adding a native wrapper. */
export type TaoOutlineSiblingRegionDescriptor = Readonly<{
  declaration: string
  kind: 'region'
  label?: string
  members: readonly string[]
  nav: string
  role: 'nav-siblings'
}>

export type TaoOutlineDescriptor =
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
export type TaoOutlineDescribed<DescriptorT extends TaoOutlineDescriptor> = DescriptorT & Readonly<{ identity: string }>
export type TaoOutlineLoopNode = TaoOutlineDescribed<TaoOutlineLoopDescriptor>
export type TaoOutlineControlNode = TaoOutlineDescribed<TaoOutlineControlDescriptor>
export type TaoOutlineSiblingRegionNode = TaoOutlineDescribed<TaoOutlineSiblingRegionDescriptor>
/** The described table keeps each key's exact node type, so a site reads the node kind it references. */
export type TaoOutlineDescribedTable<TableT extends TaoOutlineTable = TaoOutlineTable> = {
  readonly [KeyT in keyof TableT['nodes']]: TaoOutlineDescribed<TableT['nodes'][KeyT]>
}

export type TaoOutlineNodeKind = 'action' | 'collection' | 'input' | 'item' | 'region'
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
  live?: TaoOutlineLiveEntry
}

export type TaoInteractionBounds = Readonly<{ height: number; width: number; x: number; y: number }>

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
  measure?(): TaoInteractionBounds | undefined
  modal?: boolean
  primary?: boolean
  runtimeValue?: { evaluate(): { jsValue: unknown } }
  scrollIntoView?(): void
}

/** TaoOutlineLiveNode is the ordered mounted record consumed only by the attention reducer. */
export type TaoOutlineLiveNode =
  & TaoOutlineEntry
  & Readonly<{
    mount: number
    order: number
  }>

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
  #sequence = 0
  #revision = 0
  #fingerprint: string | undefined
  #refreshScheduled = false

  readonly snapshot = (): number => this.#revision

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

  /** subscribeLive observes structure and capability changes independently of public snapshots. */
  subscribeLive(listener: () => void): () => void {
    this.#liveListeners.add(listener)
    return () => this.#liveListeners.delete(listener)
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

  /** clear empties the outline between checks, the way every other runtime registry resets. */
  clear(): void {
    this.#entries.clear()
    this.#coalesced.clear()
    this.#fingerprint = undefined
    this.changed()
  }

  private changed(): void {
    for (const listener of [...this.#liveListeners]) {
      listener()
    }
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
): { identity: string | undefined; label: string | undefined } {
  const collection = React.useContext(OutlineParentContext)
  const identity = descriptor && collection !== undefined ? `${collection}/${String(key)}` : undefined
  const label = descriptor ? primaryLabel(descriptor, value.jsValue, index) : undefined
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
          live: {
            ...(activate === undefined ? {} : { activate }),
            ...(entity === undefined
              ? {}
              : {
                commandPolicy: entity.policy,
                entityType: entity.entity,
                runtimeValue: value,
              }),
          },
          ...(collection === undefined ? {} : { parent: collection }),
          provenance: itemProvenance(descriptor, value.jsValue, key),
        }
      })()
      : undefined,
  )
  return { identity, label }
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
  useRegisteredNode(
    control && controlIdentity !== undefined
      ? {
        identity: controlIdentity,
        kind: control.role,
        label: () => control.label ?? control.view,
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
