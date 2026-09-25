import type { TestLedgerStore } from './TestLedger'

/**
 * How many processes one test suite is split into, and which files each of them runs.
 *
 * The scheduler can only pack what it is given. A suite that is one 25s process is a 25s floor on
 * the whole run however idle the machine is, and three such suites summing to 76s against a 43s wall
 * is what the test gate used to measure. Splitting them into items of a few seconds each is what
 * turns that sum into the machine's own width.
 *
 * Once measured, the shard count comes from two things this checkout records
 * — how long the suite took (`RunTimings`) and what each of its files costs relative to the others
 * (`TestLedger`) — so a suite that grows re-shards itself on the next run and a hand-written count
 * can never go stale. A few suites with measured large cold runs start with a conservative split
 * until this checkout has its own duration; every other cold suite runs whole.
 *
 * Sharding is not free: every shard pays the suite's process startup again. That declared cost is
 * what caps the count, and the rule is that **no shard may be mostly startup** — a shard must do at
 * least as much real work as it spends getting ready.
 *
 * Note what that rule is not. It first capped the count where one more shard stopped saving more
 * total CPU than the startup it added. That is the right criterion for a machine that is the
 * bottleneck and the wrong one here: a verification lane leaves most of an 18-core machine idle, so
 * what it is short of is wall time, not cores. On the measured `tao-apps` numbers — about 6s of
 * language-service startup against 34s of work — the CPU criterion allowed two shards and this one
 * allows six, for a floor of about 11s instead of 23s. Trading cores for wall time is the whole
 * point; the only thing worth refusing is a shard that is mostly overhead.
 */

/** ShardPlan is one suite's split: the files each shard runs, and why it has that many. */
export type ShardPlan = {
  /** One entry per shard, each a non-empty list of repository-relative files. */
  shards: readonly (readonly string[])[]
  /** One line naming the measurements that produced this count, for the run summary. */
  reason: string
  suite: string
  /**
   * Set only when a suite runs whole because the planner had nothing to plan with, never when it
   * ran whole on a measurement. The two read alike in `reason` and mean opposite things: a suite
   * under the floor is one shard because that is cheapest, while a suite with no recorded duration
   * is one shard because its history is missing — which is what a renamed suite looks like, and
   * what cost this repository a silent 40s a lane when the package restructure changed every suite
   * id at once. A caller warns on this; nothing should warn on the others.
   */
  unshardedCause?: 'no-recorded-duration'
}

export type PlanShardsOptions = {
  /** Initial split for a measured-heavy suite before this checkout has a trustworthy duration. */
  coldShardCount?: number
  /**
   * The units this suite can be split across, in any order; the plan sorts them. Usually its test
   * files, but a suite whose runner takes directories — the Tao behavior tests take app roots —
   * names those instead, because they are what one of its processes can be asked to run.
   */
  files: readonly string[]
  /** Milliseconds one process of this suite spends before running any test. */
  fixedMs: number
  /** Relative per-file cost, summed from the ledger's per-test durations. */
  fileCostMs: ReadonlyMap<string, number>
  /** The suite's measured wall duration, or undefined on a cold checkout. */
  measuredMs?: number
  /** False for a suite that must stay one process. */
  shardable?: boolean
  suite: string
}

/**
 * The wall time one shard should aim for. Small enough that the longest shard is not the run's
 * floor, large enough that process startup stays a minor share of it.
 */
const TARGET_SHARD_MS = 4_000
/** Below this, a suite is already smaller than one shard's target and splitting it only adds startups. */
const MIN_SHARDABLE_MS = 2 * TARGET_SHARD_MS

/**
 * planShards splits one suite into the processes the graph will schedule. The result is
 * deterministic for a given checkout: files sort by recorded cost and then by name, and the
 * assignment is longest-processing-time-first onto the lightest shard.
 */
