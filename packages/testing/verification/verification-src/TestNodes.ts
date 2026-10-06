import { GateCatalog } from './GateCatalog'
import { type NodeSample, RunTimings, type TimingsStore } from './RunTimings'
import type { TestLedgerStore } from './TestLedger'
import type { NativeTestReport } from './TestReport'
import { type ShardPlan, TestShards } from './TestShards'
import { WorkGraph, type WorkNode, type WorkState } from './WorkGraph'

/**
 * Test suites as ordinary nodes of the one graph.
 *
 * There used to be two schedulers. The gate graph ran a `_test` gate, and that gate started a second
 * graph of suites inside a worker budget passed down through an environment variable. Neither could
 * see the other's work, so the outer graph held a third of the machine in reserve for gates the
 * inner one knew nothing about, and the inner one could not use slots the outer one had idle. A
 * suite — and each of its shards — is a node here, and there is one scheduler and one budget.
 *
 * A suite is no longer a unit of scheduling, only a unit of reporting: its shards run as separate
 * nodes and the summary groups them back under the suite's name, so a reader still sees
 * `studio: passed` with its duration and the ledger still records per-file outcomes.
 */

/** TestProcess is the command one node runs, with the report file it will write. */
export type TestProcess = {
  args: readonly string[]
  command: string
  cwd?: string
  env?: Record<string, string>
  /** Repository-relative files this process executes. */
  files: readonly string[]
  testReport?: NativeTestReport
}

/**
 * SelectedSuite is one suite a run chose: the files it owns in this run, and how to build the
 * process for any subset of them. The subset is what makes sharding possible without the registry
 * knowing shards exist.
 */
export type SelectedSuite = {
  /**
   * Builds the process for one node: its own name, so its report file is its own, its units, and
   * the width the graph granted it, so a runner that would otherwise size itself to the machine
   * (Jest's `--maxWorkers`) is held to what was actually reserved.
   */
  buildProcess: (nodeName: string, units: readonly string[], slots: number) => TestProcess
  /** Complete suite inventory against which a partial selection is estimated. */
  estimationUnits?: readonly string[]
  files: readonly string[]
  name: string
  /**
   * What one process of this suite can be asked to run, when that is not its files. The Tao behavior
   * tests are the case: the ledger keys them as one synthetic `Apps` unit, because a per-file
   * identity for a whole app corpus is not something the retry selection can compute, while
   * `./tao test` happily takes a list of app roots. Sharding splits these; the ledger keeps `files`.
   */
  shardUnits?: readonly string[]
  /**
   * Relative cost per shard unit, for a suite whose units the ledger has no timings for. The ledger
   * keys the Tao behavior tests as one unit, so it can say what the suite costs but nothing about how
   * that cost divides between app roots; the size of the Tao source under each root is the best proxy
   * available, because compiling it is what that cost mostly is. The weights are relative to each
   * other, not milliseconds — `taoAppShardUnits` owns how they are derived.
   */
  unitCostMs?: ReadonlyMap<string, number>
}

/** TestNodeState is a work-graph state that remembers which suite and files it stands for. */
export type TestNodeState = WorkState & {
  /**
   * What the planner expects this node to take, from the evidence it had: the node's own history
   * where that history describes these files, otherwise the suite's recorded duration divided by the
   * ledger cost of the files this node holds. Undefined only when neither the suite nor its files
   * have ever been measured. `estimateNodeMs` says how it is derived; the scheduler, the partition
   * plan and the summary all read this rather than looking the node's name up again, so a shard, a
   * file partition and a whole suite are weighed the same way.
   */
  expectedMs?: number
  selectedTestFiles?: readonly string[]
  /** The suite this node reports under; equal to `name` for an unsharded suite. */
  suite: string
  testReport?: NativeTestReport
}

/** SuiteEvidence is everything one suite's nodes are weighed with, gathered once per suite. */
type SuiteEvidence = {
  /** Per-unit relative cost: ledger milliseconds, or the Tao apps' source-size proxy. */
  costs: ReadonlyMap<string, number>
  /** True when `costs` are milliseconds a process really spent, so they can stand alone as an estimate. */
  costsAreMs: boolean
  fixedMs: number
  /** Mean cost of a measured unit; what an unmeasured unit is charged. */
  meanCostMs: number
  /** How many nodes this run split the suite into, across partitions and shards. */
  nodeCount: number
  /** The suite's recorded one-process duration, or undefined on a cold checkout. */
  suiteMs: number | undefined
  /** Sum of `costs` over the complete suite inventory, unmeasured units at the mean. */
  totalCostMs: number
  units: readonly string[]
  /** True when the selection contains the complete suite inventory. */
  completeSelection: boolean
}

