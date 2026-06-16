/** Reviewer names an external review CLI launched by the review orchestrator. */
export type Reviewer = 'claude' | 'codex' | 'agy' | 'cursor' | 'gemini'

/** ReviewEffort names a normalized reasoning-effort tier mapped per reviewer CLI. */
export type ReviewEffort = 'low' | 'medium' | 'high' | 'max'

/** ReviewRunKind names the artifact root used for a review run. */
export type ReviewRunKind = 'standard' | 'stringent'

/** ReviewStatus summarizes a finished reviewer launch. */
export type ReviewStatus = 'ok' | 'empty' | 'failed'

/** ReviewLens describes one adversarial review angle a reviewer can take. */
export type ReviewLens = {
  title: string
  focus: string
}

/** ReviewerInvocation is a resolved, shell-quote-free process invocation. */
export type ReviewerInvocation = {
  command: string
  args: string[]
  stdin?: string
  outputFormat: 'jsonl' | 'text'
}

/** CappedText is text trimmed to a byte budget with truncation metadata. */
export type CappedText = {
  text: string
  truncated: boolean
  originalBytes: number
}

/** ReviewMeta records the outcome of one reviewer launch. */
export type ReviewMeta = {
  label: string
  reviewer: Reviewer
  effort: ReviewEffort
  status: ReviewStatus
  exitCode: number | null
  durationMs: number
  bytes: number
  reviewPath: string
  command: string
  model?: string
  lens?: string
  rawPath?: string
}

/** ReviewerManifestEntry is one reviewer spec in a fanout manifest. */
export type ReviewerManifestEntry = {
  reviewer: Reviewer
  label: string
  model?: string
  effort?: ReviewEffort
  timeoutSeconds?: number
  lens?: string
  promptFile?: string
  scopeFile?: string
  scope?: string
}
