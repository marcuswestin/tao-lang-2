import { Arrays } from './core/RuntimeCore'
import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import {
  LayoutControls,
  LayoutRuntime,
  type TaoLayout,
  type TaoLayoutEntry,
  type TaoResolvedLayoutStyle,
} from './TR-layout'
import type { TaoScheme } from './TR-scheme'
import RuntimeSwitch from './TR-switch'

type TaoDesignSpecTerm = number | string
export type TaoDesignSpecEntry = readonly [string, ...TaoDesignSpecTerm[]]

export type TaoDesignSource = Readonly<{
  /** One stable object per generated source-module evaluation; old renders retain their object. */
  cohort?: object
  designEpochs?: Readonly<Record<string, number>>
  end?: number
  epoch?: number
  kind: 'declaration' | 'element-default' | 'inline' | 'legacy-style' | 'style' | 'text-style'
  member?: string
  path?: string
  start?: number
}>

type TaoStudioDesignSourceRange = Readonly<{ from: number; to: number }>

/** One compiler-authenticated padding edit within a published design source. */
export type TaoStudioDesignPaddingUpdate = Readonly<{
  bundleName: string
  designName: string
  entryIndex: number
  expectedPadding: number
  newLiteralRange: TaoStudioDesignSourceRange
  newSpecRange: TaoStudioDesignSourceRange
  oldLiteralRange: TaoStudioDesignSourceRange
  oldSpecRange: TaoStudioDesignSourceRange
  ownerKind: 'legacy' | 'styles' | 'text'
  padding: number
  sourcePath: string
}>

/** TaoDesignSpec preserves authored bundle and direct-clause order until a mounted app resolves it. */
export type TaoDesignSpec = Readonly<{
  entries: readonly TaoDesignSpecEntry[]
  source?: TaoDesignSource
}>

type TaoDesignColorValue =
  | TaoDesignColorAtom
  | Readonly<{
    environment: 'Scheme'
    expected: TaoScheme
    kind: 'conditional'
    negative: TaoDesignColorAtom
    positive: TaoDesignColorAtom
  }>

type TaoDesignColorAtom = Readonly<{ kind: 'reference'; path: string }> | string

type TaoDesignSizeAtom = Readonly<
  | { kind: 'dimension'; unit: 'px' | 'rem'; value: number }
  | { kind: 'reference'; path: string }
>

type TaoDesignSizeValue = Readonly<{
  left: TaoDesignSizeAtom
  right?: TaoDesignSizeAtom
}>

type TaoDesignScreen = Readonly<{ below?: number; name: string }>

export type TaoDesignDefinition = Readonly<{
  bundles: Readonly<Record<string, TaoDesignSpec>>
  colors?: Readonly<Record<string, TaoDesignColorValue>>
  name: string
  screens?: readonly TaoDesignScreen[]
  sizes?: Readonly<Record<string, TaoDesignSizeValue>>
  sources?: Readonly<Record<string, TaoDesignSource>>
  tokens: Readonly<Record<string, string>>
}>

/** TaoDesign is one immutable declaration-owned flat token and clause-bundle catalog. */
export type TaoDesign =
  & TaoDesignDefinition
  & Readonly<{
    evaluate(): TaoDesign
    readonly colors: Readonly<Record<string, TaoDesignColorValue>>
    readonly screens: readonly TaoDesignScreen[]
    readonly sizes: Readonly<Record<string, TaoDesignSizeValue>>
  }>

type TaoDesignProvenance = Readonly<{
  chain: readonly TaoDesignSource[]
  entry: TaoDesignSpecEntry
  property: string
}>

type TaoResolvedDesignSpec = Readonly<{
  layout?: TaoLayout
  provenance?: readonly TaoDesignProvenance[]
  style?: TaoResolvedLayoutStyle
}>

/** TaoDesignCondition reads occurrence-local interaction state during mounted design resolution. */
export type TaoDesignCondition = (subject: string, value: string | undefined) => boolean

// Mirrors `layoutHeads` in packages/language/ast-utils/ast-utils-src/design.ts.
const layoutHeads = new Set<TaoLayoutEntry[0]>([
  'aligned',
  'centered',
  'claim',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'margin',
  'pad',
  'rigid',
  'width',
])

const visualHeadValues = ['bg', 'border', 'fg', 'line', 'radius', 'size', 'weight'] as const
type TaoDesignVisualHead = typeof visualHeadValues[number]
const visualHeads = new Set<string>(visualHeadValues)

type PublishedDesign = {
  cohortSnapshots: WeakMap<object, Map<string, TaoDesign>>
  cohortWaiters: WeakMap<object, { promise: Promise<void>; resolve: () => void }>
  lastValid: WeakMap<object, TaoDesign>
  latest: TaoDesign
  listeners: Set<DesignListener>
  metadata?: TaoDesignPublication
  pendingListeners: Set<DesignListener>
  revision: number
  notificationQueued: boolean
  waiters: Map<number, { promise: Promise<void>; resolve: () => void }>
}

type DesignListener = Readonly<{ notify: () => void }>
type TaoDesignPublication = Readonly<{
  epoch: number
  path: string
  sourceEpochs: Readonly<Record<string, number>>
}>
type TaoDesignCohortSource = Readonly<{
  designEpochs: Readonly<Record<string, number>>
  epoch: number
  path: string
}>

