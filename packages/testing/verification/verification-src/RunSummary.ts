import { OutputText } from '@cli-kit'
import { FS, HCI, Repo } from '@shared'
import { type ContentionReport, MachineLanes } from './MachineLanes'
import { RunArtifacts } from './RunArtifacts'
import type { OverlapReport } from './RunHistory'
import type { WorkState } from './WorkGraph'
import { type ScheduleReport, type ScheduleWait, WorkSchedule } from './WorkSchedule'

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

/**
 * ExtractedFailure names one test or issue a failed gate's log points to, pulled from the gate's own
 * full output rather than left for a reader to grep out of a log file. `error` and `file` are best
 * effort: a format this cannot recognize still names the test, and a gate whose whole log matches no
 * known format contributes no entries at all rather than a guess dressed up as one.
 */
export type ExtractedFailure = {
  error?: string
  file?: string
  test: string
}

/** GateResult records one node's outcome. */
export type GateResult = {
  /** Ordering prerequisites, which must settle before admission. */
  after?: readonly string[]
  elapsedMs: number
  exitCode?: number
  /** What the timings store predicted this node would take, when it had a prediction. */
  expectedMs?: number
  /** How a failure should be acted on, when the node failed. */
  failureKind?: FailureKind
  /**
   * The tests or issues this node's log names, capped at `MAX_FAILURES_PER_GATE`. Absent on a
   * passing node and on a failed one whose log matched no recognized format.
   */
  failures?: readonly ExtractedFailure[]
  /** How many more `extractFailures` found past the cap, when it found more than fit. */
  failuresTruncated?: number
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
  /** The suite a sharded test node reports under; absent for a node that is not a test shard. */
  suite?: string
  /**
   * Test IDs this node failed on that the flake ledger accounted for. Present only on a node whose
   * every failure was one of them, which is the node reported `passed` despite a non-zero exit.
   */
  tolerated?: readonly string[]
  /** What held this node before it started, longest reason first; absent for one that never waited. */
  waits?: readonly ScheduleWait[]
}

/** GateSummary is the versioned rollup a run ends with, and the JSON artifact it can write. */
export type GateSummary = {
  /** What the machine was carrying while this run happened; absent for a run that did not sample it. */
  contention?: ContentionReport
  elapsedMs: number
  /**
   * Every gate's `failures`, flattened and tagged with the gate that reported it, capped at
   * `MAX_FAILURES_TOTAL`. Absent when nothing failed, or when every failed gate's log matched no
   * recognized format.
   */
  failures?: readonly (ExtractedFailure & { gate: string })[]
  /** The first failing node, which is the one to act on. */
  firstFailure?: { logPath?: string; name: string; output: string }
  gates: readonly GateResult[]
  /** The earlier green run this one stood on instead of running; every gate is then `skipped`. */
  greenTree?: { at: string; lane: string; logRoot: string; toolchain: string; treeHash: string }
  /** The lane this run belongs to, which is also its artifact directory. */
  lane: string
  logRoot: string
  /**
   * Which other Tao lanes ran at any moment of this one. `contention` says how busy the machine
   * looked, which a broad lane trips on its own; this says whether the run was actually alone.
   */
  overlap?: OverlapReport
  /** What the schedule achieved and where it lost time; absent for a run that did not schedule. */
  schedule?: ScheduleReport
  status: 'failed' | 'passed'
  /**
   * Tests this run failed on and declined to fail the lane for, each with the recorded history that
   * earned it. Absent when nothing was demoted; never empty, because an empty list would read as a
   * finding rather than as its absence.
   */
  toleratedFlakes?: readonly ToleratedFlakeReport[]
  version: 2
  warnings: readonly string[]
}

/** ToleratedFlakeReport is one demoted test as the summary artifact publishes it. */
export type ToleratedFlakeReport = {
  /** The recorded history that demoted it, in one line. */
  evidence: string
  file: string
  id: string
  /** The node that failed on it. */
  node: string
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
  /** This run's scheduling measurements, when the caller measured them. */
  schedule?: ScheduleReport
  states: readonly WorkState[]
  /** The suite each node reports under, for a lane whose nodes are test shards. */
  suiteOf?: (name: string) => string | undefined
  /**
   * Tests the flake ledger accounted for, grouped by the node they failed in. A node listed here
   * exited non-zero and is reported `passed` anyway — so it is reported with the tests that bought
   * it that verdict, and the lane's verdict line says the lane leaned on them.
   */
  toleratedFlakes?: readonly ToleratedFlakeReport[]
}

