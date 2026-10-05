import { OutputText } from '@cli-kit'
import { FS } from '@shared'
import type { AgentFailure } from './FailureParser'

/**
 * Reads the `failures` and warnings a verification lane's own `summary.json` already worked out,
 * so the front door never re-derives what the lane already classified. Only a `Summary: <path>` line in the
 * child's own output identifies its artifact. A shared latest link can belong to a concurrent
 * command even when it is newer than this run, so it is never a source of invocation evidence.
 */

export type SummaryFailuresResult = {
  failures: readonly AgentFailure[]
  summaryPath: string
  warnings: readonly string[]
}

const SUMMARY_LINE = /^Summary:\s*(.+)$/m

export type ReadSummaryFailuresOptions = {
  output: string
  repositoryRoot: string
}

/** readSummaryFailures returns the failures a lane's own summary reported, or undefined when no
 * summary this run produced can be found — the caller falls back to parsing the output itself. */
export async function readSummaryFailures(
  options: ReadSummaryFailuresOptions,
): Promise<SummaryFailuresResult | undefined> {
  const named = SUMMARY_LINE.exec(OutputText.stripAnsi(options.output))?.[1]?.trim()
  if (named !== undefined && named !== '') {
    const namedPath = FS.resolvePath(named, options.repositoryRoot)
    const summary = await readFailuresAt(namedPath)
    if (summary !== undefined) {
      return { ...summary, summaryPath: namedPath }
    }
  }

  return undefined
}

async function readFailuresAt(path: string): Promise<Omit<SummaryFailuresResult, 'summaryPath'> | undefined> {
  try {
    const parsed = await FS.readJson<{
      failures?: unknown
      gates?: unknown
      status?: unknown
      version?: unknown
      warnings?: unknown
    }>(path)
    // GateSummary omits failures when none were classified. Only its versioned shape can give
    // that omission meaning; an arbitrary object naming warnings is not invocation evidence.
    const omittedGateFailures = parsed.failures === undefined && parsed.version === 2
      && Array.isArray(parsed.gates) && (parsed.status === 'passed' || parsed.status === 'failed')
    const failures = omittedGateFailures ? [] : parsed.failures
    if (!isFailureList(failures)) {
      return undefined
    }
    const warnings = Array.isArray(parsed.warnings) && parsed.warnings.every(warning => typeof warning === 'string')
      ? parsed.warnings
      : []
    return { failures, warnings }
  } catch {
    return undefined
  }
}

function isFailureList(value: unknown): value is AgentFailure[] {
  return Array.isArray(value)
    && value.every(entry =>
      typeof entry === 'object' && entry !== null && typeof (entry as { gate?: unknown }).gate === 'string'
    )
}
