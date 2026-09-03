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
    if (
      isValidPreviousKey(key, labelLetters(candidate.label, locale))
      && generatedKeyAvailable(key, excluded, assigned)
    ) {
      assignments.set(candidate.identity, key)
      assigned.add(key)
    }
  }

  for (const candidate of ordered) {
    if (assignments.has(candidate.identity)) {
      continue
    }
    const key = labelLetters(candidate.label, locale).find(letter => generatedKeyAvailable(letter, excluded, assigned))
    if (key !== undefined) {
      assignments.set(candidate.identity, key)
      assigned.add(key)
    }
  }

  let pending = ordered.filter(candidate => !assignments.has(candidate.identity))
  const sequencePrefixes = new Set(
    [...assigned].filter(key => /^[a-z]{2}$/u.test(key)).map(key => key[0]!),
  )
  while (availableSequenceCount(sequencePrefixes, excluded, assigned) < pending.length) {
    const freePrefix = asciiLetters.find(letter =>
      !sequencePrefixes.has(letter) && !excluded.has(letter) && !assigned.has(letter)
    )
    if (freePrefix !== undefined) {
      sequencePrefixes.add(freePrefix)
      continue
    }
    // An exceptionally dense surface may consume every ASCII letter as a one-key assignment.
    // Release the last deterministic single-letter assignment into a continuation branch rather
    // than introducing a timeout or making a complete key the prefix of another complete key.
    const released = [...assignments.entries()]
      .filter(([, key]) => /^[a-z]$/u.test(key) && !excluded.has(key))
      .sort(([leftIdentity, leftKey], [rightIdentity, rightKey]) =>
        codePointCompare(leftKey, rightKey) || codePointCompare(leftIdentity, rightIdentity)
      )
      .at(-1)
    if (!released) {
      break
    }
    assignments.delete(released[0])
    assigned.delete(released[1])
    sequencePrefixes.add(released[1])
    pending = ordered.filter(candidate => !assignments.has(candidate.identity))
  }

  const sequences = prefixedTwoLetterSequences(sequencePrefixes)
  for (const candidate of pending) {
    let key = sequences.next().value
    while (typeof key === 'string' && !generatedKeyAvailable(key, excluded, assigned)) {
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

const asciiLetters = Object.freeze(Array.from({ length: 26 }, (_, index) => String.fromCharCode(97 + index)))

function generatedKeyAvailable(key: string, excluded: ReadonlySet<string>, assigned: ReadonlySet<string>): boolean {
  if (excluded.has(key) || (key.length > 1 && excluded.has(key[0]!))) {
    return false
  }
  return [...assigned].every(existing => !existing.startsWith(key) && !key.startsWith(existing))
}

function availableSequenceCount(
  prefixes: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
  assigned: ReadonlySet<string>,
): number {
  let count = 0
  for (const prefix of prefixes) {
    for (const second of asciiLetters) {
      if (generatedKeyAvailable(`${prefix}${second}`, excluded, assigned)) {
        count += 1
      }
    }
  }
  return count
}

function* prefixedTwoLetterSequences(prefixes: ReadonlySet<string>): Generator<string> {
  for (const first of [...prefixes].sort(codePointCompare)) {
    for (const second of asciiLetters) {
      yield `${first}${second}`
    }
  }
}