const FAILURE_OUTPUT_LINES = 40
/** The raw tail kept beside a `First failure` excerpt once `Failed:` already names the tests. */
const SHORT_FAILURE_OUTPUT_LINES = 15
/** How many of one gate's own failures `extractFailures` keeps; the rest are counted, not dropped. */
const MAX_FAILURES_PER_GATE = 20
/** How many failures the summary's top-level rollup keeps, across every failed gate. */
const MAX_FAILURES_TOTAL = 40
/** How many lines of the top-level `Failed:` block a reader is shown before `… and N more`. */
const MAX_DISPLAYED_FAILURES = 20
const SUMMARY_VERSION = 2
const CHROME_PRE_DEVTOOLS_HOST_ABORT =
  /^HostEnvironmentError: Chrome exited before exposing DevTools \(exit none, signal SIGABRT\)$/m
const ASSERTION_DETAIL = /AssertionError|expect\(received\)/i

const FAILURE_SIGNATURES: readonly { kind: FailureKind; pattern: RegExp }[] = [
  // Each worktree's host lease is `studio-native-host:<bundle id>`; probing launches share one
  // machine-wide `studio-native-probe`.
  { kind: 'native-host-busy', pattern: /Machine resource 'studio-native-(?:host(?::[^']*)?|probe)' is busy/i },
  { kind: 'hutch-install-timeout', pattern: /Hutch install timed out after/i },
  { kind: 'electrobun-prepare-timeout', pattern: /Hutch electrobun prepare timed out after/i },
  {
    kind: 'native-runtime-exit',
    pattern:
      /(?:native runtime exited .* before (?:reporting|producing)|Native Studio runtime (?:exited with code|terminated by signal) \d+|Electrobun exited before writing its runtime probe)/i,
  },
  { kind: 'native-probe-timeout', pattern: /Timed out waiting for the Electrobun runtime probe/i },
  { kind: 'user-interruption', pattern: /\b(?:user interruption|was interrupted|interrupted before completion)\b/i },
  { kind: 'environment-setup', pattern: /pinned devenv profile is unavailable|command not found: (bun|node|just)/i },
  { kind: 'environment-setup', pattern: /^error: Cannot find (module|package)/im },
  { kind: 'optional-tooling', pattern: /\b(watchman|hutch|chrome|chromium|lsof|docker) (is )?not (installed|found)/i },
  // macOS can reject recursive cleanup inside generated and artifact trees even though those paths
  // are writable. Keep this narrower than EFAULT itself: a bad address from another syscall or a
  // source path is still a repository failure that needs investigation.
  {
    kind: 'sandbox-restriction',
    pattern:
      /\b(?:EFAULT:\s*bad address in system call argument|EPERM:\s*operation not permitted),\s*(?:rm|rmdir)\s+['"][^'"\r\n]*(?:[/\\](?:_gen_[^/\\'"\r\n]+|\.artifacts)(?:[/\\]|['"]))/im,
  },
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
  // Bun appends `(fail)` to every failed test, including one whose browser process was rejected by
  // the host before CDP existed. Recognize that exact boundary without letting it outrank a real
  // assertion reported elsewhere in the same browser run.
  if (CHROME_PRE_DEVTOOLS_HOST_ABORT.test(output) && !ASSERTION_DETAIL.test(output)) {
    return 'sandbox-restriction'
  }
  // A runner prints FAIL/(fail) for a timed-out test as well as for a wrong answer. Classify the
  // specific host/native signatures first, then the timeout with measured contention, and only
  // then fall back to the generic assertion banner.
  const signature = FAILURE_SIGNATURES.find(candidate =>
    candidate.kind !== 'test-assertion' && candidate.pattern.test(output)
  )
  if (signature !== undefined) {
    return signature.kind
  }
  if (describesTimeout(output)) {
    return context.contention?.contended === true ? 'machine-contention' : 'repository'
  }
  return FAILURE_SIGNATURES.find(candidate => candidate.kind === 'test-assertion' && candidate.pattern.test(output))
    ?.kind ?? 'repository'
}

