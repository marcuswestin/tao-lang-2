import { Assert, CLI, Errors, FS, HCI, Platform } from '@shared'
import { MachineLanes } from '../repository-tests/MachineLanes'
import { type PerformanceSampleSummary, summarizeSamples } from './language-performance'

/*
 * The measurement `ADMITTED_LANES` was chosen without.
 *
 * `MachineLanes` admits whole lanes in arrival order and caps the broad ones at `ADMITTED_LANES`.
 * That constant was derived from DEVENV-094's own buckets — 260 lane runs recorded on 2026-09-17,
 * bucketed by how many peers overlapped them. Those buckets measured lanes running under the
 * *previous* policy, where every lane was simultaneously throttled to a fraction of the machine, and
 * they were built from per-node durations that have since been shown to be process-elapsed spans
 * rather than work. So the constant that governs how every agent on this machine is scheduled rests
 * on numbers taken from a system that no longer exists, through an instrument that has since been
 * replaced. This command is how that gets settled with evidence instead.
 *
 * It measures two things, because the policy exists for two reasons and only one of them is time.
 * The obvious one is completion: DEVENV-094's acceptance asks that with ten lanes requested at once,
 * the median completion of the first three stays within 1.5x of the uncontended median. The one that
 * actually motivated the work is correctness: on 2026-09-17 two suites failed their per-test hang
 * guards purely from starvation, and both passed in 0.6s when run alone. A configuration that
 * finishes sooner while still starving tests into false reds is not better, and completion time
 * cannot see the difference. `falseReds` is that second axis.
 */

/** How far above `cpuCount` the load average may sit and the machine still count as quiet. */
const QUIET_LOAD_RATIO = 0.5

/** One lane's result, read from the lane's own `summary.json` rather than inferred from its exit. */
export type AdmissionLaneOutcome = {
  /** Repository root the lane ran in, so a failure can be reproduced by hand. */
  repositoryRoot: string
  startedAt: string
  wallMs: number
  status: string
  /** Gates that did not pass. Their names are the false-red evidence, not just their count. */
  failedGates: readonly string[]
  /** What the lane itself recorded about the machine while it ran. */
  peakLanes: number
  peakLoadAverage: number
  /**
   * False when the lane wrote no `summary.json`, which means it never ran rather than that it ran
   * badly. Pointing the experiment at a checkout that does not exist produced a 0ms sample and a met
   * acceptance until this existed — a measurement tool that reports success from nothing is worse
   * than one that reports nothing.
   */
  measured: boolean
}

/** One phase of the experiment: the lanes started together, and what the machine did during it. */
export type AdmissionPhase = {
  requestedLanes: number
  outcomes: readonly AdmissionLaneOutcome[]
  summary: PerformanceSampleSummary
  /** Median of the first `n` lanes to finish, which is what the acceptance bar is written against. */
  firstCompletionsMedianMs: number
  peakLoadAverage: number
  falseReds: number
  /** Lanes that produced no summary at all. Any of these makes the phase's numbers meaningless. */
  unmeasured: number
}

export type AdmissionReport = {
  lane: string
  admittedLanes: number
  cpuCount: number
  /** How many of the earliest completions the acceptance bar is measured over. */
  firstCompletions: number
  baseline: AdmissionPhase
  trial: AdmissionPhase
  /** Trial's first-completions median over the uncontended median. The bar is 1.5. */
  contentionRatio: number
  acceptanceMet: boolean
}

export type AdmissionExperimentOptions = {
  /** Lane recipe to run in each checkout. The bar is written about the broad lanes. */
  lane?: string
  /** How many lanes to start at once. DEVENV-094's acceptance is written for ten. */
  lanes?: number
  /** How many times to run the lane alone first, to get an uncontended median worth comparing to. */
  repeats?: number
  /** Checkouts to run in, one per lane. Provisioning them is the caller's business, not this file's. */
  repositoryRoots: readonly string[]
  /** Skip the quiet-machine refusal. Only for a caller that has already established quiet itself. */
  allowBusyMachine?: boolean
}

