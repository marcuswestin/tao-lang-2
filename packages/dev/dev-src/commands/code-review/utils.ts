import { EFFORTS, REVIEWERS } from './constants'
import type { ReviewEffort, Reviewer } from './types'

export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function isReviewer(value: string): value is Reviewer {
  return (REVIEWERS as readonly string[]).includes(value)
}

export function isEffort(value: string): value is ReviewEffort {
  return (EFFORTS as readonly string[]).includes(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isSafeLabel(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function optionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }
  return value
}

export function isAgyGoogleModel(model: string): boolean {
  return model.startsWith('Gemini ')
}