/**
 * Structured failures. A failed gate's `summary.json` entry used to carry only a 40-line raw tail, so
 * a reader learned which node failed but not which test — that meant grepping the node's own log.
 * `extractFailures` reads the same full output `classifyFailure` does and pulls out the tests or
 * issues it names, trying one format at a time and stopping at the first that matches anything. A log
 * this recognizes no format for contributes nothing: the raw tail beside it is still the fallback, and
 * a guessed match would be worse than none.
 */

/** One failing Bun test: `(fail) <name> [<ms>]`, with the nearest `error:` line and stack frame above it. */
const BUN_FAIL_LINE = /^\(fail\)\s+(.+?)(?:\s*\[[\d.]+\s*m?s\])?\s*$/
const BUN_PASS_LINE = /^\(pass\)\s+/
const BUN_ERROR_LINE = /^error:\s*(.+)$/
/** A stack frame naming a source location, shared by Bun's and Jest's own transcripts. */
const STACK_FRAME = /\bat .*\(([^()\s]+:\d+:\d+)\)\s*$/
/** Bun's own header above a failing test's source excerpt, when the `at` frame scrolled out of a tail. */
const BUN_FILE_HEADER = /^(\S+\.test\.tsx?):\s*$/

function parseBunFailures(output: string): ExtractedFailure[] {
  const lines = output.split('\n')
  const failures: ExtractedFailure[] = []
  let blockStart = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const fail = line.match(BUN_FAIL_LINE)
    if (fail !== null) {
      const block = lines.slice(blockStart, index)
      failures.push({
        error: lastMatch(block, BUN_ERROR_LINE)?.[1],
        file: lastMatch(block, STACK_FRAME)?.[1] ?? lastMatch(block, BUN_FILE_HEADER)?.[1],
        test: fail[1]!.trim(),
      })
      blockStart = index + 1
      continue
    }
    if (BUN_PASS_LINE.test(line)) {
      blockStart = index + 1
    }
  }
  return failures
}

/** One Jest failure header: `● <describe path> › <test>`, Jest's own composition of nested describes. */
const JEST_BULLET_LINE = /^\s*●\s+(.+?)\s*$/
/** A line from Jest's own source-frame excerpt, which is not the assertion message above it. */
const JEST_CODE_FRAME_LINE = /^\s*(?:>?\s*\d+\s*\||\|)/

function parseJestFailures(output: string): ExtractedFailure[] {
  const lines = output.split('\n')
  const headers = lines
    .map((line, index) => (JEST_BULLET_LINE.test(line) ? index : undefined))
    .filter((index): index is number => index !== undefined)
  return headers.map((headerIndex, order) => {
    const block = lines.slice(headerIndex + 1, headers[order + 1] ?? lines.length)
    const errorLine = block.find(line =>
      line.trim().length > 0 && !JEST_CODE_FRAME_LINE.test(line) && !STACK_FRAME.test(line)
    )
    return {
      error: errorLine?.trim(),
      file: firstMatch(block, STACK_FRAME)?.[1],
      test: lines[headerIndex]!.match(JEST_BULLET_LINE)![1]!.trim(),
    }
  })
}

/** One suite line from the repository's own sharded test runner, as `TestResultSummary.printSuiteSummaries` writes it. */
const SHARDED_SUITE_LINE = /^- (\S+): (failed|passed|skipped); tests (\d+|n\/a); pass (\d+|n\/a); fail (\d+|n\/a)/

function parseShardedRunnerFailures(output: string): ExtractedFailure[] {
  const failures: ExtractedFailure[] = []
  for (const line of output.split('\n')) {
    const match = line.match(SHARDED_SUITE_LINE)
    if (match === null || match[2] !== 'failed') {
      continue
    }
    const [, suite, , tests, pass, fail] = match
    failures.push({ error: `${fail} of ${tests} tests failed (${pass} passed)`, test: suite! })
  }
  return failures
}

/** One `tsc` diagnostic: `file(line,col): error TSxxxx: message`. */
const TSC_ERROR_LINE = /^(\S+\.tsx?)\((\d+),(\d+)\): error (TS\d+): (.+)$/

function parseTypecheckFailures(output: string): ExtractedFailure[] {
  const failures: ExtractedFailure[] = []
  for (const line of output.split('\n')) {
    const match = line.match(TSC_ERROR_LINE)
    if (match === null) {
      continue
    }
    const [, file, lineNumber, column, code, message] = match
    failures.push({ error: `${code}: ${message}`, file: `${file}:${lineNumber}:${column}`, test: line.trim() })
  }
  return failures
}

