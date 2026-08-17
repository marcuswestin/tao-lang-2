import { LayoutControls, type TaoLayout, type TaoLayoutEntry, type TaoResolvedLayoutStyle } from './TR-layout'
import RuntimeSwitch from './TR-switch'

export type TaoDesignSpecTerm = number | string
export type TaoDesignSpecEntry = readonly [string, ...TaoDesignSpecTerm[]]

/** TaoDesignSpec preserves authored bundle and direct-clause order until a mounted app resolves it. */
export type TaoDesignSpec = Readonly<{
  entries: readonly TaoDesignSpecEntry[]
}>

export type TaoDesignDefinition = Readonly<{
  bundles: Readonly<Record<string, TaoDesignSpec>>
  name: string
  tokens: Readonly<Record<string, string>>
}>

/** TaoDesign is one immutable declaration-owned flat token and clause-bundle catalog. */
export type TaoDesign =
  & TaoDesignDefinition
  & Readonly<{
    evaluate(): TaoDesign
  }>

export type TaoResolvedDesignSpec = Readonly<{
  layout?: TaoLayout
  style?: TaoResolvedLayoutStyle
}>

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

  Spec(entries: readonly TaoDesignSpecEntry[]): TaoDesignSpec {
    return Object.freeze({ entries: Object.freeze([...entries]) })
  },

  resolve,
} as const

class RuntimeDesign implements TaoDesign {
  readonly bundles: Readonly<Record<string, TaoDesignSpec>>
  readonly name: string
  readonly tokens: Readonly<Record<string, string>>

  constructor(definition: TaoDesignDefinition) {
    this.bundles = Object.freeze({ ...definition.bundles })
    this.name = definition.name
    this.tokens = Object.freeze({ ...definition.tokens })
    Object.freeze(this)
  }

  evaluate(): TaoDesign {
    return this
  }
}

function resolve(design: TaoDesign | undefined, spec: TaoDesignSpec | undefined): TaoResolvedDesignSpec {
  if (!spec || spec.entries.length === 0) {
    return {}
  }

  const layoutEntries: TaoLayoutEntry[] = []
  const style: TaoResolvedLayoutStyle = {}
  for (const entry of expandEntries(design, spec, [])) {
    const head = entry[0]
    if (layoutHeads.has(head as TaoLayoutEntry[0])) {
      layoutEntries.push(entry as TaoLayoutEntry)
      continue
    }
    if (!isVisualEntry(entry)) {
      throw new Error(`Unknown design clause '${entry.join(' ')}'.`)
    }
    applyVisualEntry(style, design, entry)
  }

  const layout = layoutEntries.length > 0 ? LayoutControls.create(layoutEntries) : undefined
  assertEffectiveLayoutCompatibility(layout)

  return {
    ...(layout ? { layout } : {}),
    ...(Object.keys(style).length > 0 ? { style } : {}),
  }
}

function assertEffectiveLayoutCompatibility(layout: TaoLayout | undefined): void {
  const entries = layout?.entries ?? []
  const growth = entries.findLast(entry => ['fill', 'claim', 'hug'].includes(entry[0]))
  const shrink = entries.findLast(entry => ['compress', 'rigid'].includes(entry[0]))
  if (growth?.[0] === 'claim' && shrink?.[0] === 'rigid') {
    throw new Error("Design entries 'claim' and 'rigid' cannot remain effective together.")
  }
}

function* expandEntries(
  design: TaoDesign | undefined,
  spec: TaoDesignSpec,
  bundlePath: readonly string[],
): Generator<TaoDesignSpecEntry> {
  for (const entry of spec.entries) {
    const head = entry[0]
    if (layoutHeads.has(head as TaoLayoutEntry[0]) || isVisualHead(head)) {
      yield entry
      continue
    }
    if (entry.length !== 1) {
      throw new Error(`Unknown design clause '${entry.join(' ')}'.`)
    }
    if (!design) {
      throw new Error(`Design bundle '${head}' requires a mounted app design.`)
    }
    const bundle = design.bundles[head]
    if (!bundle) {
      throw new Error(`Design '${design.name}' has no bundle '${head}'.`)
    }
    if (bundlePath.includes(head)) {
      throw new Error(`Design '${design.name}' has a bundle cycle: ${[...bundlePath, head].join(' -> ')}.`)
    }
    yield* expandEntries(design, bundle, [...bundlePath, head])
  }
}

function applyVisualEntry(
  style: TaoResolvedLayoutStyle,
  design: TaoDesign | undefined,
  entry: TaoDesignSpecEntry & readonly [TaoDesignVisualHead, ...TaoDesignSpecTerm[]],
): void {
  const head = entry[0]
  RuntimeSwitch<TaoDesignVisualHead, void>(head, {
    bg: () => {
      style['backgroundColor'] = resolveColorToken(design, entry)
    },
    border: () => {
      style['borderColor'] = resolveColorToken(design, entry)
      style['borderWidth'] = 1
    },
    fg: () => {
      style['color'] = resolveColorToken(design, entry)
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
      style['fontWeight'] = String(numericVisualValue(entry))
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

function resolveColorToken(design: TaoDesign | undefined, entry: TaoDesignSpecEntry): string {
  const tokenName = entry.length === 2 && typeof entry[1] === 'string' ? entry[1] : undefined
  if (!tokenName) {
    throw new Error(`Design clause '${entry[0]}' expects one color token.`)
  }
  if (!design) {
    throw new Error(`Design token '${tokenName}' requires a mounted app design.`)
  }
  const color = design.tokens[tokenName]
  if (!color) {
    throw new Error(`Design '${design.name}' has no token '${tokenName}'.`)
  }
  return color
}

function numericVisualValue(entry: TaoDesignSpecEntry): number {
  if (entry.length !== 2 || typeof entry[1] !== 'number') {
    throw new Error(`Design clause '${entry[0]}' expects one number.`)
  }
  return entry[1]
}