export type AdmissionExperimentDependencies = {
  activeLanes: () => Promise<readonly { lane: string; repositoryRoot: string }[]>
  cpuCount: () => number
  loadAverage: () => number
  now: () => Date
  readJson: <ValueT>(path: string) => Promise<ValueT>
  run: (command: string, spec: CLI.CommandSpec) => Promise<CLI.CommandResult>
}

const defaultDependencies: AdmissionExperimentDependencies = {
  activeLanes: async () => await MachineLanes.activeLanes(),
  cpuCount: Platform.cpuCount,
  loadAverage: Platform.loadAverage,
  now: () => new Date(),
  readJson: FS.readJson,
  run: CLI.run,
}

/** The subset of a lane's `summary.json` this experiment reads. */
type LaneSummary = {
  contention?: { peakLanes?: number; peakLoadAverage?: number }
  elapsedMs?: number
  gates?: readonly { name?: string; status?: string }[]
  status?: string
}

/**
 * assertMachineQuiet refuses to measure on a machine that is already busy.
 *
 * It asks two independent questions, because neither answer is sufficient alone and DEVENV-094 says
 * why: only top-level lanes register, so a bare `bun test`, a `./tao test`, an `xcodebuild` or a
 * hand-started smoke is invisible to the registry. Measured 2026-09-19, this machine sat at load
 * 22.2 on 18 CPUs with *zero* registered lanes. A lane count of zero therefore does not mean a quiet
 * machine, and a reading taken on a busy one is not a measurement of admission — it is a measurement
 * of whatever else was running.
 */
export async function assertMachineQuiet(
  dependencies: AdmissionExperimentDependencies = defaultDependencies,
): Promise<void> {
  const lanes = await dependencies.activeLanes()
  if (lanes.length > 0) {
    const named = lanes.map(lane => `${lane.lane} in ${FS.basename(lane.repositoryRoot)}`).join(', ')
    Errors.throwUserInput(
      `The machine is not quiet: ${lanes.length} lane(s) registered (${named}). `
        + 'Wait for them to end, or re-run with the busy-machine override once you know what else is running.',
    )
  }
  const cpuCount = dependencies.cpuCount()
  const loadAverage = dependencies.loadAverage()
  if (loadAverage > cpuCount * QUIET_LOAD_RATIO) {
    Errors.throwUserInput(
      `The machine is not quiet: load ${loadAverage.toFixed(1)} on ${cpuCount} CPUs, with no lane registered. `
        + 'Something that does not register is using this machine; find it before measuring.',
    )
  }
}

/**
 * runAdmissionExperiment measures the uncontended lane first, then the same lane started N times at
 * once, and reports both against DEVENV-094's bar.
 *
 * The baseline runs in the first checkout rather than in a fresh one each time, so the two phases
 * differ in contention and in nothing else: same tree, same warm caches, same recorded green-tree
 * state. A baseline taken cold would flatter the trial by comparing a cold run to warm ones.
 */
