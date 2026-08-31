import { CLI, FS, HCI, Platform, Repo, Time } from '@shared'
import { OutputText } from '../cli/OutputText'

/**
 * `check` and `verify` run several independent gates at once. Just's `[parallel]` interleaves
 * their output and then says nothing about the run as a whole, so a failure is found by scrolling.
 * This runner keeps the streaming and adds the part that was missing: one rollup naming every
 * gate, its status and cost, where its log is, and the first failure worth acting on.
 *
 * The Justfile still decides which gates belong to which lane; this owns only how they run and
 * how the result is reported.
 */

/** GateStatus is what happened to one gate. `skipped` is never reported as `passed`. */
export type GateStatus = 'failed' | 'passed' | 'skipped'

/**
 * Why a gate failed, at the level that decides who fixes it. The four are genuinely different
 * jobs: set the environment up, install an optional tool, run the command outside the sandbox,
 * or change the repository. Reporting them as one undifferentiated failure sends every one of
 * them to the same wrong place.
 */
export type FailureKind = 'environment-setup' | 'optional-tooling' | 'repository' | 'sandbox-restriction'

const FAILURE_SIGNATURES: readonly { kind: FailureKind; pattern: RegExp }[] = [
  { kind: 'environment-setup', pattern: /pinned devenv profile is unavailable|command not found: (bun|node|just)/i },
  { kind: 'environment-setup', pattern: /^error: Cannot find (module|package)/im },
  { kind: 'optional-tooling', pattern: /\b(watchman|hutch|chrome|chromium|lsof|docker) (is )?not (installed|found)/i },
  // Last, and anchored to a line of its own: `EPERM` inside a test's own assertion text is a
  // repository failure, not a host restriction, and it is far more common than the real thing.
  {
    kind: 'sandbox-restriction',
    pattern: /^(?!.*expect).*\b(operation not permitted|PermissionDenied|EPERM|EACCES)\b/im,
  },
]

/** classifyFailure names the kind of failure a gate's output describes. */
export function classifyFailure(output: string): FailureKind {
  return FAILURE_SIGNATURES.find(signature => signature.pattern.test(output))?.kind ?? 'repository'
}

/** GateResult records one gate's outcome. */
export type GateResult = {
  elapsedMs: number
  exitCode?: number
  logPath?: string
  name: string
  /** How a failure should be acted on, when the gate failed. */
  failureKind?: FailureKind
  /** Why a gate was skipped, or why a failure happened, in one line. */
  reason?: string
  status: GateStatus
}

/** GateSummary is the versioned rollup a run ends with, and the JSON artifact it can write. */
export type GateSummary = {
  elapsedMs: number
  /** The first failing gate, which is the one to act on. */
  firstFailure?: { logPath?: string; name: string; output: string }
  gates: readonly GateResult[]
  logRoot: string
  status: 'failed' | 'passed'
  version: 1
  warnings: readonly string[]
}

export type RunGatesOptions = {
  /** Gate recipe names, in the order the Justfile declared them. */
  gates: readonly string[]
  jobs?: number
  /** Path to write the JSON summary to, when the caller wants an artifact. */
  jsonPath?: string
  logRoot?: string
  now?: () => number
  repositoryRoot?: string
  /** Gates deliberately not run in this lane, as `name=reason`. */
  skipped?: readonly string[]
  /** Injected so tests observe orchestration without running the real recipes. */
  runGate?: (name: string, logPath: string) => Promise<{ exitCode: number; output: string }>
}

const FAILURE_OUTPUT_LINES = 40

/** Lines worth surfacing from a gate that still passed, including tool diagnostics. */
const WARNING_PATTERN = /\b(warning|warn):|is declared but never referenced|deprecated/i

