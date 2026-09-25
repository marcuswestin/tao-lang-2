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
/**
 * `none` after a clause head clears the slot: the element lays out as if no layer had set it. A
 * clearing term rides in the entry list through every merge, because the layer that clears a slot
 * and the layer that set it are resolved apart — an element default, a declaration header, a
 * caller's clause and the occurrence's own clause each resolve on their own link. Only the final
 * lowering in LayoutResolve drops it, so nothing reaches a style object as `none`.
 */
type TaoLayoutClearTerm = 'none'
type TaoLayoutDimensionTerm = number | 'fill'
export type TaoLayoutSpacingAmount = TaoLayoutClearTerm | number
export type TaoLayoutSpacingSide = 'bottom' | 'horizontal' | 'left' | 'right' | 'top' | 'vertical'
export type TaoLayoutPhysicalSpacingSide = 'bottom' | 'left' | 'right' | 'top'
type TaoLayoutBareEntry =
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
  | readonly ['height', TaoLayoutClearTerm | TaoLayoutDimensionTerm]
  | readonly ['width', TaoLayoutClearTerm | TaoLayoutDimensionTerm]
  | readonly ['width', 'max', number]
export type TaoLayoutGapEntry = readonly ['gap', TaoLayoutClearTerm | number]
export type TaoLayoutSpacingEntry<HeadT extends 'margin' | 'pad' = 'margin' | 'pad'> =
  | readonly [HeadT, TaoLayoutSpacingAmount]
  | readonly [HeadT, TaoLayoutSpacingSide, TaoLayoutSpacingAmount]
  | readonly [HeadT, TaoLayoutSpacingSide, TaoLayoutSpacingAmount, TaoLayoutSpacingSide, TaoLayoutSpacingAmount]
  | readonly [
    HeadT,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
  ]
  | readonly [
    HeadT,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
    TaoLayoutSpacingSide,
    TaoLayoutSpacingAmount,
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
/**
 * An `undefined` value is the visual counterpart of a cleared layout slot: `bg none` records the
 * key as explicitly unset so it overrules a weaker layer that set it, and the final merge drops the
 * key altogether. Any other value is the style the element renders with.
 */
type TaoLayoutStyleValue = number | string | undefined
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