const designIdentities = new WeakMap<TaoDesign, string>()
type DesignLookupShape = Readonly<{
  bundles: ReadonlyMap<string, string>
  colors: ReadonlyMap<string, string>
  key: string
  sizes: ReadonlyMap<string, string>
}>

const designLookupShapes = new WeakMap<TaoDesign, DesignLookupShape>()
const designPublications = new WeakMap<TaoDesign, TaoDesignPublication>()
const publishedDesigns = new Map<string, PublishedDesign>()
const cohortSources = new WeakMap<object, TaoDesignCohortSource>()
const liveCohorts = new Set<WeakRef<object>>()

function validStudioDesignPaddingUpdate(update: TaoStudioDesignPaddingUpdate): boolean {
  if (
    typeof update !== 'object' || update === null
    || typeof update.designName !== 'string'
    || typeof update.bundleName !== 'string'
    || typeof update.sourcePath !== 'string'
    || (update.ownerKind !== 'legacy' && update.ownerKind !== 'styles' && update.ownerKind !== 'text')
    || typeof update.entryIndex !== 'number'
    || typeof update.expectedPadding !== 'number'
    || typeof update.padding !== 'number'
    || typeof update.oldLiteralRange !== 'object' || update.oldLiteralRange === null
    || typeof update.newLiteralRange !== 'object' || update.newLiteralRange === null
    || typeof update.oldSpecRange !== 'object' || update.oldSpecRange === null
    || typeof update.newSpecRange !== 'object' || update.newSpecRange === null
  ) {
    return false
  }
  const { newLiteralRange, newSpecRange, oldLiteralRange, oldSpecRange } = update
  const rangeValid = (range: TaoStudioDesignSourceRange): boolean =>
    Number.isSafeInteger(range.from) && range.from >= 0
    && Number.isSafeInteger(range.to) && range.to >= range.from
  if (
    update.designName.trim().length === 0
    || update.bundleName.trim().length === 0
    || !(update.sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(update.sourcePath))
    || !Number.isSafeInteger(update.entryIndex) || update.entryIndex < 0
    || !Number.isFinite(update.expectedPadding) || update.expectedPadding < 0
    || !Number.isFinite(update.padding) || update.padding < 0
    || !rangeValid(oldLiteralRange) || !rangeValid(newLiteralRange)
    || !rangeValid(oldSpecRange) || !rangeValid(newSpecRange)
    || oldLiteralRange.to <= oldLiteralRange.from
    || newLiteralRange.to <= newLiteralRange.from
    || newLiteralRange.from !== oldLiteralRange.from
  ) {
    return false
  }
  const delta = newLiteralRange.to - oldLiteralRange.to
  if (!Number.isSafeInteger(delta)) {
    return false
  }
  return oldLiteralRange.from >= oldSpecRange.from
    && oldLiteralRange.to <= oldSpecRange.to
    && newLiteralRange.from >= newSpecRange.from
    && newLiteralRange.to <= newSpecRange.to
    && newSpecRange.from === oldSpecRange.from
    && newSpecRange.to === oldSpecRange.to + delta
}

function studioDesignOwnerSourceMatches(
  source: TaoDesignSource | undefined,
  update: TaoStudioDesignPaddingUpdate,
): boolean {
  const sourceKind = update.ownerKind === 'legacy'
    ? 'legacy-style'
    : update.ownerKind === 'styles'
    ? 'style'
    : 'text-style'
  return source?.path === update.sourcePath
    && source.member === update.bundleName
    && source.kind === sourceKind
    && source.start === update.oldSpecRange.from
    && source.end === update.oldSpecRange.to
}

function studioDesignOwnerMembershipIsUnique(
  design: TaoDesign,
  update: TaoStudioDesignPaddingUpdate,
): boolean {
  const bundleNames = new Set<string>()
  for (const [name, source] of Object.entries(design.sources ?? {})) {
    if (studioDesignOwnerIdentityMatches(source, update)) {
      bundleNames.add(name)
    }
  }
  for (const [name, spec] of Object.entries(design.bundles)) {
    if (studioDesignOwnerIdentityMatches(spec.source, update)) {
      bundleNames.add(name)
    }
  }
  return bundleNames.size === 1 && bundleNames.has(update.bundleName)
}

function studioDesignOwnerIdentityMatches(
  source: TaoDesignSource | undefined,
  update: TaoStudioDesignPaddingUpdate,
): boolean {
  const sourceKind = update.ownerKind === 'legacy'
    ? 'legacy-style'
    : update.ownerKind === 'styles'
    ? 'style'
    : 'text-style'
  return source?.path === update.sourcePath
    && source.member === update.bundleName
    && source.kind === sourceKind
}

