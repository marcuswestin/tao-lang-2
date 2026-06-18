import { Switch } from '@shared/core'

export type TaoLayoutDirection = 'column' | 'row'
export type TaoLayoutTermValue = number | string
export type TaoLayoutEntry = readonly TaoLayoutTermValue[]
export type TaoLayoutStyleValue = number | string
export type TaoResolvedLayoutStyle = Record<string, TaoLayoutStyleValue>
export type TaoLayout = readonly TaoLayoutEntry[]

export type TaoLayoutSpec = {
  readonly direction?: TaoLayoutDirection
  readonly entries: readonly TaoLayoutEntry[]
  readonly parentDirection?: TaoLayoutDirection
}

type LayoutContext = {
  readonly direction?: TaoLayoutDirection
  readonly parentDirection?: TaoLayoutDirection
}

const layoutEntryHeadValues = [
  'aligned',
  'centered',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'pad',
  'rigid',
  'width',
] as const

const contentValueTermValues = [
  'baseline',
  'bottom',
  'left',
  'right',
  'spread',
  'spread-balanced',
  'spread-inset',
  'stretch',
  'top',
] as const

const alignmentTermValues = [
  'baseline',
  'bottom',
  'center',
  'left',
  'right',
  'top',
] as const

const paddingSideValues = [
  'bottom',
  'horizontal',
  'left',
  'right',
  'top',
  'vertical',
] as const

type LayoutEntryHead = typeof layoutEntryHeadValues[number]
type ContentValueTerm = typeof contentValueTermValues[number]
type AlignmentTerm = typeof alignmentTermValues[number]
type PaddingSide = typeof paddingSideValues[number]

const layoutEntryHeads = new Set<string>(layoutEntryHeadValues)
const contentValueTerms = new Set<string>(contentValueTermValues)
const alignmentTerms = new Set<string>(alignmentTermValues)
const paddingSides = new Set<string>(paddingSideValues)

/** LayoutControls exposes the generated-code layout runtime surface. */
export const LayoutControls = {
  create,
  resolve,
} as const

function create(entries: readonly TaoLayoutEntry[]): TaoLayout {
  return entries
}

function resolve(spec: TaoLayoutSpec): TaoResolvedLayoutStyle {
  const style: TaoResolvedLayoutStyle = {}
  const direction = spec.direction
  const context: LayoutContext = { direction, parentDirection: spec.parentDirection }

  if (direction) {
    style['flexDirection'] = direction
  }

  for (const entry of spec.entries) {
    applyEntry(style, entry, context)
  }

  return style
}

function applyEntry(style: TaoResolvedLayoutStyle, entry: TaoLayoutEntry, context: LayoutContext): void {
  const head = layoutEntryHead(stringTerm(entry[0]))
  if (!head) {
    return
  }

  const terms = entry.slice(1)
  Switch(head, {
    aligned: () => {
      applyAligned(style, stringTerm(terms[0]))
    },
    centered: () => {
      style['alignSelf'] = 'center'
    },
    compress: () => {
      style['flexShrink'] = 1
    },
    content: () => {
      applyContent(style, terms, context.direction)
    },
    fill: () => {
      applyFill(style)
    },
    gap: () => {
      applyGap(style, terms[0])
    },
    height: () => {
      applyDimension(style, 'height', terms[0], context.parentDirection, 'column')
    },
    hug: () => {
      applyHug(style)
    },
    pad: () => {
      applyPadding(style, terms)
    },
    rigid: () => {
      style['flexShrink'] = 0
    },
    width: () => {
      applyDimension(style, 'width', terms[0], context.parentDirection, 'row')
    },
  })
}

function applyContent(
  style: TaoResolvedLayoutStyle,
  terms: readonly TaoLayoutTermValue[],
  direction: TaoLayoutDirection | undefined,
): void {
  if (!direction) {
    return
  }

  let main: string | undefined
  let cross: string | undefined
  const centerTerms: string[] = []
  for (const termValue of terms) {
    const term = stringTerm(termValue)
    if (!term) {
      continue
    }
    if (term === 'center') {
      centerTerms.push(term)
      continue
    }

    const slot = contentSlot(term, direction)
    const value = contentValue(term)
    if (!slot || !value) {
      continue
    }
    if (slot === 'main') {
      main = value
    } else {
      cross = value
    }
  }

  if (centerTerms.length === 1 && main === undefined && cross === undefined) {
    main = 'center'
    cross = 'center'
  }
  for (let index = 0; index < centerTerms.length; index += 1) {
    if (main === undefined) {
      main = 'center'
      continue
    }
    if (cross === undefined) {
      cross = 'center'
    }
  }

  if (main !== undefined) {
    style['justifyContent'] = main
  }
  if (cross !== undefined) {
    style['alignItems'] = cross
  }
}