export type BuildTestNodesOptions = {
  ledger: TestLedgerStore
  /** Partition the catalog's small core files before expensive suites, without widening selection. */
  preflight?: boolean
  /** Node names the caller has already proved and does not want scheduled. */
  proved?: ReadonlySet<string>
  selected: readonly SelectedSuite[]
  timings: TimingsStore
}

/** TestNodePlan is what one run's test selection became: its nodes, and how each suite was split. */
export type TestNodePlan = {
  plans: readonly ShardPlan[]
  states: readonly TestNodeState[]
  /** Lines a lane should surface: a suite that lost its sharding rather than chose to run whole. */
  warnings: readonly string[]
}

/**
 * Below this a suite running whole says nothing — it may simply be small. At or above it, a suite
 * with no recorded duration is running as one process where it would otherwise have been split, and
 * the lane is quietly slower than the machine it is on. Four is low enough to catch the small suites
 * and high enough that a genuinely tiny one stays silent.
 */
const UNSHARDED_WARNING_UNITS = 4

/**
 * Bounds every test node runs under, so a runaway cannot hold a lane open for 30 minutes again. The
 * wall bound scales with what the node is measured to take and keeps a floor, because a 4s shard
 * deserves a far tighter bound than a 30s suite. The idle bound is the one that catches the failure
 * this exists for: bun's assertion formatter on a multiply-reachable value allocates without
 * printing anything, and a synchronous runaway is not interrupted by `bun test --timeout`
 * (bun #21277), so the bound has to be the parent's.
 */
const WALL_TIMEOUT_FACTOR = 6
const WALL_TIMEOUT_FLOOR_MS = 1_200_000
const WALL_TIMEOUT_CEILING_MS = 1_800_000
const IDLE_TIMEOUT_FACTOR = 2
/**
 * The idle floor has to clear the longest a healthy suite may legitimately be silent, which is one
 * test spending the whole of `TestRunner.MAX_TEST_DEADLINE_MS`: a gate lane runs its suites under a
 * file reporter, so nothing reaches stdout between tests and a starved test looks exactly like a
 * stalled one. Two such tests back to back is the bound this keeps room for. `test-runner.test.ts`
 * holds the two constants together, because raising the deadline without raising this would start
 * killing suites that were only slow. The import would be a cycle, hence a test rather than an
 * expression.
 */
const IDLE_TIMEOUT_FLOOR_MS = 1_200_000

