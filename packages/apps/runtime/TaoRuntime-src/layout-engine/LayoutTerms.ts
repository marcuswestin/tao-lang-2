import RuntimeSwitch from '../TR-switch'
import type {
  TaoLayoutAlignmentTerm,
  TaoLayoutContentTerm,
  TaoLayoutDirection,
  TaoLayoutPhysicalSpacingSide,
  TaoLayoutSpacingAmount,
  TaoLayoutSpacingEntry,
  TaoLayoutSpacingSide,
} from './LayoutTypes'

type TaoLayoutContentDirectionalTerm = Exclude<TaoLayoutContentTerm, 'center'>
type TaoLayoutSpacingPair = readonly [TaoLayoutSpacingSide, TaoLayoutSpacingAmount]

/** LayoutTerms resolves compact parsed layout terms into runtime semantic slots and style values. */
export const LayoutTerms = {
  alignmentValue,
  contentSlot,
  contentValue,
  physicalSpacingSides,
  spacingPairs,
  spacingProperties,
} as const

function contentSlot(term: TaoLayoutContentDirectionalTerm, direction: TaoLayoutDirection): 'cross' | 'main' {
  return RuntimeSwitch(term, {
    baseline: () => 'cross',
    bottom: () => direction === 'column' ? 'main' : 'cross',
    left: () => direction === 'row' ? 'main' : 'cross',
    right: () => direction === 'row' ? 'main' : 'cross',
    spread: () => 'main',
    'spread-balanced': () => 'main',
    'spread-inset': () => 'main',
    stretch: () => 'cross',
    top: () => direction === 'column' ? 'main' : 'cross',
  })
}

function contentValue(term: TaoLayoutContentTerm): string {
  return RuntimeSwitch(term, {
    baseline: () => 'baseline',
    bottom: () => 'flex-end',
    center: () => 'center',
    left: () => 'flex-start',
    right: () => 'flex-end',
    spread: () => 'space-between',
    'spread-balanced': () => 'space-evenly',
    'spread-inset': () => 'space-around',
    stretch: () => 'stretch',
    top: () => 'flex-start',
  })
}

function alignmentValue(term: TaoLayoutAlignmentTerm): string {
  return RuntimeSwitch(term, {
    baseline: () => 'baseline',
    bottom: () => 'flex-end',
    center: () => 'center',
    left: () => 'flex-start',
    right: () => 'flex-end',
    top: () => 'flex-start',
  })
}

function spacingProperties(propertyPrefix: 'margin' | 'padding', side: TaoLayoutSpacingSide): readonly string[] {
  return RuntimeSwitch<TaoLayoutSpacingSide, readonly string[]>(side, {
    bottom: () => [`${propertyPrefix}Bottom`],
    horizontal: () => [`${propertyPrefix}Left`, `${propertyPrefix}Right`],
    left: () => [`${propertyPrefix}Left`],
    right: () => [`${propertyPrefix}Right`],
    top: () => [`${propertyPrefix}Top`],
    vertical: () => [`${propertyPrefix}Top`, `${propertyPrefix}Bottom`],
  })
}

function physicalSpacingSides(side: TaoLayoutSpacingSide): readonly TaoLayoutPhysicalSpacingSide[] {
  return RuntimeSwitch<TaoLayoutSpacingSide, readonly TaoLayoutPhysicalSpacingSide[]>(side, {
    bottom: () => ['bottom'],
    horizontal: () => ['left', 'right'],
    left: () => ['left'],
    right: () => ['right'],
    top: () => ['top'],
    vertical: () => ['top', 'bottom'],
  })
}

function spacingPairs(entry: TaoLayoutSpacingEntry): readonly TaoLayoutSpacingPair[] {
  if (entry.length === 2) {
    return []
  }

  const pairs: TaoLayoutSpacingPair[] = []
  for (let index = 1; index < entry.length; index += 2) {
    pairs.push([entry[index] as TaoLayoutSpacingSide, entry[index + 1] as TaoLayoutSpacingAmount])
  }
  return pairs
}
