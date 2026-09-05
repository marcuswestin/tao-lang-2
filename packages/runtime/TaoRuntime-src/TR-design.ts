import { RuntimeAssert } from './TR-assert'
import { UserInputError } from './TR-errors'
import { LayoutControls, type TaoLayout, type TaoLayoutEntry, type TaoResolvedLayoutStyle } from './TR-layout'
import type { TaoScheme } from './TR-scheme'
import RuntimeSwitch from './TR-switch'

export type TaoDesignSpecTerm = number | string
export type TaoDesignSpecEntry = readonly [string, ...TaoDesignSpecTerm[]]

export type TaoDesignSource = Readonly<{
  end?: number
  kind: 'element-default' | 'inline' | 'legacy-style' | 'style' | 'text-style'
  member?: string
  path?: string
  start?: number
}>

/** TaoDesignSpec preserves authored bundle and direct-clause order until a mounted app resolves it. */
export type TaoDesignSpec = Readonly<{
  entries: readonly TaoDesignSpecEntry[]
  source?: TaoDesignSource
}>

export type TaoDesignColorValue =
  | TaoDesignColorAtom
  | Readonly<{
    environment: 'Scheme'
    expected: TaoScheme
    kind: 'conditional'
    negative: TaoDesignColorAtom
    positive: TaoDesignColorAtom
  }>

export type TaoDesignColorAtom = Readonly<{ kind: 'reference'; path: string }> | string

export type TaoDesignSizeAtom = Readonly<
  | { kind: 'dimension'; unit: 'px' | 'rem'; value: number }
  | { kind: 'reference'; path: string }
>

export type TaoDesignSizeValue = Readonly<{
  left: TaoDesignSizeAtom
  right?: TaoDesignSizeAtom
}>

export type TaoDesignScreen = Readonly<{ below?: number; name: string }>

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

export type TaoDesignProvenance = Readonly<{
  chain: readonly TaoDesignSource[]
  entry: TaoDesignSpecEntry
  property: string
}>

export type TaoResolvedDesignSpec = Readonly<{
  layout?: TaoLayout
  provenance?: readonly TaoDesignProvenance[]
  style?: TaoResolvedLayoutStyle
}>

/** TaoDesignCondition reads occurrence-local interaction state during mounted design resolution. */
export type TaoDesignCondition = (subject: string, value: string | undefined) => boolean

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

/** DesignControls is the generated-code and runtime surface for minimal Tao design declarations. */
export const DesignControls = {
  Declaration(definition: TaoDesignDefinition): TaoDesign {
    return new RuntimeDesign(definition)
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
} as const

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
): TaoResolvedDesignSpec {
  const defaultSpec = elementDefault === undefined || design?.bundles[elementDefault] === undefined
    ? undefined
    : DesignControls.Spec([[elementDefault]], { kind: 'element-default', member: elementDefault })
  if (defaultSpec === undefined && (!spec || spec.entries.length === 0)) {
    return {}
  }

  const layoutEntries: TaoLayoutEntry[] = []
  const style: TaoResolvedLayoutStyle = {}
  const provenance: TaoDesignProvenance[] = []
  for (const effectiveSpec of [defaultSpec, spec]) {
    if (effectiveSpec === undefined) {
      continue
    }
    for (const expanded of expandEntries(design, effectiveSpec, [], scheme, condition, [])) {
      const entry = resolveSizeTerms(design, expanded.entry)
      const head = entry[0]
      if (layoutHeads.has(head as TaoLayoutEntry[0])) {
        layoutEntries.push(entry as TaoLayoutEntry)
        provenance.push({ chain: expanded.chain, entry, property: head })
        continue
      }
      if (!isVisualEntry(entry)) {
        throw new UserInputError(`Unknown design clause '${entry.join(' ')}'.`, { entry })
      }
      applyVisualEntry(style, design, entry, scheme)
      provenance.push({ chain: expanded.chain, entry, property: visualProperty(head) })
    }
  }

  const layout = layoutEntries.length > 0 ? LayoutControls.create(layoutEntries) : undefined
  assertEffectiveLayoutCompatibility(layout)

  return {
    ...(layout ? { layout } : {}),
    ...(provenance.some(item => item.chain.some(source => source.path !== undefined))
      ? { provenance: Object.freeze(provenance) }
      : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
  }
}

function assertEffectiveLayoutCompatibility(layout: TaoLayout | undefined): void {
  const entries = layout?.entries ?? []
  const growth = entries.findLast(entry => ['fill', 'claim', 'hug'].includes(entry[0]))
  const shrink = entries.findLast(entry => ['compress', 'rigid'].includes(entry[0]))
  RuntimeAssert.input(
    growth?.[0] !== 'claim' || shrink?.[0] !== 'rigid',
    "Design entries 'claim' and 'rigid' cannot remain effective together.",
  )
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
  RuntimeSwitch<TaoDesignVisualHead, void>(head, {
    bg: () => {
      style['backgroundColor'] = resolveColorToken(design, entry, scheme)
    },
    border: () => {
      style['borderColor'] = resolveColorToken(design, entry, scheme)
      style['borderWidth'] = 1
    },
    fg: () => {
      style['color'] = resolveColorToken(design, entry, scheme)
    },
    line: () => {
      style['lineHeight'] = numericVisualValue(entry)
    },
    radius: () => {
      style['borderRadius'] = numericVisualValue(entry)
    },
    size: () => {
      style['fontSize'] = numericVisualValue(entry)
    },
    weight: () => {
      style['fontWeight'] = String(fontWeightValue(entry))
    },
  })
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
    if (!sizeIndexes.includes(index) || typeof term !== 'string' || term === 'fill') {
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