function shiftStudioDesignSource(
  source: TaoDesignSource | undefined,
  update: TaoStudioDesignPaddingUpdate,
  delta: number,
): { source: TaoDesignSource | undefined; valid: boolean } {
  if (source === undefined || source.path !== update.sourcePath) {
    return { source, valid: true }
  }
  const shift = (offset: number | undefined): number | undefined => {
    if (offset === undefined) {
      return undefined
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      return Number.NaN
    }
    if (offset <= update.oldLiteralRange.from) {
      return offset
    }
    if (offset >= update.oldLiteralRange.to) {
      return offset + delta
    }
    return Number.NaN
  }
  const start = shift(source.start)
  const end = shift(source.end)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return { source, valid: false }
  }
  return {
    source: Object.freeze({
      ...source,
      ...(start === undefined ? {} : { start }),
      ...(end === undefined ? {} : { end }),
    }),
    valid: true,
  }
}

function shiftedDesignSources(
  sources: Readonly<Record<string, TaoDesignSource>> | undefined,
  update: TaoStudioDesignPaddingUpdate,
  delta: number,
): { sources: Readonly<Record<string, TaoDesignSource>> | undefined; valid: boolean } {
  if (sources === undefined) {
    return { sources, valid: true }
  }
  const shifted: Record<string, TaoDesignSource> = {}
  for (const [name, source] of Object.entries(sources)) {
    const result = shiftStudioDesignSource(source, update, delta)
    if (!result.valid || result.source === undefined) {
      return { sources, valid: false }
    }
    shifted[name] = result.source
  }
  return { sources: Object.freeze(shifted), valid: true }
}

/** Ignore changed literal values while retaining every name and reference a lookup can follow. */
function designLookupShape(design: TaoDesign): DesignLookupShape {
  const cached = designLookupShapes.get(design)
  if (cached !== undefined) {
    return cached
  }
  const atom = (value: TaoDesignColorAtom): unknown =>
    typeof value === 'string' ? value.startsWith('#') ? '#' : value : ['reference', value.path]
  const color = (value: TaoDesignColorValue): unknown =>
    typeof value === 'string' || value.kind === 'reference'
      ? atom(value)
      : ['conditional', value.environment, value.expected, atom(value.positive), atom(value.negative)]
  const sizeAtom = (value: TaoDesignSizeAtom): unknown =>
    value.kind === 'reference' ? ['reference', value.path] : ['dimension', value.unit]
  const bundles = new Map(
    Object.entries(design.bundles).map(([name, spec]) =>
      [
        name,
        JSON.stringify(
          spec.entries.map(entry =>
            entry.map(term => typeof term === 'number' ? 0 : term.startsWith('#') ? '#' : term)
          ),
        ),
      ] as const
    ),
  )
  const colors = new Map(
    Object.entries(design.colors).map(([name, value]) => [name, JSON.stringify(color(value))] as const),
  )
  const sizes = new Map(
    Object.entries(design.sizes).map(([name, value]) =>
      [
        name,
        JSON.stringify([sizeAtom(value.left), value.right === undefined ? undefined : sizeAtom(value.right)]),
      ] as const
    ),
  )
  const sorted = (components: ReadonlyMap<string, string>): readonly (readonly [string, string])[] =>
    Arrays.sorted([...components], ([a], [b]) => a.localeCompare(b))
  const shape = { bundles, colors, key: JSON.stringify([sorted(bundles), sorted(colors), sorted(sizes)]), sizes }
  designLookupShapes.set(design, shape)
  return shape
}

function designShapeDominates(newer: DesignLookupShape, older: DesignLookupShape): boolean {
  const includes = (next: ReadonlyMap<string, string>, prior: ReadonlyMap<string, string>): boolean =>
    [...prior].every(([name, value]) => next.get(name) === value)
  return includes(newer.bundles, older.bundles)
    && includes(newer.colors, older.colors)
    && includes(newer.sizes, older.sizes)
}

/** Keep incomparable lookup shapes; one later structural superset replaces every shape it covers. */
function retainDesignCandidate(candidates: Map<string, TaoDesign>, design: TaoDesign): void {
  const shape = designLookupShape(design)
  const epoch = designPublications.get(design)?.epoch ?? 0
  for (const [key, prior] of candidates) {
    const priorShape = designLookupShape(prior)
    const priorEpoch = designPublications.get(prior)?.epoch ?? 0
    if (priorEpoch === epoch && priorShape.key === shape.key) {
      candidates.set(key, design)
      return
    }
    if (priorEpoch < epoch && designShapeDominates(shape, priorShape)) {
      candidates.delete(key)
    } else if (priorEpoch > epoch && designShapeDominates(priorShape, shape)) {
      return
    }
  }
  candidates.set(shape.key, design)
}

function publishedDesign(design: TaoDesign | undefined): PublishedDesign | undefined {
  const identity = design === undefined ? undefined : designIdentities.get(design)
  return identity === undefined ? undefined : publishedDesigns.get(identity)
}

function seedCohort(
  published: PublishedDesign,
  cohort: object,
  source: TaoDesignCohortSource,
  design = published.latest,
  metadata = published.metadata,
): void {
  if (!metadata) {
    return
  }
  const expected = source.designEpochs[metadata.path]
  if (expected === undefined || expected > metadata.epoch) {
    return
  }
  if (expected === metadata.epoch || source.epoch === metadata.sourceEpochs[source.path]) {
    let snapshots = published.cohortSnapshots.get(cohort)
    if (snapshots === undefined) {
      snapshots = new Map()
      published.cohortSnapshots.set(cohort, snapshots)
    }
    retainDesignCandidate(snapshots, design)
    const waiter = published.cohortWaiters.get(cohort)
    if (waiter) {
      published.cohortWaiters.delete(cohort)
      waiter.resolve()
    }
  }
}