export async function runAdmissionExperiment(
  options: AdmissionExperimentOptions,
  dependencies: AdmissionExperimentDependencies = defaultDependencies,
): Promise<AdmissionReport> {
  const lane = options.lane ?? 'verify'
  const requested = options.lanes ?? 10
  const repeats = options.repeats ?? 3
  const roots = options.repositoryRoots
  Assert.input(requested > 0, 'The experiment needs at least one lane.')
  Assert.input(repeats > 0, 'The experiment needs at least one baseline repeat.')
  Assert.input(
    roots.length >= requested,
    `The experiment needs one checkout per lane: ${requested} requested, ${roots.length} provided.`,
  )

  if (options.allowBusyMachine !== true) {
    await assertMachineQuiet(dependencies)
  }

  const baselineRoot = definedRoot(roots, 0)
  const baselineOutcomes: AdmissionLaneOutcome[] = []
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    baselineOutcomes.push(await runLane(lane, baselineRoot, dependencies))
  }

  const trialOutcomes = await Promise.all(
    roots.slice(0, requested).map(async root => await runLane(lane, root, dependencies)),
  )

  // The bar is written about "the first three", so it is measured over the earliest completions
  // rather than over every lane: the whole point of a queue is that the last lane waits.
  const firstCompletions = Math.min(3, requested)
  const baseline = phaseOf(baselineOutcomes, repeats, baselineOutcomes.length)
  const trial = phaseOf(trialOutcomes, requested, firstCompletions)
  const contentionRatio = baseline.firstCompletionsMedianMs === 0
    ? 0
    : trial.firstCompletionsMedianMs / baseline.firstCompletionsMedianMs

  return {
    // A phase with an unmeasured lane has no numbers worth judging, so it can never meet the bar.
    acceptanceMet: contentionRatio <= 1.5
      && trial.falseReds === 0
      && trial.unmeasured === 0
      && baseline.unmeasured === 0,
    admittedLanes: MachineLanes.ADMITTED_LANES,
    baseline,
    contentionRatio,
    cpuCount: dependencies.cpuCount(),
    firstCompletions,
    lane,
    trial,
  }
}

async function runLane(
  lane: string,
  repositoryRoot: string,
  dependencies: AdmissionExperimentDependencies,
): Promise<AdmissionLaneOutcome> {
  const startedAt = dependencies.now()
  // `--no-cache` because a recorded green tree would let a lane finish without doing the work, and a
  // lane that skipped its work measures nothing about how the machine shares itself.
  const result = await dependencies.run('just', {
    args: [lane, '--no-cache'],
    cwd: repositoryRoot,
    env: { TAO_OUTPUT_MODE: 'quiet' },
  })
  const wallMs = dependencies.now().getTime() - startedAt.getTime()
  const summary = await readLaneSummary(lane, repositoryRoot, dependencies)

  return {
    failedGates: (summary?.gates ?? [])
      .filter(gate => gate.status !== undefined && gate.status !== 'passed' && gate.status !== 'skipped')
      .map(gate => gate.name ?? 'unnamed'),
    measured: summary !== undefined,
    peakLanes: summary?.contention?.peakLanes ?? 0,
    peakLoadAverage: summary?.contention?.peakLoadAverage ?? 0,
    repositoryRoot,
    startedAt: startedAt.toISOString(),
    // The lane's own elapsed time excludes process startup, which is what the bar is about; the
    // wall time is kept when the lane wrote no summary at all, which is itself a result.
    status: summary?.status ?? (result.exitCode === 0 ? 'passed' : 'failed'),
    wallMs: summary?.elapsedMs ?? wallMs,
  }
}

async function readLaneSummary(
  lane: string,
  repositoryRoot: string,
  dependencies: AdmissionExperimentDependencies,
): Promise<LaneSummary | undefined> {
  try {
    return await dependencies.readJson<LaneSummary>(
      FS.resolvePath(`.artifacts/logs/${lane}/latest/summary.json`, repositoryRoot),
    )
  } catch {
    // A lane that died before writing its summary is a result, not an error to propagate: the
    // caller still wants the other lanes' numbers and the fact that this one produced none.
    return undefined
  }
}

function phaseOf(
  outcomes: readonly AdmissionLaneOutcome[],
  requestedLanes: number,
  firstCompletions: number,
): AdmissionPhase {
  const byCompletion = [...outcomes].sort((left, right) => left.wallMs - right.wallMs)
  const earliest = byCompletion.slice(0, Math.max(1, firstCompletions))

  return {
    falseReds: outcomes.filter(outcome => outcome.failedGates.length > 0).length,
    unmeasured: outcomes.filter(outcome => !outcome.measured).length,
    firstCompletionsMedianMs: summarizeSamples(earliest.map(outcome => outcome.wallMs)).medianMs,
    outcomes,
    peakLoadAverage: Math.max(0, ...outcomes.map(outcome => outcome.peakLoadAverage)),
    requestedLanes,
    summary: summarizeSamples(outcomes.map(outcome => outcome.wallMs)),
  }
}

