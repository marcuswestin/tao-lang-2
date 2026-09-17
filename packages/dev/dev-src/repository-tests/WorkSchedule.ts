import { OutputText } from '../cli/OutputText'
import type { WorkRunResult, WorkState, WorkWait } from './WorkGraph'

/**
 * What the schedule did, in numbers a reader can act on.
 *
 * A lane that got faster because the machine was idle and a lane that got faster because its work
 * packs better are indistinguishable from a wall time alone, and a regression in packing is
 * invisible until someone happens to look. Four numbers make it visible: how long the run took, how
 * long its longest unavoidable chain was, how much reserved capacity went unused, and — for each
 * node that did not start immediately — what was in its way.
 *
 * The floor is the honest target. A run cannot be shorter than its longest chain of work that must
 * happen in order, so the gap between the makespan and the floor is the part sharding and packing
 * can still win, and the gap between the floor and nothing is the part only a faster tool can.
 */

/** ScheduleWait is one reason one node waited, as the summary publishes it. */
export type ScheduleWait = {
  /** The dependency or resource name, when the kind names one. */
  detail?: string
  kind: WorkWait['kind']
  ms: number
}

/** ScheduleReport is the versioned scheduling rollup added to a run's summary. */
export type ScheduleReport = {
  /** Local worker width the run was allowed; the divisor for `idleSlotSeconds`. */
  capacity: number
  /** Reserved slot-seconds no node occupied: capacity times makespan, less the work actually done. */
  idleSlotSeconds: number
  makespanMs: number
  /** The longest chain of work that had to happen in order, which no packing can shorten. */
  serialFloorMs: number
  /** The nodes of that chain, in order. */
  serialFloorPath: readonly string[]
  /** What held each node that did not start at once, longest first. */
  waits: readonly { name: string; waits: readonly ScheduleWait[] }[]
}

/** How many waiting nodes the one-line report names before it stops. */
const REPORTED_WAITS = 3
/** Waits below this are scheduling noise, not a finding. */
const WAIT_NOISE_MS = 250

/** report measures one finished run's schedule. */
function report(result: WorkRunResult): ScheduleReport {
  const ran = result.states.filter(state => state.startedAt !== undefined)
  const makespanMs = Math.max(0, result.finishedAt - result.startedAt)
  const path = longestChain(result.states)
  const workedSlotMs = ran.reduce((total, state) => total + (state.slots ?? 1) * state.elapsedMs, 0)
  return {
    capacity: result.capacity,
    idleSlotSeconds: Math.round(Math.max(0, result.capacity * makespanMs - workedSlotMs) / 100) / 10,
    makespanMs,
    serialFloorMs: chainDuration(path, result.states),
    serialFloorPath: path,
    waits: ran
      .map(state => ({
        name: state.name,
        waits: (state.waits ?? []).filter(wait => wait.ms >= WAIT_NOISE_MS),
      }))
      .filter(entry => entry.waits.length > 0)
      .toSorted((left, right) => totalWaitMs(right.waits) - totalWaitMs(left.waits)),
  }
}

/**
 * longestChain finds the longest ordered run of work in the graph: the critical path through the
 * declared edges, or, where one exclusive resource serializes several nodes, their total. Whichever
 * is longer is the floor, because neither can be made to overlap.
 */
function longestChain(states: readonly WorkState[]): readonly string[] {
  const byName = new Map(states.map(state => [state.name, state]))
  const cache = new Map<string, readonly string[]>()
  const visiting = new Set<string>()
  const chainTo = (name: string): readonly string[] => {
    const cached = cache.get(name)
    if (cached !== undefined) {
      return cached
    }
    if (visiting.has(name)) {
      return []
    }
    visiting.add(name)
    const state = byName.get(name)
    const best = (state?.node.needs ?? [])
      .filter(need => byName.has(need))
      .map(chainTo)
      .toSorted((left, right) => chainDuration(right, states) - chainDuration(left, states))[0] ?? []
    visiting.delete(name)
    const chain = [...best, name]
    cache.set(name, chain)
    return chain
  }
  const dependencyChains = states.map(state => chainTo(state.name))
  const resourceChains = [...resourceGroups(states)].map(([, names]) => names)
  return [...dependencyChains, ...resourceChains]
    .toSorted((left, right) => chainDuration(right, states) - chainDuration(left, states))[0] ?? []
}

/** resourceGroups collects the nodes each exclusive resource forced to run one at a time. */
function resourceGroups(states: readonly WorkState[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const state of states) {
    for (const resource of state.node.resources ?? []) {
      groups.set(resource, [...groups.get(resource) ?? [], state.name])
    }
  }
  return groups
}

function chainDuration(names: readonly string[], states: readonly WorkState[]): number {
  return names.reduce(
    (total, name) => total + (states.find(state => state.name === name)?.elapsedMs ?? 0),
    0,
  )
}

function totalWaitMs(waits: readonly ScheduleWait[]): number {
  return waits.reduce((total, wait) => total + wait.ms, 0)
}

/** formatScheduleReport renders the one line a run ends with. */
function formatScheduleReport(schedule: ScheduleReport): string {
  const utilization = schedule.capacity * schedule.makespanMs === 0
    ? 0
    : Math.round(100 * schedule.idleSlotSeconds * 1_000 / (schedule.capacity * schedule.makespanMs))
  const floor = schedule.serialFloorPath.length === 0
    ? ''
    : ` (${schedule.serialFloorPath.join(' -> ')})`
  const waits = schedule.waits.slice(0, REPORTED_WAITS)
    .map(entry => `${entry.name} ${OutputText.formatElapsed(totalWaitMs(entry.waits))} on ${describeWait(entry.waits)}`)
  const more = schedule.waits.length > REPORTED_WAITS ? `, +${schedule.waits.length - REPORTED_WAITS} more` : ''
  return `Schedule: ${OutputText.formatElapsed(schedule.makespanMs)} makespan, `
    + `${OutputText.formatElapsed(schedule.serialFloorMs)} serial floor${floor}, `
    + `${schedule.idleSlotSeconds.toFixed(1)} idle slot-seconds of ${schedule.capacity} (${utilization}% idle)`
    + (waits.length === 0 ? '; nothing waited' : `; waited: ${waits.join(', ')}${more}`)
}

/** describeWait names what one node was waiting for, longest reason first. */
function describeWait(waits: readonly ScheduleWait[]): string {
  const longest = waits[0]
  if (longest === undefined) {
    return 'nothing'
  }
  return longest.detail === undefined ? longest.kind : `${longest.kind} ${longest.detail}`
}

/** WorkSchedule owns the measurements that make a run's packing reviewable. */
export const WorkSchedule = {
  WAIT_NOISE_MS,
  formatScheduleReport,
  longestChain,
  report,
} as const
