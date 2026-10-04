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
  cohortEpochs: WeakMap<object, number>
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
const designPublications = new WeakMap<TaoDesign, TaoDesignPublication>()
const publishedDesigns = new Map<string, PublishedDesign>()
const cohortSources = new WeakMap<object, TaoDesignCohortSource>()
const liveCohorts = new Set<WeakRef<object>>()

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
    if (metadata.epoch < (published.cohortEpochs.get(cohort) ?? 0)) {
      return
    }
    published.lastValid.set(cohort, design)
    published.cohortEpochs.set(cohort, metadata.epoch)
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

function designForSource(design: TaoDesign | undefined, source?: TaoDesignSource): TaoDesign | undefined {
  const published = publishedDesign(design)
  const metadata = published?.metadata
  if (!published || !metadata || !source) {
    return published?.latest ?? design
  }
  const expected = source.designEpochs?.[metadata.path]
  if (expected === undefined) {
    return published.latest
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
  if (
    expected === metadata.epoch || source.path !== undefined
      && source.epoch === metadata.sourceEpochs[source.path]
  ) {
    return published.latest
  }
  const original = design === undefined ? undefined : designPublications.get(design)
  const lastValid = source.cohort === undefined ? undefined : published.lastValid.get(source.cohort)
  if (lastValid) {
    return lastValid
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
  return original?.epoch === expected ? design : published.latest
}

function recordResolvedDesign(design: TaoDesign | undefined, source: TaoDesignSource | undefined): void {
  const published = publishedDesign(design)
  if (!published || !design || source?.cohort === undefined) {
    return
  }
  published.lastValid.set(source.cohort, design)
  const epoch = designPublications.get(design)?.epoch
  if (epoch !== undefined) {
    published.cohortEpochs.set(source.cohort, epoch)
  }
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
          cohortEpochs: new WeakMap(),
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
    const layerDesign = designForSource(design, layerSource)
    if (effectiveSpec === defaultSpec && layerDesign?.bundles[elementDefault!] === undefined) {
      continue
    }
    for (const expanded of expandEntries(layerDesign, effectiveSpec, [], scheme, condition, [])) {
      const entry = resolveSizeTerms(layerDesign, expanded.entry)
      const head = entry[0]
      if (layoutHeads.has(head as TaoLayoutEntry[0])) {
        layoutEntries.push(entry as TaoLayoutEntry)
        provenance.push({ chain: expanded.chain, entry, property: head })
        continue
      }
      if (!isVisualEntry(entry)) {
        throw new UserInputError(`Unknown design clause '${entry.join(' ')}'.`, { entry })
      }
      applyVisualEntry(style, layerDesign, entry, scheme)
      provenance.push({ chain: expanded.chain, entry, property: visualProperty(head) })
    }
    recordResolvedDesign(layerDesign, layerSource)
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
    RuntimeAssert.input(bundle, `Design '${design.name}' has no bundle '${head}'.`, { design: design.name })
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
  RuntimeAssert.input(color, `Design '${design.name}' has no token '${tokenName}'.`, { design: design.name })
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
  RuntimeAssert.input(value, `Design '${design.name}' has no size '${path}'.`, { design: design.name, size: path })
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