function seedLiveCohorts(published: PublishedDesign, design = published.latest, metadata = published.metadata): void {
  for (const reference of liveCohorts) {
    const cohort = reference.deref()
    if (cohort === undefined) {
      liveCohorts.delete(reference)
      continue
    }
    const source = cohortSources.get(cohort)
    if (source) {
      seedCohort(published, cohort, source, design, metadata)
    }
  }
}

function pruneDeadCohorts(): void {
  for (const reference of liveCohorts) {
    if (reference.deref() === undefined) {
      liveCohorts.delete(reference)
    }
  }
}

function designsForSource(design: TaoDesign | undefined, source?: TaoDesignSource): readonly (TaoDesign | undefined)[] {
  const published = publishedDesign(design)
  const metadata = published?.metadata
  if (!published || !metadata || !source) {
    return [published?.latest ?? design]
  }
  const expected = source.designEpochs?.[metadata.path]
  if (expected === undefined) {
    return [published.latest]
  }
  if (expected > metadata.epoch) {
    let waiter = published.waiters.get(expected)
    if (waiter === undefined) {
      let resolve!: () => void
      const promise = new Promise<void>(ready => {
        resolve = ready
      })
      waiter = { promise, resolve }
      published.waiters.set(expected, waiter)
    }
    throw waiter.promise
  }
  const candidates = new Map<string, TaoDesign>()
  const add = (snapshot: TaoDesign | undefined): void => {
    if (snapshot === undefined) {
      return
    }
    const publication = designPublications.get(snapshot)
    if (
      publication !== undefined && publication.epoch >= expected
      && (publication.epoch === expected || source.path !== undefined
          && source.epoch === publication.sourceEpochs[source.path])
    ) {
      retainDesignCandidate(candidates, snapshot)
    }
  }
  add(published.latest)
  if (source.cohort !== undefined) {
    for (const snapshot of published.cohortSnapshots.get(source.cohort)?.values() ?? []) {
      add(snapshot)
    }
    add(published.lastValid.get(source.cohort))
  }
  add(design)
  if (candidates.size > 0) {
    return Arrays.sorted(
      [...candidates.values()],
      (a, b) => (designPublications.get(b)?.epoch ?? 0) - (designPublications.get(a)?.epoch ?? 0),
    )
  }
  if (source.cohort !== undefined && cohortSources.has(source.cohort)) {
    let waiter = published.cohortWaiters.get(source.cohort)
    if (waiter === undefined) {
      let resolve!: () => void
      const promise = new Promise<void>(ready => {
        resolve = ready
      })
      waiter = { promise, resolve }
      published.cohortWaiters.set(source.cohort, waiter)
    }
    throw waiter.promise
  }
  return [published.latest]
}

function designForSource(design: TaoDesign | undefined, source?: TaoDesignSource): TaoDesign | undefined {
  return designsForSource(design, source)[0]
}

function recordResolvedDesign(design: TaoDesign | undefined, source: TaoDesignSource | undefined): void {
  const published = publishedDesign(design)
  if (!published || !design || source?.cohort === undefined) {
    return
  }
  published.lastValid.set(source.cohort, design)
}