/** `repo-lint` and `dead-exports` both prefix one issue per line with their own name. */
const ISSUE_LINE_PREFIXES = ['repo lint: ', 'dead exports: ']
const ISSUE_LOCATION = /^(\S+:\d+)\s+(.+)$/

/**
 * parseIssueLineFailures reads one issue per line, `test` set to the issue's own detail and `file`
 * to the `path:line` head it followed — not the whole prefixed line, which `formatFailureLine` would
 * otherwise have nothing left to add without repeating it. A prefixed line with no `path:line` head —
 * `dead exports:`'s own trailing count, not an issue — names nothing this can point a reader at, so
 * it is skipped rather than reported as a failure with no location.
 */
function parseIssueLineFailures(output: string): ExtractedFailure[] {
  const failures: ExtractedFailure[] = []
  for (const line of output.split('\n')) {
    const prefix = ISSUE_LINE_PREFIXES.find(candidate => line.startsWith(candidate))
    if (prefix === undefined) {
      continue
    }
    const location = line.slice(prefix.length).match(ISSUE_LOCATION)
    if (location === null) {
      continue
    }
    failures.push({ file: location[1], test: location[2]! })
  }
  return failures
}

/**
 * extractFailures tries one recognized log format at a time and returns the first that matched
 * anything. ANSI is stripped first: every format below is matched against plain text, the same way a
 * reader would read it off a terminal.
 */
function extractFailures(output: string): ExtractedFailure[] {
  const stripped = OutputText.stripAnsi(output)
  const parsers = [
    parseBunFailures,
    parseJestFailures,
    parseShardedRunnerFailures,
    parseTypecheckFailures,
    parseIssueLineFailures,
  ]
  for (const parse of parsers) {
    const found = parse(stripped)
    if (found.length > 0) {
      return found
    }
  }
  return []
}

function lastMatch(lines: readonly string[], pattern: RegExp): RegExpMatchArray | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]!.match(pattern)
    if (match !== null) {
      return match
    }
  }
  return undefined
}

function firstMatch(lines: readonly string[], pattern: RegExp): RegExpMatchArray | undefined {
  for (const line of lines) {
    const match = line.match(pattern)
    if (match !== null) {
      return match
    }
  }
  return undefined
}

/** buildSummary rolls one finished run up into the versioned summary it writes and prints. */
export function buildSummary(options: BuildSummaryOptions): GateSummary {
  const declaredSkips = options.declaredSkips ?? []
  const toleratedFlakes = options.toleratedFlakes ?? []
  const toleratedByNode = new Map<string, string[]>()
  for (const flake of toleratedFlakes) {
    toleratedByNode.set(flake.node, [...toleratedByNode.get(flake.node) ?? [], flake.id])
  }
  const results = new Map<string, GateResult>(
    options.states.map(state => {
      const suite = options.suiteOf?.(state.name)
      const result = tolerate(nodeResult(state, options.expectedMs, options.contention), toleratedByNode)
      return [state.name, suite === undefined ? result : { ...result, suite }]
    }),
  )
  const order = options.order ?? options.states.map(state => state.name)
  const ordered = [
    ...declaredSkips,
    ...order.map(name => results.get(name)).filter((result): result is GateResult => result !== undefined),
  ]
  const firstFailed = order.map(name => results.get(name)).find(result => result?.status === 'failed')
  const failedState = options.states.find(state => state.name === firstFailed?.name)
  const failures = ordered
    .filter(result => result.status === 'failed')
    .flatMap(result => (result.failures ?? []).map(failure => ({ ...failure, gate: result.name })))
    .slice(0, MAX_FAILURES_TOTAL)

  return {
    contention: options.contention,
    elapsedMs: Math.round(options.elapsedMs),
    failures: failures.length === 0 ? undefined : failures,
    firstFailure: firstFailed === undefined ? undefined : {
      logPath: firstFailed.logPath,
      name: firstFailed.name,
      output: lastLines(failedState?.fullOutput ?? '', FAILURE_OUTPUT_LINES),
    },
    gates: ordered,
    lane: options.lane,
    logRoot: options.logRoot,
    schedule: options.schedule,
    status: options.interrupted === true || ordered.some(result => result.status === 'failed') ? 'failed' : 'passed',
    toleratedFlakes: toleratedFlakes.length === 0 ? undefined : toleratedFlakes,
    version: SUMMARY_VERSION,
    warnings: [
      ...toleranceWarnings(toleratedFlakes),
      ...contentionWarnings(ordered, options.contention),
      ...collectWarnings(options.states),
    ],
  }
}

