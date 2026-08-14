import { Switch } from '@shared/core'
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
  return Switch<TaoLayoutEntry[0], void>(entry[0], {
    aligned: () => applyAligned(style, entry as TaoLayoutAlignedEntry),
    centered: () => {
      style['alignSelf'] = 'center'
    },
    claim: () => applyClaim(style, entry as TaoLayoutClaimEntry),
    compress: () => {
      style['flexShrink'] = 1
    },
    content: () => applyContent(style, entry as TaoLayoutContentEntry, context.direction),
    fill: () => {
      style['alignSelf'] = 'stretch'
      style['flexGrow'] = 1
    },
    gap: () => applyGap(style, entry as TaoLayoutGapEntry),
    height: () => applyDimension(style, entry as TaoLayoutDimensionEntry, context.parentDirection, 'column'),
    hug: () => {
      style['flexGrow'] = 0
    },
    margin: () => applySpacing(style, 'margin', entry as TaoLayoutSpacingEntry),
    pad: () => applySpacing(style, 'padding', entry as TaoLayoutSpacingEntry),
    rigid: () => {
      style['flexShrink'] = 0
    },
    width: () => applyDimension(style, entry as TaoLayoutDimensionEntry, context.parentDirection, 'row'),
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
    Switch(slot, {
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
