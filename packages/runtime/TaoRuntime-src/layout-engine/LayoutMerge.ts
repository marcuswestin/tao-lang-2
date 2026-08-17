import RuntimeSwitch from '../TR-switch'
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
  entries: resolvedEntries,
  merge,
} as const

/** resolvedEntries folds one authored list in source order while retaining decomposed `fill` effects. */
function resolvedEntries(
  sourceEntries: readonly TaoLayoutEntry[],
  direction?: TaoLayoutDirection,
): readonly TaoLayoutEntry[] {
  const entries: TaoLayoutEntry[] = []
  for (const entry of sourceEntries) {
    mergeEntry(entries, entry, direction)
  }
  return entries
}

function merge(
  createLayout: (entries: readonly TaoLayoutEntry[]) => TaoLayout,
  base: TaoLayout | undefined,
  overlay: TaoLayout | undefined,
  spec: TaoLayoutMergeSpec = {},
): TaoLayout | undefined {
  const entries = resolvedEntries([...entriesOf(base), ...entriesOf(overlay)], spec.direction)
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
  return RuntimeSwitch<TaoLayoutEntryHead, void>(overlayEntry[0], {
    aligned: () => replaceEntries(entries, overlayEntry, ['aligned', 'centered']),
    centered: () => replaceEntries(entries, overlayEntry, ['aligned', 'centered']),
    claim: () => replaceEntries(entries, overlayEntry, ['claim', 'hug']),
    compress: () => replaceEntries(entries, overlayEntry, ['compress', 'rigid']),
    content: () => mergeContentEntry(entries, overlayEntry as TaoLayoutContentEntry, direction),
    fill: () => replaceWithFill(entries, overlayEntry),
    gap: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'gap'>, 'gap'),
    height: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'height'>, 'height'),
    hug: () => replaceEntries(entries, overlayEntry, ['claim', 'hug']),
    margin: () => mergeSpacingEntry(entries, overlayEntry as TaoLayoutSpacingEntry<'margin'>, 'margin'),
    pad: () => mergeSpacingEntry(entries, overlayEntry as TaoLayoutSpacingEntry<'pad'>, 'pad'),
    rigid: () => replaceEntries(entries, overlayEntry, ['compress', 'rigid']),
    width: () => replaceEntry(entries, overlayEntry as TaoLayoutEntryOfHead<'width'>, 'width'),
  })
}

function replaceEntry<HeadT extends TaoLayoutEntryHead>(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutEntryOfHead<HeadT>,
  head: HeadT,
): void {
  replaceEntries(entries, overlayEntry, [head])
}

function replaceEntries(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutEntry,
  replacedHeads: readonly TaoLayoutEntryHead[],
): void {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (replacedHeads.includes(entries[index]![0])) {
      entries.splice(index, 1)
    }
  }
  entries.push(overlayEntry)
}

function replaceWithFill(entries: TaoLayoutEntry[], overlayEntry: TaoLayoutEntry): void {
  const replacedHeads: readonly TaoLayoutEntryHead[] = [
    'aligned',
    'centered',
    'claim',
    'fill',
    'height',
    'hug',
    'width',
  ]
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    const isWidthMaximum = entry[0] === 'width' && entry[1] === 'max'
    if (!isWidthMaximum && replacedHeads.includes(entry[0])) {
      entries.splice(index, 1)
    }
  }
  entries.push(overlayEntry)
}

function mergeContentEntry(
  entries: TaoLayoutEntry[],
  overlayEntry: TaoLayoutContentEntry,
  direction: TaoLayoutDirection | undefined,
): void {
  if (!direction) {
    // Direction decides which content terms share a semantic slot. Preserve authored entries until
    // the consuming container supplies it rather than discarding an unrelated axis prematurely.
    entries.push(overlayEntry)
    return
  }
  const existingIndex = entries.findIndex(entry => entry[0] === 'content')
  if (existingIndex === -1) {
    entries.push(overlayEntry)
    return
  }

  const mergedEntry = mergedContentEntryValue(entries[existingIndex]! as TaoLayoutContentEntry, overlayEntry, direction)
  entries.splice(existingIndex, 1)
  entries.push(mergedEntry)
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
    RuntimeSwitch(slot, {
      main: () => {
        slots.main = term
      },
      cross: () => {
        slots.cross = term
      },
    })
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
  entries.splice(existingIndex, 1)
  entries.push(spacingEntry(head, sides))
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
