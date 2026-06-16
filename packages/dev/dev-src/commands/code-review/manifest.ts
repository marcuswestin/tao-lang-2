import {
  DEFAULT_AGY_MODEL,
  DEFAULT_CURSOR_MODEL,
  EFFORTS,
  RESERVED_LABELS,
  REVIEWERS,
} from './constants'
import { REVIEW_LENSES } from './lenses'
import type { ReviewEffort, ReviewerManifestEntry } from './types'
import {
  isAgyGoogleModel,
  isEffort,
  isRecord,
  isReviewer,
  isSafeLabel,
  optionalPositiveNumber,
  optionalString,
} from './utils'

/** parseManifest validates a fanout manifest into reviewer entries. */
export function parseManifest(raw: unknown): ReviewerManifestEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw['reviewers'])
    ? raw['reviewers']
    : undefined
  if (list === undefined) {
    throw new Error('Review manifest must be a JSON array of reviewers or an object with a "reviewers" array.')
  }
  if (list.length === 0) {
    throw new Error('Review manifest must contain at least one reviewer.')
  }
  const labels = new Set<string>()
  return list.map((entry, index) => {
    const parsed = parseManifestEntry(entry, index)
    if (labels.has(parsed.label)) {
      throw new Error(`Review manifest reviewer ${index} reuses label "${parsed.label}"; labels must be unique.`)
    }
    labels.add(parsed.label)
    return parsed
  })
}

/** parseManifestEntry validates one reviewer spec from a manifest or CLI options. */
export function parseManifestEntry(entry: unknown, index: number): ReviewerManifestEntry {
  if (!isRecord(entry)) {
    throw new Error(`Review manifest reviewer ${index} must be an object.`)
  }
  const reviewer = entry['reviewer']
  if (typeof reviewer !== 'string' || !isReviewer(reviewer)) {
    throw new Error(`Review manifest reviewer ${index} needs a reviewer of ${REVIEWERS.join(', ')}.`)
  }
  const label = entry['label']
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error(`Review manifest reviewer ${index} needs a non-empty label.`)
  }
  const trimmedLabel = label.trim()
  if (!isSafeLabel(trimmedLabel)) {
    throw new Error(
      `Review manifest reviewer ${index} label "${trimmedLabel}" must contain only letters, numbers, dots, underscores, and hyphens, and cannot contain path fragments.`,
    )
  }
  if (RESERVED_LABELS.has(trimmedLabel)) {
    throw new Error(`Review manifest reviewer ${index} label "${trimmedLabel}" is reserved for review run artifacts.`)
  }
  const effort = entry['effort']
  if (effort !== undefined && (typeof effort !== 'string' || !isEffort(effort))) {
    throw new Error(`Review manifest reviewer ${index} effort must be one of ${EFFORTS.join(', ')}.`)
  }
  const lens = entry['lens']
  if (lens !== undefined && (typeof lens !== 'string' || REVIEW_LENSES[lens] === undefined)) {
    throw new Error(
      `Review manifest reviewer ${index} lens "${String(lens)}" is unknown. Run \`./agent review lenses\`.`,
    )
  }
  const model = optionalString(entry['model'])
  if (reviewer === 'agy' && model !== undefined && !isAgyGoogleModel(model)) {
    throw new Error(`Review manifest reviewer ${index} Antigravity model must be a Google Gemini model.`)
  }
  return {
    reviewer,
    label: trimmedLabel,
    effort: effort as ReviewEffort | undefined,
    lens: lens as string | undefined,
    model: reviewer === 'agy'
      ? model ?? DEFAULT_AGY_MODEL
      : reviewer === 'cursor'
      ? model ?? DEFAULT_CURSOR_MODEL
      : model,
    timeoutSeconds: optionalPositiveNumber(entry['timeoutSeconds'], `Review manifest reviewer ${index} timeoutSeconds`),
    promptFile: optionalString(entry['promptFile']),
    scopeFile: optionalString(entry['scopeFile']),
    scope: optionalString(entry['scope']),
  }
}
