export type TaoLayoutDirection = 'column' | 'row'
export type TaoLayoutAlignmentTerm = 'baseline' | 'bottom' | 'center' | 'left' | 'right' | 'top'
export type TaoLayoutContentTerm =
  | 'baseline'
  | 'bottom'
  | 'center'
  | 'left'
  | 'right'
  | 'spread'
  | 'spread-balanced'
  | 'spread-inset'
  | 'stretch'
  | 'top'
export type TaoLayoutDimensionTerm = number | 'fill'
export type TaoLayoutSpacingSide = 'bottom' | 'horizontal' | 'left' | 'right' | 'top' | 'vertical'
export type TaoLayoutPhysicalSpacingSide = 'bottom' | 'left' | 'right' | 'top'
export type TaoLayoutBareEntry =
  | readonly ['centered']
  | readonly ['compress']
  | readonly ['fill']
  | readonly ['hug']
  | readonly ['rigid']
export type TaoLayoutAlignedEntry = readonly ['aligned', TaoLayoutAlignmentTerm]
export type TaoLayoutClaimEntry = readonly ['claim', number]
export type TaoLayoutContentEntry =
  | readonly ['content', TaoLayoutContentTerm]
  | readonly ['content', TaoLayoutContentTerm, TaoLayoutContentTerm]
export type TaoLayoutDimensionEntry =
  | readonly ['height', TaoLayoutDimensionTerm]
  | readonly ['width', TaoLayoutDimensionTerm]
export type TaoLayoutGapEntry = readonly ['gap', number]
export type TaoLayoutSpacingEntry<HeadT extends 'margin' | 'pad' = 'margin' | 'pad'> =
  | readonly [HeadT, number]
  | readonly [HeadT, TaoLayoutSpacingSide, number]
  | readonly [HeadT, TaoLayoutSpacingSide, number, TaoLayoutSpacingSide, number]
  | readonly [HeadT, TaoLayoutSpacingSide, number, TaoLayoutSpacingSide, number, TaoLayoutSpacingSide, number]
  | readonly [
    HeadT,
    TaoLayoutSpacingSide,
    number,
    TaoLayoutSpacingSide,
    number,
    TaoLayoutSpacingSide,
    number,
    TaoLayoutSpacingSide,
    number,
  ]
export type TaoLayoutEntry =
  | TaoLayoutAlignedEntry
  | TaoLayoutBareEntry
  | TaoLayoutClaimEntry
  | TaoLayoutContentEntry
  | TaoLayoutDimensionEntry
  | TaoLayoutGapEntry
  | TaoLayoutSpacingEntry
export type TaoLayoutEntryHead = TaoLayoutEntry[0]
export type TaoLayoutEntryOfHead<HeadT extends TaoLayoutEntryHead> = Extract<
  TaoLayoutEntry,
  readonly [HeadT, ...unknown[]]
>
export type TaoLayoutTermValue = TaoLayoutEntry[number]
export type TaoLayoutStyleValue = number | string
export type TaoResolvedLayoutStyle = Record<string, TaoLayoutStyleValue>
export type TaoLayout = {
  entries: readonly TaoLayoutEntry[]
}

export type TaoLayoutSpec = {
  readonly direction?: TaoLayoutDirection
  readonly entries: readonly TaoLayoutEntry[]
  readonly parentDirection?: TaoLayoutDirection
}

export type TaoLayoutMergeSpec = {
  readonly direction?: TaoLayoutDirection
}