/** build turns one run's selected suites into the nodes the graph will schedule. */
function build(options: BuildTestNodesOptions): TestNodePlan {
  const plans: ShardPlan[] = []
  const states: TestNodeState[] = []
  const preflightNames: string[] = []
  const warnings: string[] = []
  for (const suite of options.selected) {
    const tuning = GateCatalog.suiteTuning(suite.name)
    const fixedMs = tuning.fixedMs ?? GateCatalog.BUN_SUITE_FIXED_MS
    // A suite whose runner cannot attribute time to a single test has nothing trustworthy to say
    // about relative per-file cost either, so shards fall back to the mean-cost packing
    // `TestShards.packFiles` already gives an unmeasured file. `GateCatalog` owns which suites those
    // are and why; the ledger declines to record their durations for the same reason.
    const ledgerCosts = GateCatalog.reportsAttributableDurations(suite.name)
      ? TestShards.fileCostsFromLedger(options.ledger, suite.name)
      : new Map<string, number>()
    // A suite's own units win when the ledger cannot speak about them at all.
    const usesUnitCosts = suite.unitCostMs !== undefined
    const costs = usesUnitCosts ? suite.unitCostMs! : ledgerCosts
    const suiteMs = RunTimings.expectedMs(options.timings, suite.name)
    const inventory = suite.estimationUnits ?? suite.shardUnits ?? suite.files
    const selectedUnits = suite.shardUnits ?? suite.files
    const completeSelection = inventory.every(unit =>
      selectedUnits.some(root => unit === root || unit.startsWith(root + '/'))
    )
    /** Every node this suite becomes here, before any is weighed: the count is part of the weight. */
    const planned: { files: readonly string[]; name: string; preflight?: boolean; shardCount: number }[] = []
    const preflightFiles = options.preflight === true && suite.shardUnits === undefined
      ? suite.files.filter(file => tuning.preflightFiles?.includes(file) === true)
      : []
    if (preflightFiles.length > 0) {
      planned.push({ files: preflightFiles, name: `${suite.name}:core`, preflight: true, shardCount: 1 })
    }
    const partitionedFiles = new Set(preflightFiles)
    for (const partition of tuning.filePartitions ?? []) {
      const files = suite.shardUnits === undefined
        ? suite.files.filter(file => partition.files.includes(file) && !partitionedFiles.has(file))
        : []
      if (files.length === 0) {
        continue
      }
      for (const file of files) {
        partitionedFiles.add(file)
      }
      planned.push({ files, name: `${suite.name}:${partition.name}`, shardCount: 1 })
    }
    const remaining = (suite.shardUnits ?? suite.files).filter(file => !partitionedFiles.has(file))
    if (remaining.length > 0 || (partitionedFiles.size === 0 && suite.shardUnits !== undefined)) {
      const plan = TestShards.planShards({
        coldShardCount: tuning.coldShardCount,
        // A recursive execution root can own several inventory units. Pack by their combined
        // share while keeping the detailed inventory for partial selections and node estimates.
        fileCostMs: usesUnitCosts
          ? new Map(remaining.map(root => [root, TestShards.weightShare([root], inventory, costs)]))
          : costs,
        files: remaining,
        fixedMs,
        measuredMs: suiteMs === undefined
          ? undefined
          : fixedMs + Math.max(0, suiteMs - fixedMs) * TestShards.weightShare(remaining, inventory, costs),
        shardable: tuning.shardable,
        suite: suite.name,
      })
      plans.push(plan)
      const units = remaining.length
      if (plan.unshardedCause === 'no-recorded-duration' && units >= UNSHARDED_WARNING_UNITS) {
        warnings.push(
          `${suite.name} ran whole across ${units} units: no recorded duration under that name, so it could not be sharded. `
            + `Expected for a new suite; for an existing one it means its recorded history is under a different name, as a rename leaves it.`,
        )
      }
      const count = plan.shards.length
      plan.shards.forEach((files, index) => {
        // The ordinary remainder is a shard even when it needs only one process: keeping
        // the bare suite name would make reporting count both the rollup and the remainder.
        const name = TestShards.shardName(suite.name, index, partitionedFiles.size > 0 ? Math.max(2, count) : count)
        planned.push({ files, name, shardCount: count })
      })
    }
    const evidence = suiteEvidence({
      completeSelection,
      costs,
      costsAreMs: !usesUnitCosts,
      fixedMs,
      nodeCount: planned.length,
      suiteMs,
      units: inventory,
    })
    for (const node of planned) {
      if (options.proved?.has(node.name) === true) {
        continue
      }
      states.push(nodeState(suite, node.name, node.files, node.shardCount, options.timings, evidence))
      if (node.preflight === true) {
        preflightNames.push(node.name)
      }
    }
  }
  for (const state of states) {
    if (GateCatalog.suiteTuning(state.suite).afterPreflight === true) {
      // Admission stops on a definite failure; timeout confirmation and proven flakes
      // retain their existing policy rather than turning into hard dependency failures.
      state.node.after = [...new Set([...(state.node.after ?? []), ...preflightNames])]
    }
  }
  return { plans, states, warnings }
}

/** suiteEvidence gathers what every node of one suite is weighed against. */
function suiteEvidence(options: {
  completeSelection: boolean
  costs: ReadonlyMap<string, number>
  costsAreMs: boolean
  fixedMs: number
  nodeCount: number
  suiteMs: number | undefined
  units: readonly string[]
}): SuiteEvidence {
  const known = options.units.map(unit => options.costs.get(unit)).filter((cost): cost is number => cost !== undefined)
  const meanCostMs = known.length === 0 ? 0 : known.reduce((total, cost) => total + cost, 0) / known.length
  const totalCostMs = options.units.reduce((total, unit) => total + (options.costs.get(unit) ?? meanCostMs), 0)
  return {
    completeSelection: options.completeSelection,
    costs: options.costs,
    costsAreMs: options.costsAreMs,
    fixedMs: options.fixedMs,
    meanCostMs,
    nodeCount: Math.max(1, options.nodeCount),
    suiteMs: options.suiteMs,
    totalCostMs,
    units: options.units,
  }
}