/** DesignControls is the generated-code and runtime surface for minimal Tao design declarations. */
export const DesignControls = {
  Declaration(definition: TaoDesignDefinition, identity?: string, metadata?: TaoDesignPublication): TaoDesign {
    const snapshot = new RuntimeDesign(definition)
    if (identity !== undefined) {
      designIdentities.set(snapshot, identity)
      if (metadata !== undefined) {
        designPublications.set(snapshot, metadata)
      }
      const published = publishedDesigns.get(identity)
      if (published === undefined) {
        const entry: PublishedDesign = {
          cohortSnapshots: new WeakMap(),
          cohortWaiters: new WeakMap(),
          lastValid: new WeakMap(),
          latest: snapshot,
          listeners: new Set(),
          metadata,
          pendingListeners: new Set(),
          revision: 1,
          notificationQueued: false,
          waiters: new Map(),
        }
        publishedDesigns.set(identity, entry)
        seedLiveCohorts(entry)
      } else {
        if (
          metadata !== undefined && published.metadata !== undefined
          && metadata.epoch < published.metadata.epoch
        ) {
          seedLiveCohorts(published, snapshot, metadata)
          return snapshot
        }
        published.latest = snapshot
        published.metadata = metadata
        seedLiveCohorts(published)
        if (metadata !== undefined) {
          for (const [epoch, waiter] of published.waiters) {
            if (metadata.epoch >= epoch) {
              published.waiters.delete(epoch)
              waiter.resolve()
            }
          }
        }
        published.revision++
        // A refreshed design can publish before its importing view finishes evaluating. Keep
        // snapshots current immediately, then notify mounted readers after this module turn.
        for (const listener of published.listeners) {
          published.pendingListeners.add(listener)
        }
        if (!published.notificationQueued && published.pendingListeners.size > 0) {
          published.notificationQueued = true
          queueMicrotask(() => {
            published.notificationQueued = false
            const pending = published.pendingListeners
            published.pendingListeners = new Set()
            for (const listener of pending) {
              if (published.listeners.has(listener)) {
                listener.notify()
              }
            }
          })
        }
      }
    }
    return snapshot
  },

  /** Apply one compiler-authenticated padding overlay within the named design source. */
  patchStudioPadding(update: TaoStudioDesignPaddingUpdate): boolean {
    if (!validStudioDesignPaddingUpdate(update)) {
      return false
    }
    const matches = [...publishedDesigns.entries()].filter(([, published]) =>
      published.latest.name === update.designName && published.metadata?.path === update.sourcePath
    )
    if (matches.length !== 1) {
      return false
    }
    const [identity, published] = matches[0]!
    const latest = published.latest
    const bundle = latest.bundles[update.bundleName]
    const metadata = published.metadata
    const provenance = [latest.sources?.[update.bundleName], bundle?.source]
      .filter((source): source is TaoDesignSource => source !== undefined)
    if (
      bundle === undefined
      || metadata === undefined
      || provenance.length === 0
      || !studioDesignOwnerMembershipIsUnique(latest, update)
      || provenance.some(source => !studioDesignOwnerSourceMatches(source, update))
    ) {
      return false
    }
    const entry = bundle.entries[update.entryIndex]
    if (
      entry === undefined
      || entry[0] !== 'pad'
      || entry.length !== 2
      || entry[1] !== update.expectedPadding
    ) {
      return false
    }
    const delta = update.newLiteralRange.to - update.oldLiteralRange.to
    const sourceUpdate = shiftedDesignSources(latest.sources, update, delta)
    if (!sourceUpdate.valid) {
      return false
    }
    const bundles: Record<string, TaoDesignSpec> = {}
    for (const [name, current] of Object.entries(latest.bundles)) {
      const sourceUpdate = shiftStudioDesignSource(current.source, update, delta)
      if (!sourceUpdate.valid) {
        return false
      }
      const entries = name !== update.bundleName
        ? current.entries
        : current.entries.map((currentEntry, index) =>
          index === update.entryIndex
            ? ['pad', update.padding] as TaoDesignSpecEntry
            : currentEntry
        )
      bundles[name] = sourceUpdate.source === current.source && entries === current.entries
        ? current
        : DesignControls.Spec(entries, sourceUpdate.source)
    }
    const definition: TaoDesignDefinition = {
      bundles: Object.freeze(bundles),
      colors: latest.colors,
      name: latest.name,
      screens: latest.screens,
      sizes: latest.sizes,
      ...(sourceUpdate.sources === undefined ? {} : { sources: sourceUpdate.sources }),
      tokens: latest.tokens,
    }
    DesignControls.Declaration(definition, identity, metadata)
    return true
  },

  current(design: TaoDesign | undefined): TaoDesign | undefined {
    return publishedDesign(design)?.latest ?? design
  },

  /** Register one generated source-module evaluation before its views first render. */
  Cohort(source: TaoDesignCohortSource): object {
    const cohort = Object.freeze({})
    cohortSources.set(cohort, source)
    pruneDeadCohorts()
    liveCohorts.add(new WeakRef(cohort))
    for (const published of publishedDesigns.values()) {
      seedCohort(published, cohort, source)
    }
    return cohort
  },

  /** Pick the design generation that was valid for this rendered source file. */
  forSource(design: TaoDesign | undefined, source?: TaoDesignSource): TaoDesign | undefined {
    return designForSource(design, source)
  },

  /** Candidate snapshots remain available to readers that must inspect every compatible cohort shape. */
  forSourceCandidates(design: TaoDesign | undefined, source?: TaoDesignSource): readonly (TaoDesign | undefined)[] {
    return designsForSource(design, source)
  },

  revision(design: TaoDesign | undefined): number {
    return publishedDesign(design)?.revision ?? 0
  },

  subscribe(design: TaoDesign | undefined, listener: () => void): () => void {
    const published = publishedDesign(design)
    if (published === undefined) {
      return () => {}
    }
    const subscription = { notify: listener }
    published.listeners.add(subscription)
    return () => {
      published.listeners.delete(subscription)
    }
  },

  Spec(entries: readonly TaoDesignSpecEntry[], source?: TaoDesignSource): TaoDesignSpec {
    return Object.freeze({
      entries: Object.freeze([...entries]),
      ...(source === undefined ? {} : { source: Object.freeze({ ...source }) }),
    })
  },

  Source(spec: TaoDesignSpec, source: TaoDesignSource): TaoDesignSpec {
    return DesignControls.Spec(spec.entries, source)
  },

  resolve,
  withSelected,
} as const

/**
 * withSelected answers the bare `selected` condition from what the element's host marked, and every
 * other condition from the occurrence's interaction state. An element no host marks is never selected.
 */
function withSelected(
  interaction: TaoDesignCondition | undefined,
  selected: boolean | undefined,
): TaoDesignCondition | undefined {
  if (selected === undefined) {
    return interaction
  }
  return (subject, value) =>
    subject === 'selected' && value === undefined ? selected : interaction?.(subject, value) === true
}

