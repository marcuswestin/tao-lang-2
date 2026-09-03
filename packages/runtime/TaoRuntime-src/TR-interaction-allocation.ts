import { normalizeInteractionKey, type TaoAttentionKey } from './TR-interaction-keys'

/** One visible interaction identity and the localized label from which its hint key is derived. */
export type TaoInteractionAllocationCandidate = Readonly<{
  identity: string
  label: string
}>

/** The stable identity-to-key projection consumed by interaction surfaces. */
export type TaoInteractionKeyAssignments = Readonly<Record<string, string>>

export type TaoInteractionAllocationOptions = Readonly<{
  /** Existing command shortcuts and verb accelerators which generated hints must not shadow. */
  explicitKeys?: readonly string[]
  locale?: string | readonly string[]
  /** The preceding projection, used to keep mounted identities stable across reorders. */
  previous?: TaoInteractionKeyAssignments
}>

const reducerKeys: readonly TaoAttentionKey[] = [
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Enter',
  'Escape',
  'Space',
  'Tab',
  '.',
  '/',
  '?',
  'primary+k',
]

/** The attention reducer's bindings are never candidates for generated interaction hints. */
export const reservedInteractionAllocationKeys: ReadonlySet<string> = new Set(reducerKeys)

/**
 * allocateInteractionKeys derives deterministic hint keys without making render order semantic.
 * Existing identity assignments win first, then identities allocate in canonical order.
 */
export function allocateInteractionKeys(
  candidates: readonly TaoInteractionAllocationCandidate[],
  options: TaoInteractionAllocationOptions = {},
): TaoInteractionKeyAssignments {
  const locale = options.locale
  const ordered = canonicalCandidates(candidates)
  const excluded = excludedKeys(options.explicitKeys ?? [], locale)
  const assigned = new Set<string>()
  const assignments = new Map<string, string>()

  for (const candidate of ordered) {
    const previous = options.previous?.[candidate.identity]
    if (previous === undefined) {
      continue
    }
    const key = normalizeAllocationKey(previous, locale)
    if (isValidPreviousKey(key, labelLetters(candidate.label, locale)) && !excluded.has(key) && !assigned.has(key)) {
      assignments.set(candidate.identity, key)
      assigned.add(key)
    }
  }

  for (const candidate of ordered) {
    if (assignments.has(candidate.identity)) {
      continue
    }
    const key = labelLetters(candidate.label, locale).find(letter => !excluded.has(letter) && !assigned.has(letter))
    if (key !== undefined) {
      assignments.set(candidate.identity, key)
      assigned.add(key)
    }
  }

  const sequences = twoLetterSequences()
  for (const candidate of ordered) {
    if (assignments.has(candidate.identity)) {
      continue
    }
    let key = sequences.next().value
    while (typeof key === 'string' && (excluded.has(key) || assigned.has(key))) {
      key = sequences.next().value
    }
    if (typeof key !== 'string') {
      break
    }
    assignments.set(candidate.identity, key)
    assigned.add(key)
  }

  return Object.freeze(Object.fromEntries(ordered.flatMap(candidate => {
    const key = assignments.get(candidate.identity)
    return key === undefined ? [] : [[candidate.identity, key]]
  })))
}

function canonicalCandidates(
  candidates: readonly TaoInteractionAllocationCandidate[],
): readonly TaoInteractionAllocationCandidate[] {
  return [...candidates].sort((left, right) => codePointCompare(left.identity, right.identity))
}

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function excludedKeys(explicitKeys: readonly string[], locale: string | readonly string[] | undefined): Set<string> {
  const excluded = new Set<string>()
  for (const key of reducerKeys) {
    addExcludedKey(excluded, key, locale)
  }
  for (const key of explicitKeys) {
    addExcludedKey(excluded, key, locale)
  }
  return excluded
}

function addExcludedKey(
  excluded: Set<string>,
  input: string,
  locale: string | readonly string[] | undefined,
): void {
  const key = normalizeAllocationKey(normalizeInteractionKey(input), locale)
  if (key.length > 0) {
    excluded.add(key)
  }
}

function normalizeAllocationKey(value: string, locale: string | readonly string[] | undefined): string {
  const normalized = value.normalize('NFC')
  return locale === undefined
    ? normalized.toLowerCase()
    : normalized.toLocaleLowerCase(locale as string | string[])
}

function labelLetters(label: string, locale: string | readonly string[] | undefined): readonly string[] {
  const seen = new Set<string>()
  const letters: string[] = []
  for (const grapheme of graphemes(label, locale)) {
    const key = normalizeAllocationKey(grapheme, locale)
    if (!/\p{L}/u.test(key) || seen.has(key)) {
      continue
    }
    seen.add(key)
    letters.push(key)
  }
  return letters
}

function graphemes(value: string, locale: string | readonly string[] | undefined): readonly string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new(
      locale?: string | readonly string[],
      options?: { granularity: 'grapheme' },
    ) => { segment(value: string): Iterable<{ segment: string }> }
  }).Segmenter
  return Segmenter
    ? [...new Segmenter(locale, { granularity: 'grapheme' }).segment(value)].map(part => part.segment)
    : [...value.normalize('NFC')]
}

function isValidPreviousKey(key: string, letters: readonly string[]): boolean {
  return (graphemeLength(key) === 1 && letters.includes(key)) || /^[a-z]{2}$/u.test(key)
}

function graphemeLength(value: string): number {
  return graphemes(value, undefined).length
}

function* twoLetterSequences(): Generator<string> {
  for (let first = 0; first < 26; first += 1) {
    for (let second = 0; second < 26; second += 1) {
      yield String.fromCharCode(97 + first, 97 + second)
    }
  }
}
