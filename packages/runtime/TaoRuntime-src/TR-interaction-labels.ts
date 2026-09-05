import { entityHandle, metadataOf, type RuntimeEntityHandle } from './TR-data-entity'
import type { TaoOutlineLoopDescriptor, TaoOutlineTextPath } from './TR-interaction-outline'

/**
 * primaryLabel is the one string a row is known by: the first statically ranked text the row
 * renders, then the entity's `(title)` field, then the row's own text, then its entity and handle,
 * then the loop's binder and position. It is always on, because the platform reads it as the
 * row's accessible name the moment the row mounts, so it reads exactly one text when it can.
 */
export function primaryLabel(descriptor: TaoOutlineLoopDescriptor, value: unknown, index: number): string {
  for (const path of descriptor.texts) {
    const text = readText(value, path)
    if (text !== undefined) {
      return text
    }
  }
  const handle = entityHandle(value)
  const title = handle ? titleFieldText(handle) : undefined
  if (title !== undefined) {
    return title
  }
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (handle) {
    const metadata = metadataOf(handle)
    return `${metadata.entity} ${metadata.id}`
  }
  return `${descriptor.name} ${index + 1}`
}

/**
 * labelCorpus is every text the row renders, the material narrowing matches against. It is read
 * only on demand — when a reader takes a snapshot — never as a side effect of mounting a row.
 */
export function labelCorpus(descriptor: TaoOutlineLoopDescriptor, value: unknown): readonly string[] {
  const texts: string[] = []
  const seen = new Set<string>()
  const add = (text: string | undefined) => {
    if (text !== undefined && !seen.has(text)) {
      seen.add(text)
      texts.push(text)
    }
  }
  for (const path of descriptor.texts) {
    add(readText(value, path))
  }
  const handle = entityHandle(value)
  add(handle ? titleFieldText(handle) : undefined)
  if (typeof value === 'string') {
    add(value.length > 0 ? value : undefined)
  }
  return texts
}

/**
 * matchesNarrowing applies the interaction contract's greedy word-prefix subsequence rule. Each
 * typed word must prefix a later rendered word; punctuation separates words and never becomes a
 * hidden selector language. Intl.Segmenter keeps word boundaries locale-aware where available.
 */
export function matchesNarrowing(
  corpus: readonly string[],
  narrowing: string,
  locale?: string,
): boolean {
  const prefixes = words(narrowing, locale)
  if (prefixes.length === 0) {
    return true
  }
  const candidates = corpus.flatMap(text => words(text, locale))
  const collator = new Intl.Collator(locale, { sensitivity: 'base', usage: 'search' })
  let candidateIndex = 0
  for (const prefix of prefixes) {
    let matched = false
    while (candidateIndex < candidates.length) {
      const candidate = candidates[candidateIndex++]!
      const head = [...candidate].slice(0, [...prefix].length).join('')
      if (head.length > 0 && collator.compare(head, prefix) === 0) {
        matched = true
        break
      }
    }
    if (!matched) {
      return false
    }
  }
  return true
}

function words(value: string, locale?: string): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new(
      locale?: string,
      options?: { granularity: 'word' },
    ) => { segment(value: string): Iterable<{ isWordLike?: boolean; segment: string }> }
  }).Segmenter
  if (Segmenter) {
    return [...new Segmenter(locale, { granularity: 'word' }).segment(value)]
      .filter(part => part.isWordLike !== false)
      .map(part => part.segment)
  }
  return value.match(/[\p{L}\p{N}]+/gu) ?? []
}

function readText(value: unknown, path: TaoOutlineTextPath): string | undefined {
  let current: unknown = value
  for (const member of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined
    }
    current = (current as Record<string, unknown>)[member]
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

function titleFieldText(handle: RuntimeEntityHandle): string | undefined {
  const metadata = metadataOf(handle)
  const fields = metadata.schema.definition.entities[metadata.entity]?.fields ?? {}
  const title = Object.entries(fields).find(([, field]) => field.title === true)?.[0]
  return title === undefined ? undefined : readText(handle, [title])
}