class RuntimeDesign implements TaoDesign {
  readonly bundles: Readonly<Record<string, TaoDesignSpec>>
  readonly colors: Readonly<Record<string, TaoDesignColorValue>>
  readonly name: string
  readonly screens: readonly TaoDesignScreen[]
  readonly sizes: Readonly<Record<string, TaoDesignSizeValue>>
  readonly sources?: Readonly<Record<string, TaoDesignSource>>
  readonly tokens: Readonly<Record<string, string>>

  constructor(definition: TaoDesignDefinition) {
    this.bundles = Object.freeze(Object.fromEntries(
      Object.entries(definition.bundles).map(([name, spec]) => [
        name,
        definition.sources?.[name] === undefined ? spec : DesignControls.Source(spec, definition.sources[name]!),
      ]),
    ))
    this.colors = Object.freeze({ ...definition.tokens, ...definition.colors })
    this.name = definition.name
    this.screens = Object.freeze([...(definition.screens ?? [])])
    this.sizes = Object.freeze({ ...definition.sizes })
    this.sources = definition.sources === undefined
      ? undefined
      : Object.freeze(Object.fromEntries(
        Object.entries(definition.sources).map(([name, source]) => [
          name,
          Object.freeze({ ...source }),
        ]),
      ))
    this.tokens = Object.freeze({ ...definition.tokens })
    Object.freeze(this)
  }

  evaluate(): TaoDesign {
    return this
  }
}

