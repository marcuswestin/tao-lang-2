import { Describe, Expect, Test } from '@shared/test'
import { WorkGraph, type WorkRunResult, type WorkState, type WorkWait } from '../verification-src/WorkGraph'
import { WorkSchedule } from '../verification-src/WorkSchedule'

/**
 * The schedule report is measured from finished states, so these tests build the states by hand. A
 * real graph run would make every number depend on the host's clock; a hand-built run states the
 * durations outright, which is what lets the expectations below be exact.
 */

type StateSpec = {
  elapsedMs: number
  name: string
  needs?: readonly string[]
  /** True for a node the graph settled without running, which never started and never worked. */
  neverStarted?: boolean
  resources?: readonly string[]
  /** Machine width the node occupied while it ran; the graph records what it granted. */
  slots?: number
  startedAt?: number
  waits?: readonly WorkWait[]
}

function finishedState(spec: StateSpec): WorkState {
  const state = WorkGraph.createState({
    name: spec.name,
    needs: spec.needs,
    resources: spec.resources,
    run: { args: [], command: 'true' },
  })
  state.elapsedMs = spec.elapsedMs
  state.status = spec.neverStarted === true ? 'skipped' : 'passed'
  state.startedAt = spec.neverStarted === true ? undefined : spec.startedAt ?? 0
  state.slots = spec.neverStarted === true ? undefined : spec.slots ?? 1
  state.waits = spec.waits
  return state
}

function finishedRun(options: {
  capacity: number
  makespanMs: number
  states: readonly StateSpec[]
}): WorkRunResult {
  return {
    capacity: options.capacity,
    finishedAt: options.makespanMs,
    interrupted: false,
    startedAt: 0,
    states: options.states.map(finishedState),
  }
}

Describe('serial floor of a finished run', () => {
  Test('names the longest ordered chain, in order', () => {
    const schedule = WorkSchedule.report(finishedRun({
      capacity: 8,
      makespanMs: 700,
      states: [
        { elapsedMs: 100, name: 'fix-just' },
        { elapsedMs: 300, name: 'fix-dprint', needs: ['fix-just'] },
        { elapsedMs: 200, name: 'typecheck', needs: ['fix-dprint'] },
        // Longer than any single member of the chain, but nothing has to wait for it.
        { elapsedMs: 500, name: 'repo-lint' },
      ],
    }))

    // 100 + 300 + 200 of work that cannot overlap, against a 500 node that can be packed anywhere.
    Expect(schedule.serialFloorMs).toBe(600)
    Expect(schedule.serialFloorPath).toEqual(['fix-just', 'fix-dprint', 'typecheck'])
  })

  Test('counts an exclusive resource as a floor, which the dependency path alone misses', () => {
    const schedule = WorkSchedule.report(finishedRun({
      capacity: 8,
      makespanMs: 1_000,
      states: [
        // No edge connects these three, so a critical path through the graph's edges sees 300ms of
        // work. One window server means they ran one after another: 900ms nothing can shorten.
        { elapsedMs: 300, name: 'studio-canary', resources: ['gui'] },
        { elapsedMs: 300, name: 'studio-smoke-native', resources: ['gui'] },
        { elapsedMs: 300, name: 'keyboard-navigation-smoke', resources: ['gui'] },
        { elapsedMs: 200, name: 'tao-check' },
        { elapsedMs: 200, name: 'typecheck', needs: ['tao-check'] },
      ],
    }))

    Expect(schedule.serialFloorMs).toBe(900)
    Expect(schedule.serialFloorPath).toEqual([
      'studio-canary',
      'studio-smoke-native',
      'keyboard-navigation-smoke',
    ])
  })
})