/**
 * estimateNodeMs is what one test node is expected to take, from the best evidence available, in
 * this order:
 *
 * 1. The node's own recorded duration, when its name stands for a fixed set of files — a whole
 *    suite, a `:core` or file-partition node. A `#k` shard's history does not qualify: the shard is
 *    re-packed from per-file costs on every run, so `cli/tao-cli#4` last time may share no file with
 *    `cli/tao-cli#4` today, and ranking today's files by yesterday's neighbours is what put a 228s
 *    shard at the end of a 1,122s run.
 * 2. The suite's recorded duration, divided by the ledger cost of the files this node holds against
 *    the cost of every file in the complete suite inventory, with each node charged its own process startup. The
 *    ledger's numbers are relative — they were recorded under whatever load that run had — so they
 *    only apportion the suite's measured total, never replace it. A file the ledger has not seen is
 *    charged the mean of the ones it has, as `TestShards.packFiles` does.
 * 3. The suite's recorded duration divided evenly across the nodes it became here, when the ledger
 *    has nothing on any of its files. A file partition used to be charged the whole suite's duration
 *    in this case, as if each of six partitions were the suite — that phantom weight is what put six
 *    `language/project-tooling:*` nodes on six different CI machines while real 100s shards doubled up.
 * 4. The ledger costs alone, plus startup, when the suite itself has never been timed but its files
 *    have: those are real milliseconds, and a rough number beats the scheduler's `cost × 1s` guess.
 * 5. The shard's own history, as the last word on a `#k` node nothing else can speak for.
 *
 * Undefined when nothing has ever measured the suite or its files; the caller's cold-start default
 * takes over there.
 */
function estimateNodeMs(
  name: string,
  files: readonly string[],
  timings: TimingsStore,
  evidence: SuiteEvidence,
): number | undefined {
  const own = RunTimings.expectedMs(timings, name)
  const isShard = TestShards.suiteOf(name) !== name && !name.includes(':')
  if (own !== undefined && !isShard && evidence.completeSelection) {
    return own
  }
  const nodeCostMs = files.reduce((total, file) => total + (evidence.costs.get(file) ?? evidence.meanCostMs), 0)
  if (evidence.suiteMs !== undefined) {
    if (evidence.totalCostMs > 0) {
      const variableMs = Math.max(0, evidence.suiteMs - evidence.fixedMs)
      return Math.round(evidence.fixedMs + variableMs * TestShards.weightShare(files, evidence.units, evidence.costs))
    }
    if (!evidence.completeSelection) {
      return Math.round(
        evidence.fixedMs + Math.max(0, evidence.suiteMs - evidence.fixedMs)
            * TestShards.weightShare(files, evidence.units, evidence.costs),
      )
    }
    return Math.round(evidence.suiteMs / evidence.nodeCount)
  }
  if (evidence.costsAreMs && nodeCostMs > 0) {
    return Math.round(evidence.fixedMs + nodeCostMs)
  }
  return own
}

function nodeState(
  suite: SelectedSuite,
  name: string,
  files: readonly string[],
  shardCount: number,
  timings: TimingsStore,
  evidence: SuiteEvidence,
): TestNodeState {
  const tuning = GateCatalog.suiteTuning(suite.name)
  // A shard's parallelism is usually the graph's, not its own, so it reserves one slot; a suite
  // whose shard genuinely spawns more says so, because under-reserving is how a lane oversubscribes
  // the machine and makes every node in it slower.
  const cost = shardCount > 1 ? tuning.shardCost : tuning.cost
  const process = suite.buildProcess(name, files, cost ?? 1)
  const expectedMs = estimateNodeMs(name, files, timings, evidence)
  const node: WorkNode = {
    budgetEnvKeys: tuning.budgetEnvKeys,
    cost,
    idleTimeoutMs: idleTimeoutMs(expectedMs),
    name,
    needs: GateCatalog.testDependencies(GateCatalog.suiteReads(suite.name)),
    priority: tuning.priority,
    run: ({ slots }) => {
      const admitted = suite.buildProcess(name, files, slots)
      return {
        args: [...admitted.args],
        command: admitted.command,
        cwd: admitted.cwd,
        ...(admitted.env === undefined ? {} : { env: admitted.env }),
      }
    },
    // One process that cannot be split is a floor on the whole run; the scheduler packs around it.
    serial: tuning.serial ?? (shardCount === 1 && cost === undefined),
    timeoutMs: wallTimeoutMs(expectedMs),
  }
  const state = WorkGraph.createState(node) as TestNodeState
  state.dashboardGroup = shardCount > 1 ? suite.name : undefined
  state.expectedMs = expectedMs
  state.selectedTestFiles = process.files
  state.suite = suite.name
  state.testReport = process.testReport
  return state
}

