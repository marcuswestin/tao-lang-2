import { LayoutTerms } from './LayoutTerms'
import type {
  TaoLayoutAlignedEntry,
  TaoLayoutContentEntry,
  TaoLayoutContentTerm,
  TaoLayoutDimensionEntry,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoLayoutGapEntry,
  TaoLayoutSpacingEntry,
  TaoLayoutSpec,
  TaoResolvedLayoutStyle,
} from './LayoutTypes'

type LayoutContext = {
  readonly direction?: TaoLayoutDirection
  readonly parentDirection?: TaoLayoutDirection
}

/** LayoutResolve lowers Tao layout entries into deterministic React Native style objects. */
export const LayoutResolve = {
  resolve,
} as const

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
  switch (entry[0]) {
    case 'aligned':
      applyAligned(style, entry)
      break
    case 'centered':
      style['alignSelf'] = 'center'
      break
    case 'compress':
      style['flexShrink'] = 1
      break
    case 'content':
      applyContent(style, entry, context.direction)
      break
    case 'fill':
      style['alignSelf'] = 'stretch'
      style['flexGrow'] = 1
      break
    case 'gap':
      applyGap(style, entry)
      break
    case 'height':
      applyDimension(style, entry, context.parentDirection, 'column')
      break
    case 'hug':
      style['flexGrow'] = 0
      break
    case 'margin':
      applySpacing(style, 'margin', entry)
      break
    case 'pad':
      applySpacing(style, 'padding', entry)
      break
    case 'rigid':
      style['flexShrink'] = 0
      break
    case 'width':
      applyDimension(style, entry, context.parentDirection, 'row')
      break
    default: {
      const exhaustive: never = entry
      return exhaustive
    }
  }
}

function applyContent(
  style: TaoResolvedLayoutStyle,
  entry: TaoLayoutContentEntry,
  direction: TaoLayoutDirection | undefined,
): void {
  if (!direction) {
    return
  }

  let main: string | undefined
  let cross: string | undefined
  const centerTerms: 'center'[] = []
  for (const term of layoutEntryTerms(entry)) {
    if (term === 'center') {
      centerTerms.push(term)
      continue
    }

    const slot = LayoutTerms.contentSlot(term, direction)
    const value = LayoutTerms.contentValue(term)
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

function applyGap(style: TaoResolvedLayoutStyle, entry: TaoLayoutGapEntry): void {
  style['gap'] = entry[1]
}

function applySpacing(
  style: TaoResolvedLayoutStyle,
  propertyPrefix: 'margin' | 'padding',
  entry: TaoLayoutSpacingEntry,
): void {
  const firstTerm = entry[1]
  if (typeof firstTerm === 'number') {
    style[propertyPrefix] = firstTerm
    return
  }

  for (const [side, amount] of LayoutTerms.spacingPairs(entry)) {
    for (const property of LayoutTerms.spacingProperties(propertyPrefix, side)) {
      style[property] = amount
    }
  }
}

function applyDimension(
  style: TaoResolvedLayoutStyle,
  entry: TaoLayoutDimensionEntry,
  parentDirection: TaoLayoutDirection | undefined,
  mainAxisDirection: TaoLayoutDirection,
): void {
  const [dimension, term] = entry
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

function applyAligned(style: TaoResolvedLayoutStyle, entry: TaoLayoutAlignedEntry): void {
  style['alignSelf'] = LayoutTerms.alignmentValue(entry[1])
}

function layoutEntryTerms(entry: TaoLayoutContentEntry): readonly TaoLayoutContentTerm[] {
  return entry.slice(1) as readonly TaoLayoutContentTerm[]
}