Describe('idle slot-seconds of a finished run', () => {
  Test('charges the same work less idle capacity once it packs', () => {
    // One 4s process that cannot be split holds one of four slots for the whole run.
    const wide = WorkSchedule.report(finishedRun({
      capacity: 4,
      makespanMs: 4_000,
      states: [{ elapsedMs: 4_000, name: 'dev' }],
    }))
    // The same 4s of work as four shards fills the machine for 1s and leaves nothing reserved.
    const packed = WorkSchedule.report(finishedRun({
      capacity: 4,
      makespanMs: 1_000,
      states: [
        { elapsedMs: 1_000, name: 'dev#1' },
        { elapsedMs: 1_000, name: 'dev#2' },
        { elapsedMs: 1_000, name: 'dev#3' },
        { elapsedMs: 1_000, name: 'dev#4' },
      ],
    }))

    // 4 slots for 4s is 16 slot-seconds reserved against 4 slot-seconds worked.
    Expect(wide.idleSlotSeconds).toBe(12)
    Expect(wide.makespanMs).toBe(4_000)
    Expect(packed.idleSlotSeconds).toBe(0)
    Expect(packed.makespanMs).toBe(1_000)
    Expect(wide.idleSlotSeconds > packed.idleSlotSeconds).toBe(true)
    // The floor moved with the packing, which is what makes the idle figure actionable rather than
    // just a fact about the machine.
    Expect(wide.serialFloorMs).toBe(4_000)
    Expect(packed.serialFloorMs).toBe(1_000)
  })

  Test('counts the width a node held, not merely that it ran', () => {
    const wideNode = WorkSchedule.report(finishedRun({
      capacity: 4,
      makespanMs: 1_000,
      states: [{ elapsedMs: 1_000, name: 'runtime-jest', slots: 4 }],
    }))

    // One node granted the whole machine for the whole run leaves no reserved capacity unused.
    Expect(wideNode.idleSlotSeconds).toBe(0)
    Expect(wideNode.capacity).toBe(4)
  })

  Test('leaves a node that never started out of the totals', () => {
    const schedule = WorkSchedule.report(finishedRun({
      capacity: 2,
      makespanMs: 1_000,
      states: [
        { elapsedMs: 1_000, name: 'repo-lint' },
        // A gate skipped on a failed dependency: no start, so nothing it reports is a measurement.
        { elapsedMs: 0, name: 'typecheck', neverStarted: true, waits: [{ kind: 'dependency', ms: 900 }] },
      ],
    }))

    // 2 slots for 1s reserved, 1 slot-second worked.
    Expect(schedule.idleSlotSeconds).toBe(1)
    Expect(schedule.waits).toEqual([])
  })
})

Describe('what a run waited on', () => {
  Test("names each waiting node's longest reason and ignores scheduling noise", () => {
    const schedule = WorkSchedule.report(finishedRun({
      capacity: 4,
      makespanMs: 2_000,
      states: [
        {
          elapsedMs: 100,
          name: 'typecheck',
          waits: [{ detail: 'fix-dprint', kind: 'dependency', ms: 900 }, { kind: 'capacity', ms: 200 }],
        },
        { elapsedMs: 100, name: 'studio-smoke-native', waits: [{ detail: 'gui', kind: 'resource', ms: 400 }] },
        // Below the published 250ms noise floor: a scan slice, not a finding.
        { elapsedMs: 100, name: 'repo-lint', waits: [{ kind: 'machine', ms: 200 }] },
        { elapsedMs: 100, name: 'fix-dprint' },
      ],
    }))

    Expect(schedule.waits.map(entry => entry.name)).toEqual(['typecheck', 'studio-smoke-native'])
    Expect(schedule.waits[0]?.waits).toEqual([{ detail: 'fix-dprint', kind: 'dependency', ms: 900 }])
    Expect(schedule.waits[1]?.waits).toEqual([{ detail: 'gui', kind: 'resource', ms: 400 }])
  })
})

Describe('the one line a run ends with', () => {
  Test('names the makespan, the floor and its path, the idle capacity, and the top waits', () => {
    const schedule = WorkSchedule.report(finishedRun({
      capacity: 4,
      makespanMs: 4_000,
      states: [
        { elapsedMs: 1_000, name: 'fix-dprint' },
        {
          elapsedMs: 3_000,
          name: 'typecheck',
          needs: ['fix-dprint'],
          startedAt: 1_000,
          waits: [{ detail: 'fix-dprint', kind: 'dependency', ms: 1_000 }],
        },
      ],
    }))

    const line = WorkSchedule.formatScheduleReport(schedule)

    // 16 slot-seconds reserved, 4 worked: 12 idle, which is 75% of the reservation.
    Expect(line).toBe(
      'Schedule: 4.0s makespan, 4.0s serial floor (fix-dprint -> typecheck), '
        + '12.0 idle slot-seconds of 4 (75% idle); waited: typecheck 1.0s on dependency fix-dprint',
    )
    Expect(line.includes('\n')).toBe(false)
  })

  Test('says nothing waited when nothing did', () => {
    const line = WorkSchedule.formatScheduleReport(WorkSchedule.report(finishedRun({
      capacity: 2,
      makespanMs: 1_000,
      states: [{ elapsedMs: 1_000, name: 'repo-lint' }, { elapsedMs: 1_000, name: 'typecheck' }],
    })))

    Expect(line).toBe(
      'Schedule: 1.0s makespan, 1.0s serial floor (repo-lint), 0.0 idle slot-seconds of 2 (0% idle); nothing waited',
    )
  })
})