function applyGap(style: TaoResolvedLayoutStyle, term: TaoLayoutTermValue | undefined): void {
  if (typeof term === 'number') {
    style['gap'] = term
  }
}

function applyPadding(style: TaoResolvedLayoutStyle, terms: readonly TaoLayoutTermValue[]): void {
  if (terms.length === 1 && typeof terms[0] === 'number') {
    style['padding'] = terms[0]
    return
  }

  for (let index = 0; index < terms.length; index += 2) {
    const side = stringTerm(terms[index])
    const amount = terms[index + 1]
    if (!side || typeof amount !== 'number') {
      continue
    }
    for (const property of paddingProperties(side)) {
      style[property] = amount
    }
  }
}

function applyDimension(
  style: TaoResolvedLayoutStyle,
  dimension: 'height' | 'width',
  term: TaoLayoutTermValue | undefined,
  parentDirection: TaoLayoutDirection | undefined,
  mainAxisDirection: TaoLayoutDirection,
): void {
  if (typeof term === 'number') {
    style[dimension] = term
    return
  }
  if (term === 'fill') {
    if (parentDirection === mainAxisDirection) {
      style['flexGrow'] = 1
      return
    }
    if (parentDirection) {
      style['alignSelf'] = 'stretch'
    }
  }
}

function applyFill(style: TaoResolvedLayoutStyle): void {
  style['alignSelf'] = 'stretch'
  style['flexGrow'] = 1
}

function applyHug(style: TaoResolvedLayoutStyle): void {
  style['flexGrow'] = 0
}

function applyAligned(style: TaoResolvedLayoutStyle, term: string | undefined): void {
  const value = alignmentValue(term)
  if (value) {
    style['alignSelf'] = value
  }
}

function contentSlot(term: string, direction: TaoLayoutDirection): 'cross' | 'main' | undefined {
  if (term === 'baseline' || term === 'stretch') {
    return 'cross'
  }
  if (term === 'spread' || term === 'spread-balanced' || term === 'spread-inset') {
    return 'main'
  }
  if (term === 'left' || term === 'right') {
    return direction === 'row' ? 'main' : 'cross'
  }
  if (term === 'bottom' || term === 'top') {
    return direction === 'column' ? 'main' : 'cross'
  }
  return undefined
}

function contentValue(term: string): string | undefined {
  const valueTerm = contentValueTerm(term)
  return valueTerm
    ? Switch(valueTerm, {
      baseline: () => 'baseline',
      bottom: () => 'flex-end',
      left: () => 'flex-start',
      right: () => 'flex-end',
      spread: () => 'space-between',
      'spread-balanced': () => 'space-evenly',
      'spread-inset': () => 'space-around',
      stretch: () => 'stretch',
      top: () => 'flex-start',
    })
    : undefined
}

function alignmentValue(term: string | undefined): string | undefined {
  const alignmentTerm = term ? alignmentTermValue(term) : undefined
  return alignmentTerm
    ? Switch(alignmentTerm, {
      baseline: () => 'baseline',
      bottom: () => 'flex-end',
      center: () => 'center',
      left: () => 'flex-start',
      right: () => 'flex-end',
      top: () => 'flex-start',
    })
    : undefined
}

function paddingProperties(side: string): readonly string[] {
  const paddingSide = paddingSideValue(side)
  return paddingSide
    ? Switch(paddingSide, {
      bottom: () => ['paddingBottom'],
      horizontal: () => ['paddingLeft', 'paddingRight'],
      left: () => ['paddingLeft'],
      right: () => ['paddingRight'],
      top: () => ['paddingTop'],
      vertical: () => ['paddingTop', 'paddingBottom'],
    })
    : []
}

function stringTerm(term: TaoLayoutTermValue | undefined): string | undefined {
  return typeof term === 'string' ? term : undefined
}

function layoutEntryHead(term: string | undefined): LayoutEntryHead | undefined {
  return term && layoutEntryHeads.has(term) ? term as LayoutEntryHead : undefined
}

function contentValueTerm(term: string): ContentValueTerm | undefined {
  return contentValueTerms.has(term) ? term as ContentValueTerm : undefined
}

function alignmentTermValue(term: string): AlignmentTerm | undefined {
  return alignmentTerms.has(term) ? term as AlignmentTerm : undefined
}

function paddingSideValue(side: string): PaddingSide | undefined {
  return paddingSides.has(side) ? side as PaddingSide : undefined
}