/**
 * tolerate turns a node whose every failure the ledger accounted for into a pass that still carries
 * its non-zero exit code and names what it failed on. The exit code is deliberately kept: a reader
 * who finds `passed` beside `exit 1` should be able to see immediately that a judgment was made.
 */
function tolerate(result: GateResult, toleratedByNode: ReadonlyMap<string, readonly string[]>): GateResult {
  const tolerated = toleratedByNode.get(result.name)
  if (tolerated === undefined || result.status !== 'failed') {
    return result
  }
  return {
    ...result,
    failureKind: undefined,
    // A demoted node is reported `passed`, so it carries no failures either — `failures` names what
    // a *failed* gate's log points to, and this one is not that anymore.
    failures: undefined,
    failuresTruncated: undefined,
    reason: `failed only on ${tolerated.length} known flake${tolerated.length === 1 ? '' : 's'}: ${
      tolerated.join(', ')
    }`,
    status: 'passed',
    tolerated,
  }
}

/**
 * The warning a demoted lane owes its reader, first in the list because it is the one that changes
 * what the verdict above it means. Each test is named with the history that demoted it, so the
 * judgment can be disagreed with rather than merely noticed.
 *
 * Exported because the test lane prints no gate rollup and therefore never reaches
 * `formatGateSummary`, which is where every other lane's reader is handed these lines. It prints
 * them itself, from here, so the two lanes owe their readers the same words.
 */
