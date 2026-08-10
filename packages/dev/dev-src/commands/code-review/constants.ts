import type { ReviewEffort, Reviewer } from './types'

export const REVIEWERS: readonly Reviewer[] = ['claude', 'codex', 'agy', 'cursor', 'gemini']
export const EFFORTS: readonly ReviewEffort[] = ['low', 'medium', 'high', 'max']
export const DEFAULT_EFFORT: ReviewEffort = 'high'
export const DEFAULT_AGY_MODEL = 'Gemini 3.5 Flash (High)'
export const DEFAULT_AGY_TIMEOUT_SECONDS = 480
export const DEFAULT_REVIEW_TIMEOUT_SECONDS = 900
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-pro-preview'
export const DEFAULT_CURSOR_MODEL = 'composer-2.5'
export const CODEX_SPARK_MODEL = 'gpt-5.3-codex-spark'
export const CODEX_SERVICE_TIER = 'fast'
export const DEFAULT_COLLECT_MAX_BYTES = 8_000
export const STANDARD_RUN_ROOT = '.artifacts/reviews/standard'
export const STRINGENT_RUN_ROOT = '.artifacts/reviews/stringent'
export const RESERVED_LABELS = new Set(['digest', 'fanout', 'latest', 'manifest', 'scope'])
