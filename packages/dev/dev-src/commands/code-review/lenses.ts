import { Text } from '@shared'
import type { ReviewLens } from './types'

/**
 * REVIEW_LENSES is the canonical library of orthogonal review angles. The
 * orchestrator assigns one lens per reviewer to make breadth additive rather
 * than redundant.
 */
export const REVIEW_LENSES: Record<string, ReviewLens> = {
  correctness: {
    title: 'Correctness and edge cases',
    focus:
      'Hunt for logic bugs, wrong results, mishandled edge cases, error/exception handling gaps, and incorrect assumptions. Trace at least one negative and one boundary input per changed path.',
  },
  regressions: {
    title: 'Regressions and callers',
    focus:
      'Find behavior the change breaks: direct callers, dependents, and previously passing scenarios. Check backward compatibility and any silent change in defaults or output shape.',
  },
  'api-boundary': {
    title: 'API and package boundaries',
    focus:
      'Check package exports and cross-package contracts: leaked or unused exports, broken boundary invariants, helpers exported only for convenience, and drift from packages/AGENTS.md slice rules.',
  },
  tests: {
    title: 'Test coverage and quality',
    focus:
      'Identify missing or weak tests, untested negative paths and edge cases, and tests that assert shape instead of behavior. Prefer behavior tests; flag trivial or tautological tests.',
  },
  stale: {
    title: 'Stale code, docs, and instructions',
    focus:
      'Find stale references, dead code, unused APIs, and outdated comments, docs, or AGENTS/skill instructions left behind by the change. Confirm renamed or removed things have no dangling references.',
  },
  requirements: {
    title: 'Requirements and intent',
    focus:
      'Compare the change against its stated plan, task docs, or intent. Flag missed, partial, or over-broad requirements and scope creep beyond what was asked.',
  },
  architecture: {
    title: 'Architecture and language-design integrity',
    focus:
      'Assess layering, ownership, and altitude: validator-vs-compiler responsibilities, runtime TR reuse vs emitted helpers, and consistency with Tao language-design decisions. Flag designs that will not generalize.',
  },
  simplification: {
    title: 'Reuse, simplification, and efficiency',
    focus:
      'Quality only, not bugs: duplicated logic, simpler or clearer equivalents, needless work or allocations in hot paths, and existing helpers that should have been reused. Do not invent correctness findings here.',
  },
  security: {
    title: 'Security and untrusted input',
    focus:
      'Where relevant, check input validation, injection, path/shell handling, and unsafe operations. Flag only concrete, reachable issues, not hypothetical hardening.',
  },
  consistency: {
    title: 'Convention and instruction consistency',
    focus:
      'Check naming, idioms, and repo conventions against AGENTS.md, nested AGENTS.md, and skills. Flag instruction drift and patterns that diverge from nearby code without reason.',
  },
}

const GENERAL_FOCUS =
  'Review broadly for bugs, regressions, missed requirements, missing tests, unused or leaked exports, stale code/docs/instructions, and unclear code. Prioritize correctness and language-design integrity over style.'

/** REVIEW_CONTRACT is the binding, reviewer-agnostic review contract. */
export const REVIEW_CONTRACT = Text.stripIndent(`
  Follow the subagents-review contract:
  - Do not edit files, stage/unstage, reset, stash, or otherwise touch the Git index.
  - Do not run validation, builds, formatters, or destructive operations.
  - Inspect changed files, their direct callers, package exports, and tests for each touched subsystem.
  - Check at least one plausible negative path or edge case per major changed area.
  - Treat Tao repo instructions (AGENTS.md, nested AGENTS.md, and skills) as binding; flag drift.
  - Verify candidate findings against actual code behavior before surfacing them.
  - Avoid duplicate findings and style-only comments unless they hide a correctness, maintainability, or instruction-compliance risk.
  - Lead with findings ordered by severity (blocker, major, minor, nit) with file:line references.
  - State severity, confidence, why it matters, minimal fix direction, and the test or validation that would catch each finding.
  - Label speculative design questions separately from verified issues.
  - If there are no findings, say so directly and list the concrete files and searches that justify the conclusion.
`).trim()

/** DEFAULT_REVIEW_SCOPE describes the current working-tree change set. */
export const DEFAULT_REVIEW_SCOPE = Text.stripIndent(`
  Review the current change set in the working tree.
  - Unstaged changes: \`git diff\` and \`git diff --stat\`.
  - Staged changes: \`git diff --cached\` and \`git diff --cached --stat\`.
  - Use \`git status --short\` to see every touched file.
  Focus the review on these changes and the code paths they affect.
`).trim()

/** buildReviewPrompt assembles a reviewer prompt from the contract, a lens, and scope. */
export function buildReviewPrompt(params: { repoRoot: string; scope?: string; lensKey?: string }): string {
  const lens = params.lensKey === undefined ? undefined : REVIEW_LENSES[params.lensKey]
  const lensBlock = lens === undefined
    ? `## Review lens: general\n${GENERAL_FOCUS}`
    : `## Review lens: ${lens.title}\n${lens.focus}`
  return [
    `You are an adversarial, read-only reviewer for the Tao language repo at ${params.repoRoot}.`,
    REVIEW_CONTRACT,
    lensBlock,
    `## Scope\n${params.scope ?? DEFAULT_REVIEW_SCOPE}`,
  ].join('\n\n') + '\n'
}
