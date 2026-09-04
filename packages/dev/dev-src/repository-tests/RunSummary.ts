import { FS } from '@shared'
import { OutputText } from '../cli/OutputText'
import { type ContentionReport, MachineLanes } from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import type { WorkState } from './WorkGraph'

/**
 * The rollup a run ends with, and the JSON artifact it writes. Just's `[parallel]` interleaves
 * output and then says nothing about the run as a whole, so a failure is found by scrolling. This
 * says it in one place: every node, its status and cost, where its log is, and the first failure
 * worth acting on.
 *
 * `summary.json` is a published contract — the planned hosted gate and any CI consume it — so its
 * shape is versioned and only ever extended.
 */

/** GateStatus is what happened to one node. `skipped` is never reported as `passed`. */
export type GateStatus = 'failed' | 'passed' | 'skipped'

/**
 * Why a node failed, at the level that decides who fixes it. These are genuinely different jobs:
 * set the environment up, install an optional tool, run the command outside the sandbox, wait for
 * the machine, or change the repository. Reporting them as one undifferentiated failure sends
 * every one of them to the same wrong place.
 *
 * `machine-contention` is only ever assigned to a node that ran out of time while this machine was
 * carrying more work than this run started. It is a claim about the host, so it is never made from
 * output alone: `classifyFailure` needs the run's own contention report to reach it.
 */
export type FailureKind =
  | 'electrobun-prepare-timeout'
  | 'environment-setup'
  | 'hutch-install-timeout'
  | 'machine-contention'
  | 'native-host-busy'
  | 'native-probe-timeout'
  | 'native-runtime-exit'
  | 'optional-tooling'
  | 'repository'
  | 'sandbox-restriction'
  | 'test-assertion'
  | 'user-interruption'

/** GateResult records one node's outcome. */
export type GateResult = {
  elapsedMs: number
  exitCode?: number
  /** What the timings store predicted this node would take, when it had a prediction. */
  expectedMs?: number
  /** How a failure should be acted on, when the node failed. */
  failureKind?: FailureKind
  logPath?: string
  name: string
  /** Nodes that had to pass before this one started. */
  needs?: readonly string[]
  /** Why a node was skipped, or why a failure happened, in one line. */
  reason?: string
  /** Named exclusive resources the node held while it ran. */
  resources?: readonly string[]
  /** True when the node first failed under machine contention and was run again on its own. */
  retried?: boolean
  status: GateStatus
}

/** GateSummary is the versioned rollup a run ends with, and the JSON artifact it can write. */
export type GateSummary = {
  /** What the machine was carrying while this run happened; absent for a run that did not sample it. */
  contention?: ContentionReport
  elapsedMs: number
  /** The first failing node, which is the one to act on. */
  firstFailure?: { logPath?: string; name: string; output: string }
  gates: readonly GateResult[]
  /** The lane this run belongs to, which is also its artifact directory. */
  lane: string
  logRoot: string
  status: 'failed' | 'passed'
  version: 2
  warnings: readonly string[]
}

/** BuildSummaryOptions describes the finished run being rolled up. */
export type BuildSummaryOptions = {
  /** What the machine was carrying while this run happened, when the lane sampled it. */
  contention?: ContentionReport
  /** Nodes the lane deliberately did not run, already resolved to results. */
  declaredSkips?: readonly GateResult[]
  elapsedMs: number
  expectedMs?: (name: string) => number | undefined
  /** A cancelled run failed, whatever its nodes managed to report. */
  interrupted?: boolean
  lane: string
  logRoot: string
  /** Node names in the order the caller declared them; the first failure is named from it. */
  order?: readonly string[]
  states: readonly WorkState[]
}

const FAILURE_OUTPUT_LINES = 40
const SUMMARY_VERSION = 2

const FAILURE_SIGNATURES: readonly { kind: FailureKind; pattern: RegExp }[] = [
  { kind: 'native-host-busy', pattern: /Machine resource 'studio-native-host' is busy/i },
  { kind: 'hutch-install-timeout', pattern: /Hutch install timed out after/i },
  { kind: 'electrobun-prepare-timeout', pattern: /Hutch electrobun prepare timed out after/i },
  {
    kind: 'native-runtime-exit',
    pattern:
      /(?:native runtime exited .* before (?:reporting|producing)|Electrobun exited before writing its runtime probe)/i,
  },
  { kind: 'native-probe-timeout', pattern: /Timed out waiting for the Electrobun runtime probe/i },
  { kind: 'user-interruption', pattern: /\b(?:user interruption|was interrupted|interrupted before completion)\b/i },
  { kind: 'environment-setup', pattern: /pinned devenv profile is unavailable|command not found: (bun|node|just)/i },
  { kind: 'environment-setup', pattern: /^error: Cannot find (module|package)/im },
  { kind: 'optional-tooling', pattern: /\b(watchman|hutch|chrome|chromium|lsof|docker) (is )?not (installed|found)/i },
  // Last, and anchored to a line of its own: `EPERM` inside a test's own assertion text is a
  // repository failure, not a host restriction, and it is far more common than the real thing.
  {
    kind: 'sandbox-restriction',
    pattern: /^(?!.*expect).*\b(operation not permitted|PermissionDenied|EPERM|EACCES)\b/im,
  },
  {
    kind: 'test-assertion',
    pattern: /(?:\(fail\)|AssertionError|expect\(received\)|^FAIL\s+(?!shutdown:|exit:))/im,
  },
]

