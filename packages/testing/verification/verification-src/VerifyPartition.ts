import { Errors, Platform } from '@shared'

/**
 * A lane split across machines: each machine runs the same command with its own `index` of `count`,
 * and every one of them must arrive at the same division of the work, or some node runs nowhere
 * while every machine reports green. The division is therefore a pure function of what every
 * machine computes alike — the unit names, the files each covers, and their expected cost — and
 * each run publishes a digest of the whole plan, so whatever joins the machines' verdicts can refuse
 * a set of runs that disagreed about it.
 *
 * The prepare phase is not divided: fixers and generators run on every machine, because the readers
 * there depend on what they write. Only readers are units.
 */

/** PartitionUnit is one node to place: a reader gate, or one test process with the files it covers. */
export type PartitionUnit = {
  /** Expected duration; units with no history all weigh the same, which still divides them evenly. */
  expectedMs?: number
  /** The test files a test node covers; part of the plan's identity, since shard contents can vary. */
  files?: readonly string[]
  name: string
}

/** PartitionSpec is one machine's place in the split: zero-based `index` of `count` machines. */
export type PartitionSpec = { count: number; index: number }

/** PartitionPlan is the division every machine computed, from the point of view of one of them. */
export type PartitionPlan = {
  count: number
  /** Hash of every unit, the files it covers, and the machine it went to; equal on every machine. */
  digest: string
  index: number
  /** The machine each unit was placed on. */
  placement: ReadonlyMap<string, number>
}

/** A unit with no recorded duration weighs this much, so that recorded ones dominate the packing. */
const UNKNOWN_COST_MS = 30_000

/** parse reads `<index>/<count>`, one-based for people, into a zero-based spec. */
function parse(text: string): PartitionSpec {
  const match = /^(\d+)\/(\d+)$/.exec(text.trim())
  const index = match === null ? Number.NaN : Number(match[1])
  const count = match === null ? Number.NaN : Number(match[2])
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) {
    Errors.throwUserInput(`Expected --partition <index>/<count> with 1 <= index <= count, got '${text}'.`)
  }
  return { count, index: index - 1 }
}

/**
 * plan places the most expensive unit first, each on the least-loaded machine so far — longest
 * processing time first, which keeps the slowest machine within a third of the best possible. Ties
 * break on name, so the placement depends on nothing but the units.
 */
function plan(units: readonly PartitionUnit[], spec: PartitionSpec): PartitionPlan {
  const ordered = [...units].sort((left, right) =>
    cost(right) - cost(left) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  )
  const loads = Array.from({ length: spec.count }, () => 0)
  const placement = new Map<string, number>()
  for (const unit of ordered) {
    const machine = loads.indexOf(Math.min(...loads))
    placement.set(unit.name, machine)
    loads[machine]! += cost(unit)
  }
  const parts = [String(spec.count), '\0']
  for (const unit of [...ordered].sort((left, right) => (left.name < right.name ? -1 : 1))) {
    parts.push(unit.name, '\0', String(placement.get(unit.name)), '\0')
    for (const file of [...unit.files ?? []].sort()) {
      parts.push(file, '\0')
    }
    parts.push('\n')
  }
  return { count: spec.count, digest: Platform.sha256Hex(parts), index: spec.index, placement }
}

function cost(unit: PartitionUnit): number {
  return unit.expectedMs !== undefined && Number.isFinite(unit.expectedMs) ? unit.expectedMs : UNKNOWN_COST_MS
}

/** owns reports whether this machine runs the unit; a unit the plan never saw is everyone's. */
function owns(partition: PartitionPlan, name: string): boolean {
  const machine = partition.placement.get(name)
  return machine === undefined || machine === partition.index
}

/** describe is the reason a unit placed elsewhere reports as skipped here. */
function describe(partition: PartitionPlan, name: string): string {
  return `runs on partition ${(partition.placement.get(name) ?? partition.index) + 1}/${partition.count}`
}

/** VerifyPartition divides one lane's readers across machines that each run the same command. */
export const VerifyPartition = {
  describe,
  owns,
  parse,
  plan,
} as const
