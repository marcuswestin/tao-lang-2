import RuntimeSwitch from '../TR-switch'
import { LayoutTerms } from './LayoutTerms'
import type {
  TaoLayoutAlignedEntry,
  TaoLayoutClaimEntry,
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

type LayoutSemanticState = {
  bareFillAlignment: boolean
  bareFillGrowth: boolean
}

/** LayoutResolve lowers Tao layout entries into deterministic React Native style objects. */
export const LayoutResolve = {
  resolve,
} as const

function resolve(spec: TaoLayoutSpec): TaoResolvedLayoutStyle {
  const style: TaoResolvedLayoutStyle = {}
  const direction = spec.direction
  const context: LayoutContext = { direction, parentDirection: spec.parentDirection }
  const state: LayoutSemanticState = { bareFillAlignment: false, bareFillGrowth: false }

  if (direction) {
    style['flexDirection'] = direction
  }

  for (const entry of spec.entries) {
    applyEntry(style, entry, context, state)
  }

  return style
}

function applyEntry(
  style: TaoResolvedLayoutStyle,
  entry: TaoLayoutEntry,
  context: LayoutContext,
  state: LayoutSemanticState,
): void {
  return RuntimeSwitch<TaoLayoutEntry[0], void>(entry[0], {
    aligned: () => {
      state.bareFillAlignment = false
      applyAligned(style, entry as TaoLayoutAlignedEntry)
    },
    centered: () => {
      state.bareFillAlignment = false
      style['alignSelf'] = 'center'
    },
    claim: () => {
      state.bareFillGrowth = false
      applyClaim(style, entry as TaoLayoutClaimEntry)
    },
    compress: () => {
      style['flexShrink'] = 1
    },
    content: () => applyContent(style, entry as TaoLayoutContentEntry, context.direction),
    fill: () => {
      state.bareFillAlignment = true
      state.bareFillGrowth = true
      style['alignSelf'] = 'stretch'
      style['flexGrow'] = 1
    },
    gap: () => applyGap(style, entry as TaoLayoutGapEntry),
    height: () => applyDimension(style, entry as TaoLayoutDimensionEntry, context.parentDirection, 'column', state),
    hug: () => {
      state.bareFillGrowth = false
      style['flexGrow'] = 0
    },
    margin: () => applySpacing(style, 'margin', entry as TaoLayoutSpacingEntry),
    pad: () => applySpacing(style, 'padding', entry as TaoLayoutSpacingEntry),
    rigid: () => {
      style['flexShrink'] = 0
    },
    width: () => applyDimension(style, entry as TaoLayoutDimensionEntry, context.parentDirection, 'row', state),
  })
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
    RuntimeSwitch(slot, {
      main: () => {
        main = value
      },
      cross: () => {
        cross = value
      },
    })
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
  if (entry[1] === 'none') {
    return
  }
  style['gap'] = entry[1]
}

function applyClaim(style: TaoResolvedLayoutStyle, entry: TaoLayoutClaimEntry): void {
  style['flexGrow'] = entry[1]
}

function applySpacing(
  style: TaoResolvedLayoutStyle,
  propertyPrefix: 'margin' | 'padding',
  entry: TaoLayoutSpacingEntry,
): void {
  const firstTerm = entry[1]
  // A cleared slot lowers to nothing at all: the merge already dropped every layer that set it.
  if (firstTerm === 'none') {
    return
  }
  if (typeof firstTerm === 'number') {
    style[propertyPrefix] = firstTerm
    return
  }

  for (const [side, amount] of LayoutTerms.spacingPairs(entry)) {
    if (amount === 'none') {
      continue
    }
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
  state: LayoutSemanticState,
): void {
  const [dimension, term] = entry
  if (term === 'none') {
    return
  }
  if (dimension === 'width' && term === 'max') {
    // A centered cross-axis child needs an explicit fluid width because centering disables the
    // parent's default stretch. On a row's main axis, 100% would instead over-claim sibling space.
    if (parentDirection !== mainAxisDirection) {
      style['width'] = '100%'
    }
    style['maxWidth'] = entry[2]
    return
  }
  if (typeof term === 'number') {
    replaceBareFillEffect(style, state, parentDirection, mainAxisDirection)
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

function replaceBareFillEffect(
  style: TaoResolvedLayoutStyle,
  state: LayoutSemanticState,
  parentDirection: TaoLayoutDirection | undefined,
  dimensionDirection: TaoLayoutDirection,
): void {
  if (parentDirection === dimensionDirection && state.bareFillGrowth) {
    delete style['flexGrow']
    state.bareFillGrowth = false
    return
  }
  if (parentDirection && state.bareFillAlignment) {
    delete style['alignSelf']
    state.bareFillAlignment = false
  }
}

function applyAligned(style: TaoResolvedLayoutStyle, entry: TaoLayoutAlignedEntry): void {
  style['alignSelf'] = LayoutTerms.alignmentValue(entry[1])
}

function layoutEntryTerms(entry: TaoLayoutContentEntry): readonly TaoLayoutContentTerm[] {
  return entry.slice(1) as readonly TaoLayoutContentTerm[]
}
