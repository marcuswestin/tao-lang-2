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
  return FS.resolvePath(run, { cwd: repoRoot })
}

/** reviewMetricsPath returns the runtime metrics JSONL path for the skill owning a run directory. */
export function reviewMetricsPath(runDir: string, repoRoot = Repo.getRoot()): string {
  const relativeRunDir = FS.relativePath(repoRoot, runDir)
  const parts = relativeRunDir.split('/')
  const skillsIndex = parts.findIndex((part, index) => part === 'skills' && parts[index - 1] === '.artifacts')
  const skillName = skillsIndex === -1 ? 'subagents-review' : parts[skillsIndex + 1] ?? 'subagents-review'
  return FS.resolvePath(`.artifacts/skills/${skillName}/metrics/reviewer-runtimes.jsonl`, { cwd: repoRoot })
}

/** formatReviewRunDir builds a sortable, human-readable run directory name. */
export function formatReviewRunDir(slug: string | undefined, date: Date): string {
  const cleanSlug = (slug ?? 'review').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '')
  return `${formatArtifactRunId(date)}-${cleanSlug.length > 0 ? cleanSlug : 'review'}`
}