function resolve(
  design: TaoDesign | undefined,
  spec: TaoDesignSpec | undefined,
  elementDefault?: string,
  scheme: TaoScheme = 'light',
  condition?: TaoDesignCondition,
  declarationSpec?: TaoDesignSpec,
  consumerSource?: TaoDesignSource,
): TaoResolvedDesignSpec {
  const defaultSpec = elementDefault === undefined || design === undefined
    ? undefined
    : DesignControls.Spec([[elementDefault]], {
      ...consumerSource,
      kind: 'element-default',
      member: elementDefault,
    })
  const headerSpec = declarationSpec === undefined || declarationSpec.entries.length === 0
    ? undefined
    : declarationSpec.source === undefined
    ? DesignControls.Source(declarationSpec, { ...consumerSource, kind: 'declaration' })
    : declarationSpec
  if (defaultSpec === undefined && headerSpec === undefined && (!spec || spec.entries.length === 0)) {
    return {}
  }

  const layoutEntries: TaoLayoutEntry[] = []
  const style: TaoResolvedLayoutStyle = {}
  const provenance: TaoDesignProvenance[] = []
  // A declaration's header clause is the view's own public default: the stdlib element default is
  // weaker still, and the caller's render-site clauses beat both.
  for (const effectiveSpec of [defaultSpec, headerSpec, spec]) {
    if (effectiveSpec === undefined) {
      continue
    }
    const layerSource = effectiveSpec.source ?? consumerSource
    const candidates = designsForSource(design, layerSource)
    for (const [index, layerDesign] of candidates.entries()) {
      if (effectiveSpec === defaultSpec && layerDesign?.bundles[elementDefault!] === undefined) {
        continue
      }
      const layerLayoutEntries: TaoLayoutEntry[] = []
      const layerStyle: TaoResolvedLayoutStyle = {}
      const layerProvenance: TaoDesignProvenance[] = []
      try {
        for (const expanded of expandEntries(layerDesign, effectiveSpec, [], scheme, condition, [])) {
          const entry = resolveSizeTerms(layerDesign, expanded.entry)
          const head = entry[0]
          if (layoutHeads.has(head as TaoLayoutEntry[0])) {
            layerLayoutEntries.push(entry as TaoLayoutEntry)
            layerProvenance.push({ chain: expanded.chain, entry, property: head })
            continue
          }
          if (!isVisualEntry(entry)) {
            throw new UserInputError(`Unknown design clause '${entry.join(' ')}'.`, { entry })
          }
          applyVisualEntry(layerStyle, layerDesign, entry, scheme)
          layerProvenance.push({ chain: expanded.chain, entry, property: visualProperty(head) })
        }
      } catch (error) {
        if (
          error instanceof UserInputError && error.details?.['designLookup'] === true && index < candidates.length - 1
        ) {
          continue
        }
        throw error
      }
      layoutEntries.push(...layerLayoutEntries)
      Object.assign(style, layerStyle)
      provenance.push(...layerProvenance)
      recordResolvedDesign(layerDesign, layerSource)
      break
    }
  }

  const layout = layoutEntries.length > 0 ? LayoutControls.create(layoutEntries) : undefined
  // One spec's own contradiction is worth reporting where it was written, even though the whole
  // occurrence is only checked once every layer has met, in LayoutRuntime.resolveProps.
  LayoutRuntime.assertCompatibleEntries(layout?.entries ?? [])

  return {
    ...(layout ? { layout } : {}),
    ...(provenance.some(item => item.chain.some(source => source.path !== undefined))
      ? { provenance: Object.freeze(provenance) }
      : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
  }
}

function* expandEntries(
  design: TaoDesign | undefined,
  spec: TaoDesignSpec,
  bundlePath: readonly string[],
  scheme: TaoScheme,
  condition: TaoDesignCondition | undefined,
  sourceChain: readonly TaoDesignSource[],
): Generator<{ chain: readonly TaoDesignSource[]; entry: TaoDesignSpecEntry }> {
  const chain = spec.source === undefined ? sourceChain : [...sourceChain, spec.source]
  for (const authoredEntry of spec.entries) {
    const entry = activeConditionEntry(authoredEntry, scheme, condition)
    if (entry === undefined) {
      continue
    }
    const head = entry[0]
    if (layoutHeads.has(head as TaoLayoutEntry[0]) || isVisualHead(head)) {
      yield { chain, entry }
      continue
    }
    // Design resolution runs on every render, so the guards whose message joins an array stay behind
    // an `if`: a `RuntimeAssert` call would build that message on every successful resolve.
    if (entry.length !== 1) {
      throw new UserInputError(`Unknown design clause '${entry.join(' ')}'.`, { entry })
    }
    RuntimeAssert.input(design, `Design bundle '${head}' requires a mounted app design.`, { bundle: head })
    const bundle = design.bundles[head]
    RuntimeAssert.input(bundle, `Design '${design.name}' has no bundle '${head}'.`, {
      design: design.name,
      designLookup: true,
    })
    if (bundlePath.includes(head)) {
      throw new UserInputError(`Design '${design.name}' has a bundle cycle: ${[...bundlePath, head].join(' -> ')}.`, {
        design: design.name,
      })
    }
    yield* expandEntries(design, bundle, [...bundlePath, head], scheme, condition, chain)
  }
}

function activeConditionEntry(
  entry: TaoDesignSpecEntry,
  scheme: TaoScheme,
  read: TaoDesignCondition | undefined,
): TaoDesignSpecEntry | undefined {
  const conditionIndex = entry.indexOf('when')
  if (conditionIndex === -1) {
    return entry
  }
  const suffix = entry.slice(conditionIndex)
  if (
    conditionIndex > 0
    && suffix.length === 2
    && suffix[0] === 'when'
    && typeof suffix[1] === 'string'
  ) {
    return read?.(suffix[1], undefined)
      ? entry.slice(0, conditionIndex) as unknown as TaoDesignSpecEntry
      : undefined
  }
  if (
    conditionIndex > 0
    && suffix.length === 4
    && suffix[0] === 'when'
    && typeof suffix[1] === 'string'
    && suffix[2] === 'is'
    && suffix[3] === 'active'
    && suffix[1] !== 'Scheme'
  ) {
    return read?.(suffix[1], suffix[3])
      ? entry.slice(0, conditionIndex) as unknown as TaoDesignSpecEntry
      : undefined
  }
  if (
    conditionIndex === 0
    || suffix.length !== 4
    || suffix[0] !== 'when'
    || suffix[1] !== 'Scheme'
    || suffix[2] !== 'is'
    || (suffix[3] !== 'Dark' && suffix[3] !== 'Light')
  ) {
    throw new UserInputError(`Unsupported design condition '${entry.join(' ')}'.`, { entry })
  }
  const required = suffix[3] === 'Dark' ? 'dark' : 'light'
  return required === scheme ? entry.slice(0, conditionIndex) as unknown as TaoDesignSpecEntry : undefined
}

function applyVisualEntry(
  style: TaoResolvedLayoutStyle,
  design: TaoDesign | undefined,
  entry: TaoDesignSpecEntry & readonly [TaoDesignVisualHead, ...TaoDesignSpecTerm[]],
  scheme: TaoScheme,
): void {
  const head = entry[0]
  // `bg none` clears the slot instead of setting one, so every head names its style keys once and
  // a cleared value is `undefined` rather than a second table of keys to delete.
  const cleared = isClearingEntry(entry)
  RuntimeSwitch<TaoDesignVisualHead, void>(head, {
    bg: () => {
      assignVisualStyle(style, 'backgroundColor', cleared ? undefined : resolveColorToken(design, entry, scheme))
    },
    border: () => {
      assignVisualStyle(style, 'borderColor', cleared ? undefined : resolveColorToken(design, entry, scheme))
      assignVisualStyle(style, 'borderWidth', cleared ? undefined : 1)
    },
    fg: () => {
      assignVisualStyle(style, 'color', cleared ? undefined : resolveColorToken(design, entry, scheme))
    },
    line: () => {
      assignVisualStyle(style, 'lineHeight', cleared ? undefined : numericVisualValue(entry))
    },
    radius: () => {
      assignVisualStyle(style, 'borderRadius', cleared ? undefined : numericVisualValue(entry))
    },
    size: () => {
      assignVisualStyle(style, 'fontSize', cleared ? undefined : numericVisualValue(entry))
    },
    weight: () => {
      assignVisualStyle(style, 'fontWeight', cleared ? undefined : String(fontWeightValue(entry)))
    },
  })
}

/** isClearingEntry reads the decided `none` form: one `none` and nothing else after the head. */
function isClearingEntry(entry: TaoDesignSpecEntry): boolean {
  return entry.length === 2 && entry[1] === 'none'
}

/**
 * A cleared key is written as an explicit `undefined` rather than deleted: the layer that set it may
 * be another link's element default or a caller's clause, resolved on its own and merged later, so
 * the clear has to outlive this spec to reach it. The final merge drops the key.
 */
function assignVisualStyle(
  style: TaoResolvedLayoutStyle,
  key: string,
  value: number | string | undefined,
): void {
  style[key] = value
}

function isVisualHead(head: string): head is TaoDesignVisualHead {
  return visualHeads.has(head)
}

function isVisualEntry(
  entry: TaoDesignSpecEntry,
): entry is readonly [TaoDesignVisualHead, ...TaoDesignSpecTerm[]] {
  return isVisualHead(entry[0])
}

function resolveColorToken(design: TaoDesign | undefined, entry: TaoDesignSpecEntry, scheme: TaoScheme): string {
  const tokenName = entry.length === 2 && typeof entry[1] === 'string' ? entry[1] : undefined
  RuntimeAssert.input(tokenName, `Design clause '${entry[0]}' expects one color token.`, { entry })
  if (tokenName.startsWith('#')) {
    return tokenName
  }
  RuntimeAssert.input(design, `Design token '${tokenName}' requires a mounted app design.`, { token: tokenName })
  const color = resolveColor(design, tokenName, scheme, [])
  RuntimeAssert.input(color, `Design '${design.name}' has no token '${tokenName}'.`, {
    design: design.name,
    designLookup: true,
  })
  return color
}

function resolveColor(
  design: TaoDesign,
  path: string,
  scheme: TaoScheme,
  resolving: readonly string[],
): string | undefined {
  if (resolving.includes(path)) {
    throw new UserInputError(`Design '${design.name}' has a color cycle: ${[...resolving, path].join(' -> ')}.`, {
      design: design.name,
    })
  }
  const value = design.colors[path]
  if (typeof value === 'string') {
    return value.startsWith('#') ? value : resolveColor(design, value, scheme, [...resolving, path])
  }
  if (value === undefined) {
    return undefined
  }
  if (value.kind === 'reference') {
    return resolveColor(design, value.path, scheme, [...resolving, path])
  }
  const atom = value.expected === scheme ? value.positive : value.negative
  return typeof atom === 'string'
    ? atom
    : resolveColor(design, atom.path, scheme, [...resolving, path])
}

function resolveSizeTerms(design: TaoDesign | undefined, entry: TaoDesignSpecEntry): TaoDesignSpecEntry {
  if (design === undefined) {
    return entry
  }
  const head = entry[0]
  const sizeIndexes = head === 'gap' || head === 'line' || head === 'radius' || head === 'size'
    ? [1]
    : head === 'pad' || head === 'margin'
    ? (entry.length === 2 ? [1] : entry.map((_, index) => index).filter(index => index >= 2 && index % 2 === 0))
    : head === 'width' || head === 'height'
    ? (entry[1] === 'max' ? [2] : [1])
    : []
  return entry.map((term, index) => {
    // `none` clears the slot further down instead of naming a size, so it passes through untouched.
    if (!sizeIndexes.includes(index) || typeof term !== 'string' || term === 'fill' || term === 'none') {
      return term
    }
    // Multi-app validation deliberately defers private design lookup to the mounted occurrence.
    // Resolve every named term here so a design missing that size fails instead of leaking a
    // string into the numeric layout engine.
    return resolveSize(design, term, [])
  }) as unknown as TaoDesignSpecEntry
}

function resolveSize(design: TaoDesign, path: string, resolving: readonly string[]): number {
  if (resolving.includes(path)) {
    throw new UserInputError(`Design '${design.name}' has a size cycle: ${[...resolving, path].join(' -> ')}.`, {
      design: design.name,
    })
  }
  const value = design.sizes[path]
  RuntimeAssert.input(value, `Design '${design.name}' has no size '${path}'.`, {
    design: design.name,
    designLookup: true,
    size: path,
  })
  return sizeAtom(design, value.left, [...resolving, path])
    + (value.right === undefined ? 0 : sizeAtom(design, value.right, [...resolving, path]))
}

function sizeAtom(design: TaoDesign, atom: TaoDesignSizeAtom, resolving: readonly string[]): number {
  return atom.kind === 'reference'
    ? resolveSize(design, atom.path, resolving)
    : atom.value * (atom.unit === 'rem' ? 16 : 1)
}

function visualProperty(head: string): string {
  return ({ bg: 'background', border: 'border', fg: 'foreground' } as Record<string, string>)[head] ?? head
}

function numericVisualValue(entry: TaoDesignSpecEntry): number {
  if (entry.length !== 2 || typeof entry[1] !== 'number') {
    throw new UserInputError(`Design clause '${entry[0]}' expects one number.`, { entry })
  }
  return entry[1]
}

function fontWeightValue(entry: TaoDesignSpecEntry): number {
  const symbolic = entry.length === 2 && typeof entry[1] === 'string'
    ? ({ bold: 700, medium: 500, regular: 400, semibold: 600 } as Record<string, number>)[entry[1]]
    : undefined
  return symbolic ?? numericVisualValue(entry)
}