function definedRoot(roots: readonly string[], index: number): string {
  const root = roots[index]
  Assert.defined(root, 'The experiment needs at least one checkout.')
  return root
}

/** renderAdmissionReport prints the two phases and the bar, with the failing gate names when there are any. */
export function renderAdmissionReport(report: AdmissionReport): string {
  const lines = [
    `Admission experiment: ${report.lane} on ${report.cpuCount} CPUs, ADMITTED_LANES=${report.admittedLanes}`,
    `  uncontended: median ${seconds(report.baseline.summary.medianMs)} over ${report.baseline.requestedLanes} run(s)`,
    `  ${report.trial.requestedLanes} at once: first ${report.firstCompletions} median `
    + `${seconds(report.trial.firstCompletionsMedianMs)}, all median ${seconds(report.trial.summary.medianMs)}, `
    + `p95 ${seconds(report.trial.summary.p95Ms)}`,
    `  peak load: ${report.baseline.peakLoadAverage} alone, ${report.trial.peakLoadAverage} contended`,
    `  contention ratio: ${report.contentionRatio.toFixed(2)}x against a 1.5x bar`,
    `  lanes with a failing gate: ${report.trial.falseReds} contended, ${report.baseline.falseReds} alone`,
  ]
  if (report.trial.unmeasured > 0 || report.baseline.unmeasured > 0) {
    lines.push(
      `  UNMEASURED: ${report.trial.unmeasured} contended and ${report.baseline.unmeasured} baseline lane(s) `
        + 'wrote no summary; they never ran, and nothing here is a measurement.',
    )
  }
  for (const outcome of report.trial.outcomes) {
    if (!outcome.measured) {
      lines.push(`  NO RUN ${FS.basename(outcome.repositoryRoot)}: wrote no summary`)
    } else if (outcome.failedGates.length > 0) {
      lines.push(`  FAIL ${FS.basename(outcome.repositoryRoot)}: ${outcome.failedGates.join(', ')}`)
    }
  }
  lines.push(report.acceptanceMet ? '  ACCEPTANCE MET' : '  ACCEPTANCE NOT MET')
  return lines.join('\n')
}

function seconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`
}

/**
 * The checkouts are given rather than discovered, and never provisioned here.
 *
 * `git worktree list` routinely shows more than thirty checkouts on this machine, worked in
 * concurrently by other agents and by Ro, and running a lane inside one of them would write another
 * agent's tree. So the experiment refuses to guess: the caller names the checkouts it owns, and
 * making them is a deliberate step taken by someone who knows they are disposable.
 */
async function run(): Promise<void> {
  try {
    const argv = Platform.runtimeProcess.argv.slice(2)
    const roots = argv.filter(argument => !argument.startsWith('--'))
    if (roots.length === 0) {
      Errors.throwUserInput(
        'Name the checkouts to run lanes in, one per lane: just admission-experiment <root> <root> …\n'
          + "They must be checkouts you own and can throw away — never another agent's worktree.",
      )
    }
    const lane = valueOf(argv, '--lane') ?? 'verify'
    const report = await runAdmissionExperiment({
      allowBusyMachine: argv.includes('--allow-busy-machine'),
      lane,
      lanes: Number(valueOf(argv, '--lanes') ?? roots.length),
      repeats: Number(valueOf(argv, '--repeats') ?? 3),
      repositoryRoots: roots,
    })
    HCI.writeLine(renderAdmissionReport(report))
    if (!report.acceptanceMet) {
      Platform.runtimeProcess.setExitCode(1)
    }
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index < 0 ? undefined : argv[index + 1]
}

if (import.meta.main) {
  await run()
}