/** runGates executes every gate, streams their output, and returns the rollup. */
export async function runGates(options: RunGatesOptions): Promise<GateSummary> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const now = options.now ?? Time.nowMs
  const logRoot = options.logRoot ?? FS.resolvePath(`.artifacts/logs/verify/${runStamp()}`, repositoryRoot)
  await FS.mkdir(logRoot)

  const startedAt = now()
  const outputs = new Map<string, string>()
  const results = new Map<string, GateResult>()
  // A gate that is both run and declared skipped is run: the declaration is stale, and counting
  // it twice would make the totals disagree with the list above them.
  const skipped = (options.skipped ?? []).map(splitSkip).filter(([name]) => !options.gates.includes(name))
  for (const [name, reason] of skipped) {
    results.set(name, { elapsedMs: 0, name, reason, status: 'skipped' })
  }

  const runOne = options.runGate ?? ((name, logPath) => runJustRecipe(name, logPath, repositoryRoot))
  const queue = [...options.gates]
  const workers = Array.from({ length: Math.max(1, Math.min(options.jobs ?? Platform.cpuCount(), queue.length)) })
  await Promise.all(workers.map(async () => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      const logPath = FS.resolvePath(`${name.replace(/^_/, '')}.log`, logRoot)
      const gateStartedAt = now()
      const result = await runOne(name, logPath)
      outputs.set(name, result.output)
      results.set(name, {
        elapsedMs: Math.round(now() - gateStartedAt),
        exitCode: result.exitCode,
        failureKind: result.exitCode === 0 ? undefined : classifyFailure(result.output),
        logPath,
        name,
        reason: result.exitCode === 0
          ? undefined
          : `exited ${result.exitCode} (${classifyFailure(result.output)})`,
        status: result.exitCode === 0 ? 'passed' : 'failed',
      })
    }
  }))

  const ordered = [...skipped.map(([name]) => name), ...options.gates]
    .map(name => results.get(name))
    .filter((result): result is GateResult => result !== undefined)
  const firstFailed = options.gates.map(name => results.get(name)).find(result => result?.status === 'failed')
  const summary: GateSummary = {
    elapsedMs: Math.round(now() - startedAt),
    firstFailure: firstFailed === undefined ? undefined : {
      logPath: firstFailed.logPath,
      name: firstFailed.name,
      output: lastLines(outputs.get(firstFailed.name) ?? '', FAILURE_OUTPUT_LINES),
    },
    gates: ordered,
    logRoot,
    status: ordered.some(result => result.status === 'failed') ? 'failed' : 'passed',
    version: 1,
    warnings: collectWarnings(outputs),
  }
  if (options.jsonPath !== undefined) {
    await FS.writeJson(FS.resolvePath(options.jsonPath, repositoryRoot), summary)
  }
  return summary
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
  if (summary.firstFailure !== undefined) {
    lines.push('', `First failure — ${summary.firstFailure.name}:`)
    lines.push(summary.firstFailure.output)
    if (summary.firstFailure.logPath !== undefined) {
      lines.push(`Full log: ${FS.displayPath(summary.firstFailure.logPath)}`)
    }
  }
  return lines.join('\n')
}

/** gateExitCode never hides the originating status: one failed gate fails the wrapper. */
export function gateExitCode(summary: GateSummary): number {
  return summary.status === 'failed' ? 1 : 0
}

/** Streams a recipe's output with its name in front, while also retaining it for the rollup. */
async function runJustRecipe(
  name: string,
  logPath: string,
  repositoryRoot: string,
): Promise<{ exitCode: number; output: string }> {
  let output = ''
  const result = await CLI.run('just', {
    args: [name],
    cwd: repositoryRoot,
    onOutput: (stream, chunk) => {
      const text = chunk.toString('utf8')
      output += text
      HCI.logProcessOutput(name.replace(/^_/, ''), text.replace(/\n$/, ''), { stderr: stream === 'stderr' })
    },
    stdio: 'pipe',
  })
  await FS.writeText(logPath, output)
  return { exitCode: result.error === undefined ? result.exitCode ?? 1 : 1, output }
}

/** Warnings a gate printed but did not fail on, so they are visible without scrolling. */
function collectWarnings(outputs: ReadonlyMap<string, string>): string[] {
  const warnings = new Set<string>()
  for (const [name, output] of outputs) {
    for (const line of output.split('\n')) {
      if (WARNING_PATTERN.test(line) && line.trim().length > 0) {
        warnings.add(`${name}: ${OutputText.stripAnsi(line).trim()}`)
      }
    }
  }
  return [...warnings]
}

function splitSkip(entry: string): [string, string] {
  const separator = entry.indexOf('=')
  return separator === -1
    ? [entry, 'not run in this lane']
    : [entry.slice(0, separator), entry.slice(separator + 1)]
}

function lastLines(output: string, limit: number): string {
  const lines = output.split('\n').filter(line => line.trim().length > 0)
  return lines.slice(-limit).join('\n')
}

function formatMilliseconds(elapsedMs: number): string {
  return elapsedMs >= 1_000 ? `${(elapsedMs / 1_000).toFixed(1)}s` : `${elapsedMs}ms`
}

function runStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