/** wallTimeoutMs bounds a node at several times its measured duration, never below the floor. */
function wallTimeoutMs(expectedMs: number | undefined): number {
  const scaled = expectedMs === undefined ? WALL_TIMEOUT_FLOOR_MS : expectedMs * WALL_TIMEOUT_FACTOR
  return Math.min(WALL_TIMEOUT_CEILING_MS, Math.max(WALL_TIMEOUT_FLOOR_MS, Math.round(scaled)))
}

/** idleTimeoutMs bounds a node's silence; a healthy runner prints as each test settles. */
function idleTimeoutMs(expectedMs: number | undefined): number {
  const scaled = expectedMs === undefined ? IDLE_TIMEOUT_FLOOR_MS : expectedMs * IDLE_TIMEOUT_FACTOR
  return Math.max(IDLE_TIMEOUT_FLOOR_MS, Math.round(scaled))
}

/**
 * suiteDurations reconstructs what each suite would have measured as one process, from what its
 * shards actually took.
 *
 * Without this a sharded suite stops measuring itself. The timings store is keyed by node name, so
 * once `studio` becomes `studio#1..3` nothing ever records `studio` again, and the shard count
 * freezes at whatever the suite's last unsharded run said — including forever, if that run was on a
 * busy machine. The reconstruction is the plan's own arithmetic read backwards: `n` shards spend
 * `n` startups and divide the rest, so the one-process equivalent is their total less the `n - 1`
 * startups sharding added.
 */
function suiteDurations(states: readonly TestNodeState[]): Map<string, NodeSample> {
  const shardsBySuite = new Map<string, TestNodeState[]>()
  for (const state of states) {
    if (state.status === 'passed') {
      shardsBySuite.set(state.suite, [...shardsBySuite.get(state.suite) ?? [], state])
    }
  }
  const durations = new Map<string, NodeSample>()
  for (const [suite, shards] of shardsBySuite) {
    // A suite with a failed or skipped shard measured nothing about itself as a whole.
    if (shards.length !== states.filter(state => state.suite === suite).length) {
      continue
    }
    const fixedMs = GateCatalog.suiteTuning(suite).fixedMs ?? GateCatalog.BUN_SUITE_FIXED_MS
    const totalWallMs = shards.reduce((sum, shard) => sum + shard.elapsedMs, 0)
    const cpuMsPerShard = shards.map(shard => directCpuMs(shard))
    durations.set(suite, {
      // The suite ran as `shards.length` processes at once; that is what its shards' own samples
      // were concurrent with, whatever else was in the lane beside them.
      concurrency: shards.length,
      // Each shard pays the suite's fixed startup again, so summing raw CPU time over-counts the
      // one-process equivalent by `(shards.length - 1)` startups' worth, same as the wall reconstruction
      // does below — but only defined once every shard actually reported one.
      cpuMs: cpuMsPerShard.every(value => value !== undefined)
        ? cpuMsPerShard.reduce((sum, value) => sum + (value ?? 0), 0)
        : undefined,
      wallMs: Math.max(1, Math.round(totalWallMs - (shards.length - 1) * fixedMs)),
    })
  }
  return durations
}

/** directCpuMs mirrors `RunArtifacts.directCpuMs`: see that copy for why this reads duck-typed. */
function directCpuMs(state: WorkState): number | undefined {
  const cpuMs = (state as { cpuMs?: unknown }).cpuMs
  return typeof cpuMs === 'number' && Number.isFinite(cpuMs) ? cpuMs : undefined
}

/** describePlans is the one line a run prints about how it split its suites. */
function describePlans(plans: readonly ShardPlan[]): readonly string[] {
  return plans
    .filter(plan => plan.shards.length > 1)
    .map(plan => `- sharded ${plan.suite}: ${plan.reason}`)
}

/**
 * expectedMsFor answers the scheduler's, the partition plan's and the summary's one question — how
 * long will this node take — with the planner's estimate for a test node and the recorded duration
 * for everything else. One function, so the three never disagree about a node's weight.
 */
function expectedMsFor(
  states: readonly TestNodeState[],
  timings: TimingsStore,
): (name: string) => number | undefined {
  const estimates = new Map(states.map(state => [state.name, state.expectedMs]))
  return name => estimates.get(name) ?? RunTimings.expectedMs(timings, name)
}

/** TestNodes owns turning a run's selected suites into scheduled, bounded, shardable nodes. */
export const TestNodes = {
  IDLE_TIMEOUT_FLOOR_MS,
  WALL_TIMEOUT_FLOOR_MS,
  build,
  describePlans,
  expectedMsFor,
  suiteDurations,
  idleTimeoutMs,
  wallTimeoutMs,
} as const
