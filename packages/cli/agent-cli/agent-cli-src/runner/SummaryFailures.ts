import { OutputText } from '@cli-kit'
import { FS } from '@shared'
import type { AgentFailure } from './FailureParser'

/**
 * Reads the `failures` a verification lane's own `summary.json` already worked out, so the front
 * door never re-derives what the lane already classified. Preferred source: a `Summary: <path>`
 * line the child's own output named. Fallback source: `.artifacts/logs/<command>/latest/summary.json`,
 * trusted only when it is newer than this run's start — an older lane run left over from before
 * this command started is not this run's evidence.
 */

export type SummaryFailuresResult = {
  failures: readonly AgentFailure[]
  summaryPath: string
}

const SUMMARY_LINE = /^Summary:\s*(.+)$/m

export type ReadSummaryFailuresOptions = {
  command: string
  output: string
  repositoryRoot: string
  startedAt: number
}

/** readSummaryFailures returns the failures a lane's own summary reported, or undefined when no
 * summary this run produced can be found — the caller falls back to parsing the output itself. */
export async function readSummaryFailures(
  options: ReadSummaryFailuresOptions,
): Promise<SummaryFailuresResult | undefined> {
  const named = SUMMARY_LINE.exec(OutputText.stripAnsi(options.output))?.[1]?.trim()
  if (named !== undefined && named !== '') {
    const namedPath = FS.resolvePath(named, options.repositoryRoot)
    const failures = await readFailuresAt(namedPath)
    if (failures !== undefined) {
      return { failures, summaryPath: namedPath }
    }
  }

  const lanePath = FS.resolvePath(`.artifacts/logs/${options.command}/latest/summary.json`, options.repositoryRoot)
  if (!await FS.exists(lanePath) || await FS.modifiedTimeMs(lanePath) < options.startedAt) {
    return undefined
  }
  const failures = await readFailuresAt(lanePath)
  return failures === undefined ? undefined : { failures, summaryPath: lanePath }
}

async function readFailuresAt(path: string): Promise<readonly AgentFailure[] | undefined> {
  try {
    const parsed = await FS.readJson<{ failures?: unknown }>(path)
    return isFailureList(parsed.failures) ? parsed.failures : undefined
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
