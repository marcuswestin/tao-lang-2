import { FS, Repo } from '@shared'
import { formatArtifactRunId } from '../artifacts'
import { STANDARD_RUN_ROOT, STRINGENT_RUN_ROOT } from './constants'
import type { ReviewRunKind } from './types'

/** reviewRunRoot returns the artifact root for a review run kind. */
export function reviewRunRoot(kind: ReviewRunKind): string {
  return kind === 'stringent' ? STRINGENT_RUN_ROOT : STANDARD_RUN_ROOT
}

/** resolveReviewRunDir resolves review run directories from the repo root. */
export function resolveReviewRunDir(run: string, repoRoot = Repo.getRoot()): string {
  return FS.resolvePath(run, repoRoot)
}

/** reviewMetricsPath returns the runtime metrics JSONL path for the profile owning a run directory. */
export function reviewMetricsPath(runDir: string, repoRoot = Repo.getRoot()): string {
  const relativeRunDir = FS.relativePath(repoRoot, runDir)
  const parts = relativeRunDir.split('/')
  const reviewsIndex = parts.findIndex((part, index) => part === 'reviews' && parts[index - 1] === '.artifacts')
  const profile = reviewsIndex === -1 ? 'standard' : parts[reviewsIndex + 1] ?? 'standard'
  return FS.resolvePath(`.artifacts/reviews/${profile}/metrics/reviewer-runtimes.jsonl`, repoRoot)
}

/** formatReviewRunDir builds a sortable, human-readable run directory name. */
export function formatReviewRunDir(slug: string | undefined, date: Date): string {
  const cleanSlug = (slug ?? 'review').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')
  return `${formatArtifactRunId(date)}-${cleanSlug.length > 0 ? cleanSlug : 'review'}`
}