/**
 * How each runner says a clock ran out: the work-graph node timeout, Bun's and Jest's per-test
 * timeouts, and `@shared/test`'s own named waits. A run out of time is the one failure whose cause
 * can be a busy machine rather than the code, which is why it is matched separately from the kinds
 * above rather than added to them.
 */
const TIMEOUT_SIGNATURES: readonly RegExp[] = [
  /\btimed out after\b/i,
  /\btimeout of \d+\s*ms exceeded\b/i,
  /\bexceeded timeout of\b/i,
  /\btest (?:timed out|timeout)\b/i,
  /\bETIMEDOUT\b/,
]

/** Lines worth surfacing from a node that still passed, including tool diagnostics. */
const WARNING_PATTERN = /\b(warning|warn):|is declared but never referenced|deprecated/i

/** ClassifyContext carries what the output alone cannot say: what else the machine was carrying. */
export type ClassifyContext = {
  contention?: ContentionReport
  interrupted?: boolean
}

/** describesTimeout reports whether a node's output says it ran out of time rather than failed. */
export function describesTimeout(output: string): boolean {
  return TIMEOUT_SIGNATURES.some(pattern => pattern.test(output))
}

/**
 * classifyFailure names the kind of failure a node's output describes. A timeout is only called
 * contention when the run actually measured contention; on an idle machine the same timeout is a
 * repository failure and must stay one.
 */
export function classifyFailure(output: string, context: ClassifyContext = {}): FailureKind {
  if (context.interrupted === true) {
    return 'user-interruption'
  }
  const signature = FAILURE_SIGNATURES.find(candidate => candidate.pattern.test(output))
  if (signature !== undefined) {
    return signature.kind
  }
  return context.contention?.contended === true && describesTimeout(output) ? 'machine-contention' : 'repository'
}

/** buildSummary rolls one finished run up into the versioned summary it writes and prints. */
export function buildSummary(options: BuildSummaryOptions): GateSummary {
  const declaredSkips = options.declaredSkips ?? []
  const results = new Map(
    options.states.map(state => [state.name, nodeResult(state, options.expectedMs, options.contention)]),
  )
  const order = options.order ?? options.states.map(state => state.name)
  const ordered = [
    ...declaredSkips,
    ...order.map(name => results.get(name)).filter((result): result is GateResult => result !== undefined),
  ]
  const firstFailed = order.map(name => results.get(name)).find(result => result?.status === 'failed')
  const failedState = options.states.find(state => state.name === firstFailed?.name)

  return {
    contention: options.contention,
    elapsedMs: Math.round(options.elapsedMs),
    firstFailure: firstFailed === undefined ? undefined : {
      logPath: firstFailed.logPath,
      name: firstFailed.name,
      output: lastLines(failedState?.fullOutput ?? '', FAILURE_OUTPUT_LINES),
    },
    gates: ordered,
    lane: options.lane,
    logRoot: options.logRoot,
    status: options.interrupted === true || ordered.some(result => result.status === 'failed') ? 'failed' : 'passed',
    version: SUMMARY_VERSION,
    warnings: [...contentionWarnings(ordered, options.contention), ...collectWarnings(options.states)],
  }
}

/**
 * What a reader must be told before they read a failure: this run did not have the machine to
 * itself. Without it a contended timeout looks exactly like a regression, and the next thing that
 * happens is somebody bisecting one that is not there.
 */
