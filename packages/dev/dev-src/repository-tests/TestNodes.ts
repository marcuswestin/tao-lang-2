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
  selectedTestFiles?: readonly string[]
  /** The suite this node reports under; equal to `name` for an unsharded suite. */
  suite: string
  testReport?: NativeTestReport
}

export type BuildTestNodesOptions = {
  ledger: TestLedgerStore
  /** Node names the caller has already proved and does not want scheduled. */
  proved?: ReadonlySet<string>
  selected: readonly SelectedSuite[]
  timings: TimingsStore
}

/** TestNodePlan is what one run's test selection became: its nodes, and how each suite was split. */
export type TestNodePlan = {
  plans: readonly ShardPlan[]
  states: readonly TestNodeState[]
}

/**
 * Bounds every test node runs under, so a runaway cannot hold a lane open for 45 minutes again. The
 * wall bound scales with what the node is measured to take and keeps a floor, because a 4s shard
 * deserves a far tighter bound than a 30s suite. The idle bound is the one that catches the failure
 * this exists for: bun's assertion formatter on a multiply-reachable value allocates without
 * printing anything, and a synchronous runaway is not interrupted by `bun test --timeout`
 * (bun #21277), so the bound has to be the parent's.
 */
const WALL_TIMEOUT_FACTOR = 6
const WALL_TIMEOUT_FLOOR_MS = 120_000
const WALL_TIMEOUT_CEILING_MS = 900_000
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
const IDLE_TIMEOUT_FLOOR_MS = 120_000

/** build turns one run's selected suites into the nodes the graph will schedule. */
function build(options: BuildTestNodesOptions): TestNodePlan {
  const plans: ShardPlan[] = []
  const states: TestNodeState[] = []
  for (const suite of options.selected) {
    const tuning = GateCatalog.suiteTuning(suite.name)
    // Under `--concurrent` Bun reports every test in a file as the time from that file's shared
    // start to its own completion (see `TestRunner.deadlineFor`), so a file's tests summed together
    // is not that file's cost — it is inflated by however many other tests in the file finished
    // after it, which grows with the file's own test count rather than with its work. Packing shards
    // by that sum would put a file's weight before what it actually costs; the ledger has nothing
    // trustworthy to say about relative per-file cost for a suite tuned this way, so shards fall back
    // to the mean-cost packing `TestShards.packFiles` already gives an unmeasured file.
    const concurrent = (tuning.args ?? []).includes('--concurrent')
    const ledgerCosts = concurrent
      ? new Map<string, number>()
      : TestShards.fileCostsFromLedger(options.ledger, suite.name)
    const plan = TestShards.planShards({
      // A suite's own units win when the ledger cannot speak about them at all.
      fileCostMs: suite.shardUnits === undefined || suite.unitCostMs === undefined
        ? ledgerCosts
        : suite.unitCostMs,
      files: suite.shardUnits ?? suite.files,
      fixedMs: tuning.fixedMs ?? GateCatalog.BUN_SUITE_FIXED_MS,
      measuredMs: RunTimings.expectedMs(options.timings, suite.name),
      shardable: tuning.shardable,
      suite: suite.name,
    })
    plans.push(plan)
    const count = plan.shards.length
    plan.shards.forEach((files, index) => {
      const name = TestShards.shardName(suite.name, index, count)
      if (options.proved?.has(name) === true) {
        return
      }
      states.push(nodeState(suite, name, files, count, options.timings))
    })
  }
  return { plans, states }
}

function nodeState(
  suite: SelectedSuite,
  name: string,
  files: readonly string[],
  shardCount: number,
  timings: TimingsStore,
): TestNodeState {
  const tuning = GateCatalog.suiteTuning(suite.name)
  // A shard's parallelism is usually the graph's, not its own, so it reserves one slot; a suite
  // whose shard genuinely spawns more says so, because under-reserving is how a lane oversubscribes
  // the machine and makes every node in it slower.
  const cost = shardCount > 1 ? tuning.shardCost : tuning.cost
  const process = suite.buildProcess(name, files, cost ?? 1)
  // A shard's own history is what bounds it once it has one; before that, its share of the suite's.
  const suiteMs = RunTimings.expectedMs(timings, suite.name)
  const expectedMs = RunTimings.expectedMs(timings, name)
    ?? (suiteMs === undefined ? undefined : suiteMs / shardCount)
  const node: WorkNode = {
    budgetEnvKeys: tuning.budgetEnvKeys,
    cost,
    idleTimeoutMs: idleTimeoutMs(expectedMs),
    name,
    needs: GateCatalog.testDependencies(GateCatalog.suiteReads(suite.name)),
    priority: tuning.priority,
    run: ({ slots }) => {
      const admitted = suite.buildProcess(name, files, slots)
      return { args: [...admitted.args], command: admitted.command, cwd: admitted.cwd }
    },
    // One process that cannot be split is a floor on the whole run; the scheduler packs around it.
    serial: tuning.serial ?? (shardCount === 1 && cost === undefined),
    timeoutMs: wallTimeoutMs(expectedMs),
  }
  const state = WorkGraph.createState(node) as TestNodeState
  state.dashboardGroup = shardCount > 1 ? suite.name : undefined
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

/** TestNodes owns turning a run's selected suites into scheduled, bounded, shardable nodes. */
export const TestNodes = {
  IDLE_TIMEOUT_FLOOR_MS,
  WALL_TIMEOUT_FLOOR_MS,
  build,
  describePlans,
  suiteDurations,
  idleTimeoutMs,
  wallTimeoutMs,
} as const