function planShards(options: PlanShardsOptions): ShardPlan {
  const files = [...options.files].sort()
  const whole = (reason: string): ShardPlan => ({ reason, shards: [files], suite: options.suite })
  if (options.shardable === false) {
    return whole('declared unshardable')
  }
  if (files.length < 2) {
    return whole('one unit')
  }
  if (options.measuredMs === undefined) {
    const count = Math.min(files.length, Math.max(1, options.coldShardCount ?? 1))
    if (count > 1) {
      return {
        reason: `${count} initial shards: no recorded duration yet`,
        shards: packFiles(files, options.fileCostMs, count),
        suite: options.suite,
      }
    }
    return { ...whole('no recorded duration yet'), unshardedCause: 'no-recorded-duration' }
  }
  if (options.measuredMs < MIN_SHARDABLE_MS) {
    return whole(`${formatSeconds(options.measuredMs)} measured, under the ${formatSeconds(MIN_SHARDABLE_MS)} floor`)
  }
  const variableMs = Math.max(0, options.measuredMs - options.fixedMs)
  const target = Math.max(1, Math.round(variableMs / TARGET_SHARD_MS))
  const cap = startupCap(variableMs, options.fixedMs)
  const count = Math.max(1, Math.min(target, cap, files.length))
  if (count === 1) {
    return whole(
      `${formatSeconds(options.measuredMs)} measured, ${formatSeconds(options.fixedMs)} startup: one shard pays least`,
    )
  }
  return {
    reason: `${count} shards: ${formatSeconds(options.measuredMs)} measured less ${
      formatSeconds(options.fixedMs)
    } startup, ${formatSeconds(TARGET_SHARD_MS)} target, ${
      cap === Number.MAX_SAFE_INTEGER ? 'no' : cap
    } the startup cap, ${files.length} units`,
    shards: packFiles(files, options.fileCostMs, count),
    suite: options.suite,
  }
}

/**
 * startupCap is the largest shard count at which each shard still does at least as much work as it
 * spends starting up: `variableMs / n >= fixedMs`. Beyond it a shard is more than half overhead, and
 * the machine is busier without the run being shorter.
 */
function startupCap(variableMs: number, fixedMs: number): number {
  if (fixedMs <= 0) {
    return Number.MAX_SAFE_INTEGER
  }
  return Math.max(1, Math.floor(variableMs / fixedMs))
}

/**
 * packFiles assigns files to shards longest first, each onto the lightest shard so far. A file the
 * ledger has never seen is charged the mean of the ones it has, so a new test is neither free nor
 * able to dominate a shard on its first run.
 */
function packFiles(
  files: readonly string[],
  fileCostMs: ReadonlyMap<string, number>,
  count: number,
): readonly (readonly string[])[] {
  const known = files.map(file => fileCostMs.get(file)).filter((cost): cost is number => cost !== undefined)
  const meanMs = known.length === 0 ? 1 : known.reduce((total, cost) => total + cost, 0) / known.length
  const weighted = files
    .map(file => ({ costMs: fileCostMs.get(file) ?? meanMs, file }))
    .toSorted((left, right) => right.costMs - left.costMs || left.file.localeCompare(right.file))
  const shards = Array.from({ length: count }, () => ({ costMs: 0, files: [] as string[] }))
  for (const { costMs, file } of weighted) {
    const lightest = shards.reduce((best, shard) => shard.costMs < best.costMs ? shard : best, shards[0]!)
    lightest.files.push(file)
    lightest.costMs += costMs
  }
  // A count above the number of files cannot happen, but an empty shard would become a node with
  // nothing to run, which reads as a passing suite that ran no tests.
  return shards.filter(shard => shard.files.length > 0).map(shard => shard.files.toSorted())
}

/** fileCostsFromLedger sums each file's recorded per-test durations into one relative cost. */
function fileCostsFromLedger(ledger: TestLedgerStore, suite: string): Map<string, number> {
  const costs = new Map<string, number>()
  for (const record of Object.values(ledger.tests)) {
    if (record.suite !== suite || record.durationMs === undefined) {
      continue
    }
    costs.set(record.file, (costs.get(record.file) ?? 0) + record.durationMs)
  }
  return costs
}

/** shardName is the node name of one shard; a single-shard suite keeps the suite's own name. */
function shardName(suite: string, index: number, count: number): string {
  return count < 2 ? suite : `${suite}#${index + 1}`
}

/** suiteOf recovers the suite a node name belongs to, so shards report under one heading. */
function suiteOf(nodeName: string): string {
  const marker = nodeName.indexOf('#')
  return marker === -1 ? nodeName : nodeName.slice(0, marker)
}

function formatSeconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1)}s`
}

/** TestShards owns how a suite is split into scheduled processes and what each of them runs. */
export const TestShards = {
  MIN_SHARDABLE_MS,
  TARGET_SHARD_MS,
  fileCostsFromLedger,
  planShards,
  shardName,
  startupCap,
  suiteOf,
} as const