function contentionWarnings(
  results: readonly GateResult[],
  contention: ContentionReport | undefined,
): string[] {
  if (contention === undefined || !contention.contended) {
    return []
  }
  const warnings = [`machine contention: ${MachineLanes.describeContention(contention)}`]
  const retried = results.filter(result => result.retried === true && result.status === 'passed')
  const confirmedFailures = results.filter(result => result.retried === true && result.status === 'failed')
  const unconfirmed = results.filter(result => result.failureKind === 'machine-contention' && result.retried !== true)
  if (retried.length > 0) {
    warnings.push(
      `passed only on an isolated retry after failing under contention: ${
        retried.map(result => result.name).join(', ')
      }`,
    )
  }
  if (confirmedFailures.length > 0) {
    warnings.push(
      `failed again on an isolated retry after timing out under contention: ${
        confirmedFailures.map(result => result.name).join(', ')
      }`,
    )
  }
  if (unconfirmed.length > 0) {
    warnings.push(
      `timed out under contention without an exclusive confirmation: ${
        unconfirmed.map(result => result.name).join(', ')
      }`,
    )
  }
  return warnings
}

/** skippedResult records a node the lane declared it would not run, as `name=reason`. */
export function skippedResult(entry: string): GateResult {
  const separator = entry.indexOf('=')
  const [name, reason] = separator === -1
    ? [entry, 'not run in this lane']
    : [entry.slice(0, separator), entry.slice(separator + 1)]
  return { elapsedMs: 0, name: name!, reason, status: 'skipped' }
}

/** formatGateSummary renders the rollup a run ends with. */
export function formatGateSummary(summary: GateSummary): string {
  const lines = ['', 'Verification summary:']
  for (const gate of summary.gates) {
    const cost = gate.status === 'skipped' ? '' : ` ${formatMilliseconds(gate.elapsedMs)}`
    const reason = gate.reason === undefined ? '' : ` — ${gate.reason}`
    lines.push(`- ${gate.name}: ${gate.status}${cost}${reason}`)
  }
  for (const warning of summary.warnings) {
    lines.push(`! ${warning}`)
  }
  lines.push(
    `${summary.gates.filter(gate => gate.status === 'passed').length} passed, `
      + `${summary.gates.filter(gate => gate.status === 'failed').length} failed, `
      + `${summary.gates.filter(gate => gate.status === 'skipped').length} skipped `
      + `in ${formatMilliseconds(summary.elapsedMs)}`,
  )
  lines.push(`Logs: ${FS.displayPath(summary.logRoot)}`)
  lines.push(`Summary: ${FS.displayPath(FS.resolvePath(RunArtifacts.SUMMARY_FILE, summary.logRoot))}`)
  if (summary.firstFailure !== undefined) {
    lines.push('', `First failure — ${summary.firstFailure.name}:`)
    lines.push(summary.firstFailure.output)
    if (summary.firstFailure.logPath !== undefined) {
      lines.push(`Full log: ${FS.displayPath(summary.firstFailure.logPath)}`)
    }
  }
  return lines.join('\n')
}

/** gateExitCode never hides the originating status: one failed node fails the wrapper. */
export function gateExitCode(summary: GateSummary): number {
  return summary.status === 'failed' ? 1 : 0
}

function nodeResult(
  state: WorkState,
  expectedMs: BuildSummaryOptions['expectedMs'],
  contention: ContentionReport | undefined,
): GateResult {
  const exitCode = typeof state.exitCode === 'number' ? state.exitCode : undefined
  const failed = state.status === 'failed'
  const failureKind = failed
    ? classifyFailure(state.fullOutput, {
      contention,
      interrupted: state.failure?.kind === 'interrupted',
    })
    : undefined
  return {
    elapsedMs: Math.round(state.elapsedMs),
    exitCode,
    expectedMs: expectedMs?.(state.name),
    failureKind,
    logPath: state.logPath,
    name: state.name,
    needs: state.node.needs,
    reason: state.reason ?? (failed ? `exited ${exitCode ?? 'unknown'} (${failureKind})` : undefined),
    resources: state.node.resources,
    retried: state.retried,
    status: state.status === 'passed' ? 'passed' : failed ? 'failed' : 'skipped',
  }
}

/** Warnings a node printed but did not fail on, so they are visible without scrolling. */
function collectWarnings(states: readonly WorkState[]): string[] {
  const warnings = new Set<string>()
  for (const state of states) {
    for (const line of state.fullOutput.split('\n')) {
      if (WARNING_PATTERN.test(line) && line.trim().length > 0) {
        warnings.add(`${state.name}: ${OutputText.stripAnsi(line).trim()}`)
      }
    }
  }
  return [...warnings]
}

function lastLines(output: string, limit: number): string {
  const lines = output.split('\n').filter(line => line.trim().length > 0)
  return lines.slice(-limit).join('\n')
}

function formatMilliseconds(elapsedMs: number): string {
  return elapsedMs >= 1_000 ? `${(elapsedMs / 1_000).toFixed(1)}s` : `${elapsedMs}ms`
}
