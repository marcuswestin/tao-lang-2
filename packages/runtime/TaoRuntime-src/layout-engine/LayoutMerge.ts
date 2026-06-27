import { Switch } from '@shared/core'
import { LayoutTerms } from './LayoutTerms'
import type {
  TaoLayout,
  TaoLayoutContentEntry,
  TaoLayoutContentTerm,
  TaoLayoutDirection,
  TaoLayoutEntry,
  TaoLayoutEntryHead,
  TaoLayoutEntryOfHead,
  TaoLayoutMergeSpec,
  TaoLayoutPhysicalSpacingSide,
  TaoLayoutSpacingEntry,
  TaoLayoutSpacingSide,
} from './LayoutTypes'

/** LayoutMerge overlays caller layout entries onto default layout entries by semantic slot. */
export const LayoutMerge = {
  merge,
} as const

function merge(
  createLayout: (entries: readonly TaoLayoutEntry[]) => TaoLayout,
  base: TaoLayout | undefined,
  overlay: TaoLayout | undefined,
  spec: TaoLayoutMergeSpec = {},
): TaoLayout | undefined {
  const entries = [...entriesOf(base)]
  for (const entry of entriesOf(overlay)) {
    mergeEntry(entries, entry, spec.direction)
  }
  return entries.length === 0 ? undefined : createLayout(entries)
}

function entriesOf(layout: TaoLayout | undefined): readonly TaoLayoutEntry[] {
  return layout?.entries ?? []
}

function mergeEntry(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutEntry,
  direction: TaoLayoutDirection | undefined,
): void {
  return Switch<TaoLayoutEntryHead, void>(overlayEntry[0], {
    aligned: () => entries.push(overlayEntry),
    centered: () => entries.push(overlayEntry),
    compress: () => entries.push(overlayEntry),
    content: () => mergeContentEntry(entries, overlayEntry as TaoLayoutContentEntry, direction),
    fill: () => entries.push(overlayEntry),
    gap: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'gap'>, 'gap'),
    height: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'height'>, 'height'),
    hug: () => entries.push(overlayEntry),
    margin: () => mergeSpacingEntry(entries, overlayEntry as TaoLayoutSpacingEntry<'margin'>, 'margin'),
    pad: () => mergeSpacingEntry(entries, overlayEntry as TaoLayoutSpacingEntry<'pad'>, 'pad'),
    rigid: () => entries.push(overlayEntry),
    width: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'width'>, 'width'),
  })
}

function replaceEntry<HeadT extends TaoLayoutEntryHead>(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutEntryOfHead<HeadT>,
  head: HeadT,
): void {
  const existingIndex = entries.findIndex(entry => entry[0] === head)
  if (existingIndex === -1) {
    entries.push(overlayEntry)
    return
  }
  entries.splice(existingIndex, 1, overlayEntry)
}

function mergeContentEntry(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutContentEntry,
  direction: TaoLayoutDirection | undefined,
): void {
  if (!direction) {
    replaceEntry(entries, overlayEntry, 'content')
    return
  }
  const existingIndex = entries.findIndex(entry => entry[0] === 'content')
  if (existingIndex === -1) {
    entries.push(overlayEntry)
    return
  }

  const mergedEntry = mergedContentEntryValue(entries[existingIndex]! as TaoLayoutContentEntry, overlayEntry, direction)
  entries.splice(existingIndex, 1, mergedEntry)
}

function mergedContentEntryValue(
  baseEntry: TaoLayoutContentEntry,
  overlayEntry: TaoLayoutContentEntry,
  direction: TaoLayoutDirection,
): TaoLayoutContentEntry {
  const baseSlots = contentSlots(layoutEntryTerms(baseEntry), direction)
  const overlaySlots = contentSlots(layoutEntryTerms(overlayEntry), direction)
  return contentEntryFromSlots({
    main: overlaySlots.main ?? baseSlots.main,
    cross: overlaySlots.cross ?? baseSlots.cross,
  })
}

function contentSlots(
  terms: readonly TaoLayoutContentTerm[],
  direction: TaoLayoutDirection,
): ContentSlots {
  const slots: ContentSlots = {}
  for (const term of terms) {
    if (term === 'center') {
      slots.main = 'center'
      slots.cross = 'center'
      continue
    }
    const slot = LayoutTerms.contentSlot(term, direction)
    if (slot === 'main') {
      slots.main = term
    } else if (slot === 'cross') {
      slots.cross = term
    }
  }
  return slots
}

function contentEntryFromSlots(slots: ContentSlots): TaoLayoutContentEntry {
  if (slots.main === 'center' && slots.cross === 'center') {
    return ['content', 'center']
  }
  const terms = [slots.cross, slots.main].filter((term): term is TaoLayoutContentTerm => term !== undefined)
  return terms.length === 1
    ? ['content', terms[0]!]
    : ['content', terms[0]!, terms[1]!]
}

function mergeSpacingEntry<HeadT extends 'margin' | 'pad'>(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutSpacingEntry<HeadT>,
  head: HeadT,
): void {
  const existingIndex = entries.findIndex(entry => entry[0] === head)
  if (existingIndex === -1) {
    entries.push(overlayEntry)
    return
  }

  const sides = {
    ...spacingSides(entries[existingIndex]! as TaoLayoutSpacingEntry<HeadT>),
    ...spacingSides(overlayEntry),
  }
  entries.splice(existingIndex, 1, spacingEntry(head, sides))
}

function spacingSides(entry: TaoLayoutSpacingEntry): SpacingSides {
  const firstTerm = entry[1]
  if (typeof firstTerm === 'number') {
    return { bottom: firstTerm, left: firstTerm, right: firstTerm, top: firstTerm }
  }

  const sides: SpacingSides = {}
  for (const [side, amount] of LayoutTerms.spacingPairs(entry)) {
    for (const physicalSide of LayoutTerms.physicalSpacingSides(side)) {
      sides[physicalSide] = amount
    }
  }
  return sides
}

function spacingEntry<HeadT extends 'margin' | 'pad'>(
  head: HeadT,
  sides: SpacingSides,
): TaoLayoutSpacingEntry<HeadT> {
  return [head, ...spacingTerms(sides)] as unknown as TaoLayoutSpacingEntry<HeadT>
}

function spacingTerms(sides: SpacingSides): (TaoLayoutSpacingSide | number)[] {
  return (['top', 'right', 'bottom', 'left'] as const).flatMap(side => {
    const amount = sides[side]
    return amount === undefined ? [] : [side, amount]
  })
}

function layoutEntryTerms(entry: TaoLayoutContentEntry): readonly TaoLayoutContentTerm[] {
  return entry.slice(1) as readonly TaoLayoutContentTerm[]
}

type ContentSlots = {
  cross?: TaoLayoutContentTerm
  main?: TaoLayoutContentTerm
}

type SpacingSides = Partial<Record<TaoLayoutPhysicalSpacingSide, number>>