export function toleranceWarnings(tolerated: readonly ToleratedFlakeReport[]): string[] {
  if (tolerated.length === 0) {
    return []
  }
  return [
    `${tolerated.length} recorded flake${tolerated.length === 1 ? '' : 's'} failed in this run and did not fail it:`,
    ...tolerated.map(flake => `  ${flake.id} (in ${flake.node}) — ${flake.evidence}`),
    '  see the full history with ./agent report-test-stats; editing the test file withdraws its tolerance,'
    + ' and so does failing three runs in a row',
  ]
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

/**
 * VerdictOptions decides how the verdict line is rendered. Color is passed in rather than sensed
 * here: the formatter returns a string its caller may write to a terminal, a pipe, or a log file,
 * and only the caller knows which. `WorkReporter.colorizes` is the one place that decides.
 */
export type VerdictOptions = {
  /** Paint the verdict green or red. Off by default, so nothing writes escape codes by accident. */
  color?: boolean
}

/**
 * formatVerdict states a lane's outcome in the one line it ends with, green or red, so the verdict
 * is seen rather than counted out of the rollup above it. A failure names the node to go to first,
 * because a bare FAILED sends a reader straight back to scrolling.
 */
export function formatVerdict(summary: GateSummary, options: VerdictOptions = {}): string {
  const elapsed = OutputText.formatElapsed(summary.elapsedMs)
  const failure = summary.firstFailure === undefined ? '' : ` — first failure: ${summary.firstFailure.name}`
  // A pass that rested on a demoted flake says so here, in the one line a reader is guaranteed to
  // read. Anywhere else it is a note beside a green lane, which is a note nobody reads.
  const count = summary.toleratedFlakes?.length ?? 0
  const tolerated = count === 0 ? '' : ` — tolerating ${count} known flake${count === 1 ? '' : 's'}`
  const verdict = summary.status === 'passed'
    ? `${summary.lane}: PASSED in ${elapsed}${tolerated}`
    : `${summary.lane}: FAILED in ${elapsed}${failure}${tolerated}`
  if (options.color !== true) {
    return verdict
  }
  return summary.status === 'passed' ? HCI.green(verdict) : HCI.red(verdict)
}

/** formatGateSummary renders the rollup a run ends with, verdict last. */
export function formatGateSummary(summary: GateSummary, options: VerdictOptions = {}): string {
  const lines = ['', 'Verification summary:']
  const rolled = rollupSuites(summary.gates)
  for (const gate of rolled) {
    const cost = gate.status === 'skipped' ? '' : ` ${OutputText.formatElapsed(gate.elapsedMs)}`
    const reason = gate.reason === undefined ? '' : ` — ${gate.reason}`
    lines.push(`- ${gate.name}: ${gate.status}${cost}${reason}`)
    // A failing suite has to name the shard that failed, or its log cannot be found.
    for (const shard of failingShardsOf(gate, summary.gates)) {
      lines.push(`  - ${shard.name}: failed — ${shard.reason ?? 'see its log'}`)
    }
  }
  for (const warning of summary.warnings) {
    lines.push(`! ${warning}`)
  }
  lines.push(
    `${rolled.filter(gate => gate.status === 'passed').length} passed, `
      + `${rolled.filter(gate => gate.status === 'failed').length} failed, `
      + `${rolled.filter(gate => gate.status === 'skipped').length} skipped `
      + `in ${OutputText.formatElapsed(summary.elapsedMs)}`,
  )
  if (summary.schedule !== undefined) {
    lines.push(WorkSchedule.formatScheduleReport(summary.schedule))
  }
  lines.push(`Logs: ${FS.displayPath(summary.logRoot)}`)
  lines.push(`Summary: ${FS.displayPath(FS.resolvePath(RunArtifacts.SUMMARY_FILE, summary.logRoot))}`)
  lines.push(...formatFailuresBlock(summary.failures ?? [], Repo.getRoot()))
  if (summary.firstFailure !== undefined) {
    lines.push('', `First failure — ${summary.firstFailure.name}:`)
    // Once `Failed:` above already names every test a log matched, the raw tail beside it is read
    // for corroboration, not discovery, so it costs a reader less to scroll past.
    const excerptLimit = (summary.failures?.length ?? 0) > 0 ? SHORT_FAILURE_OUTPUT_LINES : FAILURE_OUTPUT_LINES
    lines.push(lastLines(summary.firstFailure.output, excerptLimit))
    if (summary.firstFailure.logPath !== undefined) {
      lines.push(`Full log: ${FS.displayPath(summary.firstFailure.logPath)}`)
    }
  }
  // Last, after the artifact paths and the failure excerpt, because a verdict a reader has to
  // scroll back to is one the rollup already told them.
  lines.push(formatVerdict(summary, options))
  return lines.join('\n')
}

/**
 * formatFailuresBlock names every test or issue a failed run's gates pointed to, in one place, before
 * the raw tail a reader used to have to open a log to get the same answer from. Nothing when nothing
 * was extracted, so a run whose logs matched no recognized format reads exactly as it did before this
 * existed.
 */
function formatFailuresBlock(
  failures: readonly (ExtractedFailure & { gate: string })[],
  repositoryRoot: string,
): string[] {
  if (failures.length === 0) {
    return []
  }
  const visible = failures.slice(0, MAX_DISPLAYED_FAILURES)
  const omitted = failures.length - visible.length
  return [
    '',
    'Failed:',
    ...visible.map(failure => `${FAILED_LINE_PREFIX}${formatFailureLine(failure, repositoryRoot)}`),
    ...(omitted > 0 ? [`… and ${omitted} more`] : []),
  ]
}

const FAILED_LINE_PREFIX = '- '
const FAILED_LINE_ERROR_PREFIX = ' — '

/**
 * formatFailureLine renders one failure at `FAILED_LINE_WIDTH`, truncating only free-form prose when
 * the line runs long — `gate › test` and `(file:line)` are what a reader clicks or greps on next, and
 * a truncated line number reads as a wrong one, not a short one. `error` and `file` are each dropped
 * when `test` already carries the same text, which is what an issue-line failure's own detail does —
 * a guard kept here rather than trusted to every parser that can feed this.
 */
function formatFailureLine(failure: ExtractedFailure & { gate: string }, repositoryRoot: string): string {
  const file = dedupedFileSuffix(failure, repositoryRoot)
  const error = dedupedError(failure)
  const prefix = `${failure.gate} › `
  if (error === undefined) {
    const fixedWidth = FAILED_LINE_PREFIX.length + prefix.length + file.length
    const budget = Math.max(0, FAILED_LINE_WIDTH - fixedWidth)
    return `${prefix}${truncateToWidth(failure.test, budget)}${file}`
  }
  const test = `${prefix}${failure.test}`
  const fixedWidth = FAILED_LINE_PREFIX.length + test.length + FAILED_LINE_ERROR_PREFIX.length + file.length
  const errorBudget = Math.max(0, FAILED_LINE_WIDTH - fixedWidth)
  return `${test}${FAILED_LINE_ERROR_PREFIX}${truncateToWidth(error, errorBudget)}${file}`
}

/** dedupedError is `failure.error`, or undefined when `test` already carries the same text — the
 * shape an issue-line failure's own detail would otherwise repeat once past a source that has since
 * been fixed to not set both. */
function dedupedError(failure: ExtractedFailure): string | undefined {
  return failure.error === undefined || failure.test.includes(failure.error) ? undefined : failure.error
}

/** dedupedFileSuffix is the `(file:line)` a rendered line adds, empty when `test` already names the
 * same location. */
function dedupedFileSuffix(failure: ExtractedFailure, repositoryRoot: string): string {
  if (failure.file === undefined) {
    return ''
  }
  const relative = relativizeFailureFile(failure.file, repositoryRoot)
  if (failure.test.includes(relative) || failure.test.includes(failure.file)) {
    return ''
  }
  return ` (${relative})`
}

/**
 * relativizeFailureFile rewrites an absolute path a gate printed to one relative to the repository
 * root, so it survives `FAILED_LINE_WIDTH` next to the line number that makes it useful — an
 * absolute worktree path routinely ate that budget on its own and left the line truncated before the
 * `:line` ever printed. A gate that already reported a repository-relative path, which is most of
 * them, is left exactly as it wrote it.
 */
function relativizeFailureFile(file: string, repositoryRoot: string): string {
  const separator = file.indexOf(':')
  const path = separator === -1 ? file : file.slice(0, separator)
  if (!FS.isAbsolute(path)) {
    return file
  }
  const suffix = separator === -1 ? '' : file.slice(separator)
  return `${FS.relativePath(repositoryRoot, path)}${suffix}`
}

/** A line long past this is one runaway assertion message, not information a reader needs all of. */
const FAILED_LINE_WIDTH = 160

function truncateToWidth(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

/**
 * rollupSuites reports a sharded suite as one line. A suite is a unit of reporting, not of
 * scheduling: `studio: passed in 6.1s (4 shards, 22.4s of work)` is what a reader needs, and the
 * individual shard names only matter when one of them failed.
 */
export function rollupSuites(gates: readonly GateResult[]): readonly GateResult[] {
  const rolled: GateResult[] = []
  const reported = new Set<string>()
  for (const gate of gates) {
    if (gate.suite === undefined || gate.suite === gate.name) {
      rolled.push(gate)
      continue
    }
    if (reported.has(gate.suite)) {
      continue
    }
    reported.add(gate.suite)
    rolled.push(mergeShards(gate.suite, gates.filter(candidate => candidate.suite === gate.suite)))
  }
  return rolled
}

/**
 * mergeShards states one suite's outcome from its shards'. The suite's wall time is its longest
 * shard, because the shards ran at once; the work is their sum, which is the number that says what
 * sharding bought.
 */
function mergeShards(suite: string, shards: readonly GateResult[]): GateResult {
  const workMs = shards.reduce((total, shard) => total + shard.elapsedMs, 0)
  const longest = Math.max(0, ...shards.map(shard => shard.elapsedMs))
  const failed = shards.filter(shard => shard.status === 'failed')
  const status: GateStatus = failed.length > 0
    ? 'failed'
    : shards.every(shard => shard.status === 'passed')
    ? 'passed'
    : 'skipped'
  // A suite reported as one line must not lose the fact that one of its shards only passed because
  // a flake was tolerated; that is the whole point of saying it out loud.
  const tolerated = shards.flatMap(shard => shard.tolerated ?? [])
  const skipped = shards.filter(shard => shard.status === 'skipped')
  const shardReason = `${shards.length} shards, ${OutputText.formatElapsed(workMs)} of work`
    + (skipped.length > 0 && skipped.length < shards.length
      ? `; ${skipped.length} not run: ${skipped[0]?.reason ?? 'incomplete'}`
      : '')
  return {
    elapsedMs: longest,
    failureKind: failed[0]?.failureKind,
    logPath: failed[0]?.logPath ?? shards[0]?.logPath,
    name: suite,
    reason: status === 'skipped'
      ? shards.every(shard => shard.status === 'skipped')
        ? shards[0]?.reason
        : shardReason
      : tolerated.length === 0
      ? shardReason
      : `${shardReason}; tolerated ${tolerated.length} known flake${tolerated.length === 1 ? '' : 's'}`,
    retried: shards.some(shard => shard.retried === true),
    status,
    suite,
    ...(tolerated.length === 0 ? {} : { tolerated }),
  }
}

function failingShardsOf(gate: GateResult, gates: readonly GateResult[]): readonly GateResult[] {
  if (gate.suite === undefined || gate.status !== 'failed') {
    return []
  }
  return gates.filter(candidate =>
    candidate.suite === gate.suite && candidate.name !== gate.suite && candidate.status === 'failed'
  )
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
  // A node that failed again on its isolated retry has had the machine ruled out for it, so the
  // contention this run recorded no longer explains its failure.
  const failureKind = failed
    ? classifyFailure(state.fullOutput, {
      contention: state.retried === true ? undefined : contention,
      interrupted: state.failure?.kind === 'interrupted',
    })
    : undefined
  const found = failed ? extractFailures(state.fullOutput) : []
  const failures = found.slice(0, MAX_FAILURES_PER_GATE)
  return {
    elapsedMs: Math.round(state.elapsedMs),
    exitCode,
    expectedMs: expectedMs?.(state.name),
    failureKind,
    failures: failures.length === 0 ? undefined : failures,
    failuresTruncated: found.length > MAX_FAILURES_PER_GATE ? found.length - MAX_FAILURES_PER_GATE : undefined,
    logPath: state.logPath,
    name: state.name,
    needs: state.node.needs,
    after: state.node.after,
    reason: state.reason ?? (failed ? `exited ${exitCode ?? 'unknown'} (${failureKind})` : undefined),
    resources: state.node.resources,
    retried: state.retried,
    status: state.status === 'passed' ? 'passed' : failed ? 'failed' : 'skipped',
    waits: reportableWaits(state.waits),
  }
}

/**
 * reportableWaits keeps only the waits worth acting on, and omits the field entirely when none are.
 * An empty array would read as a finding — "this node was held, by nothing" — where absence reads
 * as what it is.
 */
function reportableWaits(waits: WorkState['waits']): readonly ScheduleWait[] | undefined {
  const reportable = (waits ?? []).filter(wait => wait.ms >= WorkSchedule.WAIT_NOISE_MS)
  return reportable.length === 0 ? undefined : reportable
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

/** A verdict line, as `formatVerdict` writes it: `<lane>: PASSED in 1.0s`, or `FAILED` with the rest. */
const LANE_VERDICT_LINE = /^\S[\w./-]*: (?:PASSED|FAILED) in /
const LANE_LOGS_LINE = /^Logs: /
const LANE_SUMMARY_LINE = /^Summary: /

/**
 * extractLaneReport pulls a nested `./dev gates` lane's own short report — its verdict, its `Failed:`
 * block, and where its logs live — out of that lane's full captured output, so a caller that stopped
 * streaming a child's output live (`MergeWithMain`'s non-interactive landing) can still show what the
 * lane told its own reader, instead of nothing or everything.
 *
 * A lane the caller ran produced no `Verification summary:` block at all when nothing in it matched
 * any recognized structure — `dead-exports`, run directly rather than through `./dev gates`, is the
 * one case in this repository — so the fallback is the same short raw tail every other reader of a
 * failed log gets, rather than silence.
 */
export function extractLaneReport(output: string): string[] {
  const structured = structuredLaneReportLines(output)
  if (structured.length > 0) {
    return structured
  }
  const fallback = lastLines(output, SHORT_FAILURE_OUTPUT_LINES)
  return fallback.length === 0 ? [] : fallback.split('\n')
}

function structuredLaneReportLines(output: string): string[] {
  const lines: string[] = []
  let inFailedBlock = false
  for (const line of OutputText.stripAnsi(output).split('\n')) {
    if (line === 'Failed:') {
      inFailedBlock = true
      lines.push(line)
      continue
    }
    if (inFailedBlock) {
      if (line.trim().length === 0) {
        inFailedBlock = false
        continue
      }
      lines.push(line)
      continue
    }
    if (LANE_VERDICT_LINE.test(line) || LANE_LOGS_LINE.test(line) || LANE_SUMMARY_LINE.test(line)) {
      lines.push(line)
    }
  }
  return lines
}
