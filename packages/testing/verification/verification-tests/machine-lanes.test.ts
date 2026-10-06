import { CLI, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { type LaneRecord, type MachineLane, MachineLanes } from '../verification-src/MachineLanes'
import { VerificationLanes } from '../verification-src/VerificationLanes'
import { WorkGraph } from '../verification-src/WorkGraph'

/**
 * The registry is what one worktree knows about the others, so every test here is about two lanes
 * meeting on one machine: the second one has to see the first, the first one has to disappear when
 * it ends or dies, and a lane that is already inside somebody else's reservation must not count
 * itself twice.
 */

async function leaseFiles(root: string): Promise<string[]> {
  return (await FS.listDir(root)).filter(name => name.endsWith('.json')).sort()
}

/**
 * registerInOrder registers lanes one at a time, a clock tick apart. Arrival is recorded to the
 * millisecond and a tie falls back to the random registration id, so a test that means "this lane
 * arrived first" has to make that true rather than assume the loop was slow enough to make it so.
 */
async function registerInOrder(registryRoot: string, names: readonly string[]): Promise<MachineLane[]> {
  const lanes: MachineLane[] = []
  for (const lane of names) {
    lanes.push(await MachineLanes.acquire({ cpuCount: 4, lane, registryRoot, repositoryRoot: `/${lane}-worktree` }))
    await Time.sleep(2)
  }
  return lanes
}

async function writeForeignLease(root: string, record: Partial<LaneRecord> & { pid: number }): Promise<void> {
  await FS.mkdir(root)
  await FS.writeJson(FS.resolvePath(`${record.pid}.json`, root), {
    lane: 'verify',
    maxSlots: Platform.cpuCount(),
    repositoryRoot: '/elsewhere',
    slots: 4,
    startedAt: new Date().toISOString(),
    ...record,
  })
}

Describe('machine lanes', () => {
  Test('admits whole lanes in arrival order and queues everything behind them', () => {
    const records = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: String(index),
        lane: 'verify',
        maxSlots: 18,
        pid: index + 1,
        repositoryRoot: `/worktree-${index}`,
        slots: 0,
        startedAt: `2026-09-03T12:00:${String(index).padStart(2, '0')}.000Z`,
      }))

    // Ten lanes asking at once is the case this policy is sized for: two run, eight hold nothing.
    const queue = MachineLanes.laneQueue(records(10))
    Expect(queue.filter(entry => entry.admitted).map(entry => entry.record.id)).toEqual(['0', '1'])
    Expect(queue.map(entry => entry.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    Expect(MachineLanes.laneQueue(records(1)).map(entry => entry.admitted)).toEqual([true])
    // Two, from the run record rather than from a share of the CPUs: two overlapping lanes measured
    // 1.45x of the uncontended median and three measured 2.0x, against a 1.5x bar.
    Expect(MachineLanes.ADMITTED_LANES).toBe(2)
    // Arrival order, not registry order: a lane cannot be overtaken by one that registered later,
    // which is what makes the printed position drain strictly downwards.
    Expect(MachineLanes.laneQueue(records(3).toReversed()).map(entry => entry.record.id)).toEqual(['0', '1', '2'])
  })

  Test('a second lane sees the first and still runs at its full width', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // Process 1 is the one pid guaranteed to be alive and not this process, which is what a lease
    // held by another worktree looks like from here.
    await writeForeignLease(registryRoot, { pid: 1 })

    const lane = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify', registryRoot, repositoryRoot: '/here' })

    // Second of the two lanes this machine admits whole: it shares the machine, not its own width.
    Expect(lane.capacity).toBe(4)
    const leases = await leaseFiles(registryRoot)
    Expect(leases).toContain('1.json')
    Expect(leases.some(name => name.startsWith(`${Platform.runtimeProcess.pid}-`) && name.endsWith('.lane.json')))
      .toBe(true)
    Expect(lane.report().peakLanes).toBe(2)
    Expect(lane.report().contended).toBe(true)
    await lane.release()
    Expect(await leaseFiles(registryRoot)).toEqual(['1.json'])
  })

  Test('a lane whose process is gone is pruned rather than counted', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // A worktree deleted mid-run, or an agent killed with its terminal, leaves its lease behind.
    // Counting it would shrink every later lane on this machine forever.
    await writeForeignLease(registryRoot, { pid: 2 ** 30 })

    Expect(await MachineLanes.activeLanes(registryRoot)).toEqual([])
    Expect(await leaseFiles(registryRoot)).toEqual([])
  })

  Test('ignores malformed live records instead of admitting NaN accounting', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    await FS.mkdir(registryRoot)
    const path = FS.resolvePath('invalid.json', registryRoot)
    await FS.writeJson(path, {
      lane: 'verify',
      maxSlots: 4,
      pid: Platform.runtimeProcess.pid,
      repositoryRoot: '/elsewhere',
      startedAt: new Date().toISOString(),
    })

    Expect(await MachineLanes.activeLanes(registryRoot, { prune: false })).toEqual([])
    Expect(await FS.exists(path)).toBe(true)
    Expect(await MachineLanes.activeLanes(registryRoot)).toEqual([])
    Expect(await FS.exists(path)).toBe(false)
  })

  Test('keeps conservative accounting for a live lease from the preceding allocator', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    await FS.mkdir(registryRoot)
    await FS.writeJson(FS.resolvePath('legacy.json', registryRoot), {
      lane: 'legacy-verify',
      pid: 1,
      repositoryRoot: '/older-worktree',
      slots: 4,
      startedAt: new Date().toISOString(),
    })

    const lane = await MachineLanes.acquire({
      cpuCount: 8,
      lane: 'current-verify',
      registryRoot,
      repositoryRoot: '/current-worktree',
    })
    const work = await lane.tryAcquire(8, true)

    // The legacy record still normalizes conservatively — its whole stored width counts as held —
    // and that no longer narrows anyone else, because the machine is divided by whole lanes now.
    Expect(work?.slots).toBe(8)
    Expect((await MachineLanes.activeLanes(registryRoot)).find(record => record.lane === 'legacy-verify'))
      .toMatchObject({ maxSlots: 4, slots: 4 })
    await work?.release()
    await lane.release()
  })

  Test('rejects malformed ids and fractional accounting records', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    await FS.mkdir(registryRoot)
    for (
      const [name, invalid] of [
        ['id', { id: 42, maxSlots: 4, slots: 0 }],
        ['slots', { id: 'slots', maxSlots: 4, slots: 0.5 }],
        ['max', { id: 'max', maxSlots: 1.5, slots: 0 }],
      ] as const
    ) {
      await FS.writeJson(FS.resolvePath(`${name}.json`, registryRoot), {
        lane: 'verify',
        pid: Platform.runtimeProcess.pid,
        repositoryRoot: '/elsewhere',
        startedAt: new Date().toISOString(),
        ...invalid,
      })
    }

    Expect(await MachineLanes.activeLanes(registryRoot, { prune: false })).toEqual([])
  })

  Test('a nested lane does not register again, while explicit jobs is a top-level ceiling', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')

    const nested = await MachineLanes.acquire({
      lane: 'dev-test',
      registryRoot,
      repositoryRoot: '/here',
      reservedJobs: 5,
    })
    const explicit = await MachineLanes.acquire({
      lane: 'verify',
      registryRoot,
      repositoryRoot: '/here',
      requestedJobs: 3,
    })

    Expect(nested.capacity).toBe(5)
    Expect(explicit.capacity).toBe(3)
    // `_test` runs inside slots already reserved by verify; explicit jobs belongs to a top-level
    // lane and must still coordinate with other worktrees.
    Expect(await leaseFiles(registryRoot)).toHaveLength(1)
    await nested.release()
    await explicit.release()
    Expect(await leaseFiles(registryRoot)).toEqual([])
  })

  Test('an unrequested width on a wide machine stops at the scheduler cap', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const wide = await MachineLanes.acquire({ cpuCount: 18, lane: 'verify', registryRoot, repositoryRoot: '/here' })
    const narrow = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify', registryRoot, repositoryRoot: '/there' })

    Expect(wide.ceiling).toBe(WorkGraph.DEFAULT_WIDTH_CAP)
    Expect(narrow.ceiling).toBe(4)
    await wide.release()
    await narrow.release()
  })

  Test('a nested lane observes peer contention without registering a second time', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    await writeForeignLease(registryRoot, { pid: 1 })
    const outer = await MachineLanes.acquire({
      lane: 'verify',
      registryRoot,
      repositoryRoot: '/here',
      requestedJobs: 3,
    })
    const nested = await MachineLanes.acquire({
      lane: 'dev-test',
      registryRoot,
      repositoryRoot: '/here',
      reservedJobs: 3,
    })

    Expect(await leaseFiles(registryRoot)).toHaveLength(2)
    Expect(nested.report().peakLanes).toBe(2)
    Expect(nested.report().contended).toBe(true)
    await nested.release()
    await outer.release()
  })

  Test('runs both admitted lanes at full width rather than splitting the machine between them', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({
      cpuCount: 6,
      lane: 'first',
      registryRoot,
      repositoryRoot: '/first',
    })
    const firstWork = await first.tryAcquire(6, false)
    Expect(firstWork?.slots).toBe(6)

    const second = await MachineLanes.acquire({
      cpuCount: 6,
      lane: 'second',
      registryRoot,
      repositoryRoot: '/second',
    })
    const secondWork = await second.tryAcquire(6, false)

    // Neither lane is narrowed by the other's arrival: the machine is divided by whole lanes, and
    // the sum of admitted slots was never a quantity of CPU to divide.
    Expect(secondWork?.slots).toBe(6)
    Expect(first.capacity).toBe(6)
    const records = await MachineLanes.activeLanes(registryRoot)
    Expect(records.reduce((sum, record) => sum + record.slots, 0)).toBe(12)

    // Its own ceiling is still the bound on one lane.
    Expect(await first.tryAcquire(1, false)).toBeUndefined()
    Expect(first.waitReason).toBe('this lane holds 6 of its 6 slots; 2 lanes are registered')

    await firstWork?.release()
    await secondWork?.release()
    await first.release()
    await second.release()
  })

  Test('moves a queued broad lane up as the lanes ahead of it finish, and never lets a newcomer pass it', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // Registered one at a time, because arrival order is the whole property under test.
    const lanes = await registerInOrder(registryRoot, [
      VerificationLanes.TEST_ALL,
      VerificationLanes.VERIFY,
      VerificationLanes.VERIFY_FULL,
      VerificationLanes.VERIFY_FULL_SANDBOX,
    ])
    const [first, second, third, fourth] = [lanes[0]!, lanes[1]!, lanes[2]!, lanes[3]!]

    Expect(await third.tryAcquire(1, false)).toBeUndefined()
    Expect(third.waitReason).toBe(
      'queued at position 3 of 4 lanes; test-all in test-all-worktree and verify in verify-worktree are running',
    )
    Expect(await fourth.tryAcquire(1, false)).toBeUndefined()
    Expect(fourth.waitReason).toBe(
      'queued at position 4 of 4 lanes; test-all in test-all-worktree and verify in verify-worktree are running'
        + ', 1 more lane is queued ahead',
    )

    await first.release()
    // The position shrank by one, and the lane that was behind is still behind.
    Expect(await fourth.tryAcquire(1, false)).toBeUndefined()
    Expect(fourth.waitReason).toBe(
      'queued at position 3 of 3 lanes; verify in verify-worktree and verify-full in verify-full-worktree are running',
    )
    const promoted = await third.tryAcquire(4, false)
    Expect(promoted?.slots).toBe(4)
    Expect(third.capacity).toBe(4)

    await second.release()
    const last = await fourth.tryAcquire(4, false)
    Expect(last?.slots).toBe(4)

    await promoted?.release()
    await last?.release()
    await third.release()
    await fourth.release()
  })

  Test('keeps a narrow or unrecognized lane off the broad queue, admitted regardless of arrival order', () => {
    const record = (id: string, lane: string, startedAt: string) => ({
      id,
      lane,
      maxSlots: 4,
      pid: Number(id) + 1,
      repositoryRoot: `/worktree-${id}`,
      slots: 0,
      startedAt,
    })

    // A narrow lane and a lane name this module has never seen, both arriving before three broad
    // lanes — under whole-lane admission with no breadth distinction, either would have taken one of
    // the two `ADMITTED_LANES` positions.
    const records = [
      record('0', 'test-file', '2026-09-03T12:00:00.000Z'),
      record('1', 'a-lane-name-nobody-declared', '2026-09-03T12:00:01.000Z'),
      record('2', VerificationLanes.TEST_ALL, '2026-09-03T12:00:02.000Z'),
      record('3', VerificationLanes.VERIFY, '2026-09-03T12:00:03.000Z'),
      record('4', VerificationLanes.VERIFY_FULL, '2026-09-03T12:00:04.000Z'),
    ]

    const queue = MachineLanes.laneQueue(records)
    const byId = new Map(queue.map(entry => [entry.record.id, entry]))

    // Neither the narrow lane nor the unrecognized one occupies a broad position.
    Expect(byId.get('0')?.admitted).toBe(true)
    Expect(byId.get('0')?.position).toBe(0)
    Expect(byId.get('1')?.admitted).toBe(true)
    Expect(byId.get('1')?.position).toBe(0)
    // The two broad lanes that arrived next still take the two `ADMITTED_LANES` positions — the lanes
    // ahead of them in arrival order did not consume one.
    Expect(byId.get('2')?.admitted).toBe(true)
    Expect(byId.get('2')?.position).toBe(1)
    Expect(byId.get('3')?.admitted).toBe(true)
    Expect(byId.get('3')?.position).toBe(2)
    // The third broad lane queues, exactly as it would with no narrow lane present at all.
    Expect(byId.get('4')?.admitted).toBe(false)
    Expect(byId.get('4')?.position).toBe(3)
  })

  Test(
    'admits a narrow lane immediately alongside two admitted broad lanes and a queued third, '
      + "and leaves the narrow lane out of the queued lane's printed position",
    async () => {
      const registryRoot = await mkTestDir('tao-machine-lanes-')
      // The narrow lane registers first, ahead of every broad lane, so this also proves arrival order
      // never gives it a broad position to hold.
      const narrow = await MachineLanes.acquire({
        cpuCount: 4,
        lane: 'test-file',
        registryRoot,
        repositoryRoot: '/test-file-worktree',
      })
      Expect(narrow.capacity).toBe(4)
      const narrowWork = await narrow.tryAcquire(4, false)
      Expect(narrowWork?.slots).toBe(4)
      await Time.sleep(2)

      const lanes = await registerInOrder(registryRoot, [VerificationLanes.TEST_ALL, VerificationLanes.VERIFY])
      const work = await Promise.all(lanes.map(async lane => await lane.tryAcquire(4, false)))
      Expect(work.map(reservation => reservation?.slots)).toEqual([4, 4])

      const third = await MachineLanes.acquire({
        cpuCount: 4,
        lane: VerificationLanes.VERIFY_FULL,
        registryRoot,
        repositoryRoot: '/verify-full-worktree',
      })
      Expect(third.capacity).toBe(0)
      Expect(await third.tryAcquire(1, true)).toBeUndefined()
      // "3 of 3" and the two named lanes count only the broad ones: the narrow lane is running too,
      // but it is not part of what this lane is queued behind.
      Expect(third.waitReason).toBe(
        'queued at position 3 of 3 lanes; test-all in test-all-worktree and verify in verify-worktree are running',
      )

      await Promise.all(work.map(async reservation => await reservation?.release()))
      await Promise.all(lanes.map(async lane => await lane.release()))
      await third.release()
      await narrowWork?.release()
      await narrow.release()
    },
  )

  Test('says what a declined admission is waiting for', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({ cpuCount: 4, lane: 'first', registryRoot, repositoryRoot: '/first' })
    const second = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'second',
      registryRoot,
      repositoryRoot: '/second-worktree',
    })

    const held = await first.tryAcquire(4, false)
    Expect(held?.slots).toBe(4)
    Expect(await first.tryAcquire(1, false)).toBeUndefined()
    Expect(first.waitReason).toBe('this lane holds 4 of its 4 slots; 2 lanes are registered')
    const partial = await second.tryAcquire(3, false)
    Expect(partial?.slots).toBe(3)
    Expect(await second.tryAcquire(3, false)).toBeUndefined()
    Expect(second.waitReason).toBe('this node wants 3 slots, more than the 1 free to this lane; 2 lanes are registered')
    await partial?.release()

    // An exclusive holder outranks both, and is named so the waiting lane points somewhere.
    await held?.release()
    const exclusive = await second.acquireExclusive(1_000)
    Expect(await first.tryAcquire(1, false)).toBeUndefined()
    Expect(first.waitReason).toBe('another lane is confirming exclusively (second in second-worktree)')

    await exclusive?.release()
    await first.release()
    await second.release()
  })

  Test('exclusive confirmation blocks new admissions and waits for peer work to drain', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({ cpuCount: 4, lane: 'first', registryRoot, repositoryRoot: '/first' })
    const second = await MachineLanes.acquire({ cpuCount: 4, lane: 'second', registryRoot, repositoryRoot: '/second' })
    const peerWork = await second.tryAcquire(2, false)
    let acquired = false
    const exclusive = first.acquireExclusive(1_000).then(lease => {
      acquired = lease !== undefined
      return lease
    })

    await settle(5)
    Expect(acquired).toBe(false)
    Expect(await second.tryAcquire(1, false)).toBeUndefined()
    await peerWork?.release()
    await until(() => acquired, { description: 'exclusive confirmation to acquire after peers drain' })

    await (await exclusive)?.release()
    await first.release()
    await second.release()
  })

  Test('landing priority lets existing lanes finish and pauses later lanes until release', async () => {
    const registryRoot = await mkTestDir('tao-machine-landing-priority-')
    const existing = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'test-file',
      registryRoot,
      repositoryRoot: '/existing',
    })
    const priority = await MachineLanes.beginLandingPriority(registryRoot)
    Expect(priority).toBeDefined()
    const holder = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'verify-full',
      landingPriorityToken: priority!.token,
      registryRoot,
      repositoryRoot: '/landing',
    })
    const later = await MachineLanes.acquire({
      cpuCount: 4,
      lane: VerificationLanes.TEST_ALL,
      registryRoot,
      repositoryRoot: '/later',
    })
    try {
      // A lane registered before the window may keep starting its remaining nodes. This is what
      // allows it to finish even if it already holds GUI or prepare when the landing begins.
      const existingWork = await existing.tryAcquire(1, false)
      const holderWork = await holder.tryAcquire(1, false)
      Expect(existingWork?.slots).toBe(1)
      Expect(holderWork?.slots).toBe(1)
      Expect(await later.tryAcquire(1, false)).toBeUndefined()
      Expect(later.waitReason).toContain('landing verification has priority')

      let admitted = false
      const waiting = later.waitForLandingPriority().then(() => {
        admitted = true
      })
      await settle(5)
      Expect(admitted).toBe(false)
      await priority?.release()
      await waiting
      Expect(admitted).toBe(true)
      const laterWork = await later.tryAcquire(1, false)
      Expect(laterWork?.slots).toBe(1)
      await laterWork?.release()
      await existingWork?.release()
      await holderWork?.release()
    } finally {
      await priority?.release()
      await existing.release()
      await holder.release()
      await later.release()
    }
  })

  Test('landing priority does not hold back new narrow test and developer lanes', async () => {
    const registryRoot = await mkTestDir('tao-machine-landing-priority-')
    const priority = await MachineLanes.beginLandingPriority(registryRoot)
    Expect(priority).toBeDefined()
    const lanes = await Promise.all(['test-file', 'tao-check'].map(lane =>
      MachineLanes.acquire({
        cpuCount: 4,
        lane,
        registryRoot,
        repositoryRoot: `/${lane}`,
      })
    ))
    try {
      for (const lane of lanes) {
        await lane.waitForLandingPriority()
        Expect(await lane.tryAcquire(1, false)).toMatchObject({ slots: 1 })
      }
    } finally {
      await priority?.release()
      await Promise.all(lanes.map(lane => lane.release()))
    }
  })

  Test('a dead landing process cannot leave priority stuck', async () => {
    const registryRoot = await mkTestDir('tao-machine-landing-priority-')
    await FS.mkdir(registryRoot)
    await FS.writeJson(FS.resolvePath('.landing-priority', registryRoot), {
      id: 'dead',
      pid: 2 ** 30,
      startedAt: new Date().toISOString(),
      existingLaneIds: [],
      ownerLaneIds: [],
    })
    const lane = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'test-file',
      registryRoot,
      repositoryRoot: '/later',
    })
    try {
      await lane.waitForLandingPriority()
      Expect((await lane.tryAcquire(1, false))?.slots).toBe(1)
      Expect(await FS.exists(FS.resolvePath('.landing-priority', registryRoot))).toBe(false)
    } finally {
      await lane.release()
    }
  })

  Test("a paused broad lane cannot take the landing verifier's queue position", async () => {
    const registryRoot = await mkTestDir('tao-machine-landing-priority-')
    const existing = await MachineLanes.acquire({
      cpuCount: 4,
      lane: VerificationLanes.VERIFY,
      registryRoot,
      repositoryRoot: '/existing',
    })
    const priority = await MachineLanes.beginLandingPriority(registryRoot)
    Expect(priority).toBeDefined()
    const paused = await MachineLanes.acquire({
      cpuCount: 4,
      lane: VerificationLanes.VERIFY_FULL,
      registryRoot,
      repositoryRoot: '/paused',
    })
    const holder = await MachineLanes.acquire({
      cpuCount: 4,
      lane: VerificationLanes.VERIFY_FULL,
      landingPriorityToken: priority!.token,
      registryRoot,
      repositoryRoot: '/landing',
    })
    try {
      Expect(await paused.tryAcquire(1, false)).toBeUndefined()
      const running = await holder.tryAcquire(4, false)
      Expect(running?.slots).toBe(4)
      await running?.release()
    } finally {
      await priority?.release()
      await existing.release()
      await paused.release()
      await holder.release()
    }
  })

  Test('exclusive confirmation drains a reservation held by another process', async () => {
    const root = await mkTestDir('tao-machine-exclusive-process-')
    const registryRoot = FS.resolvePath('registry', root)
    const releasePath = FS.resolvePath('release', root)
    const modulePath = Repo.resolvePath('packages/testing/verification/verification-src/MachineLanes.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const parent = await MachineLanes.acquire({ cpuCount: 4, lane: 'parent', registryRoot, repositoryRoot: root })
    const script = `
      import { Errors, FS, Time } from ${JSON.stringify(sharedPath)}
      import { MachineLanes } from ${JSON.stringify(modulePath)}
      const root = process.env['TAO_LANE_TEST_ROOT']
      if (!root) Errors.throwUnexpected('Missing process test root.')
      const lane = await MachineLanes.acquire({
        cpuCount: 4, lane: 'child', registryRoot: FS.resolvePath('registry', root), repositoryRoot: root,
      })
      const work = await lane.tryAcquire(2, false)
      if (!work) Errors.throwUnexpected('Child did not acquire its reservation.')
      await FS.writeText(FS.resolvePath('ready', root), '')
      while (!await FS.exists(FS.resolvePath('release', root))) await Time.sleep(5)
      await work.release()
      await lane.release()
    `
    const child = CLI.run('bun', {
      args: ['-e', script],
      env: { TAO_LANE_TEST_ROOT: root },
      stdio: 'pipe',
    })
    try {
      await until(async () => await FS.exists(FS.resolvePath('ready', root)), {
        description: 'child process to hold a machine reservation',
      })
      let acquired = false
      const exclusive = parent.acquireExclusive(1_000).then(lease => {
        acquired = lease !== undefined
        return lease
      })
      await settle(5)
      Expect(acquired).toBe(false)

      await FS.writeText(releasePath, '')
      Expect((await child).exitCode).toBe(0)
      await until(() => acquired, { description: 'exclusive lease after child process drains' })
      await (await exclusive)?.release()
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await child.catch(() => undefined)
      await parent.release()
      await FS.remove(root)
    }
  })

  Test('coordinates simultaneous admissions from independent processes against one arrival queue', async () => {
    const root = await mkTestDir('tao-machine-lanes-processes-')
    const registryRoot = FS.resolvePath('registry', root)
    const beginPath = FS.resolvePath('begin', root)
    const releasePath = FS.resolvePath('release', root)
    const modulePath = Repo.resolvePath('packages/testing/verification/verification-src/MachineLanes.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const script = `
      import { Errors, FS, Time } from ${JSON.stringify(sharedPath)}
      import { MachineLanes } from ${JSON.stringify(modulePath)}
      const root = process.env['TAO_LANE_TEST_ROOT']
      const id = process.env['TAO_LANE_TEST_ID']
      if (!root || !id) Errors.throwUnexpected('Missing process test input.')
      const lane = await MachineLanes.acquire({
        cpuCount: 4,
        lane: id,
        registryRoot: FS.resolvePath('registry', root),
        repositoryRoot: root,
      })
      await FS.writeText(FS.resolvePath('ready-' + id, root), '')
      while (!await FS.exists(FS.resolvePath('begin', root))) await Time.sleep(5)
      const work = await lane.tryAcquire(4, true)
      await FS.writeJson(FS.resolvePath('result-' + id + '.json', root), {
        peakLanes: lane.report().peakLanes,
        slots: work?.slots ?? 0,
      })
      while (!await FS.exists(FS.resolvePath('release', root))) await Time.sleep(5)
      await work?.release()
      await lane.release()
    `
    const runChild = (id: string) =>
      CLI.run('bun', {
        args: ['-e', script],
        env: { TAO_LANE_TEST_ID: id, TAO_LANE_TEST_ROOT: root },
        stdio: 'pipe',
      })
    let children: Promise<CLI.CommandResult>[] = []
    try {
      const earlyExits: CLI.CommandResult[] = []
      children = [runChild('first'), runChild('second')].map(child =>
        child.then(result => {
          earlyExits.push(result)
          return result
        })
      )
      await until(async () =>
        earlyExits.length > 0
        || await FS.exists(FS.resolvePath('ready-first', root))
          && await FS.exists(FS.resolvePath('ready-second', root)), {
        description: 'both independent lane processes to register',
      })
      Expect(earlyExits.map(result => `${result.stdout}${result.stderr}`)).toEqual([])
      await FS.writeText(beginPath, '')
      await until(async () =>
        await FS.exists(FS.resolvePath('result-first.json', root))
        && await FS.exists(FS.resolvePath('result-second.json', root)), {
        description: 'both independent lane processes to reserve their shares',
      })
      const results = await Promise.all(
        ['first', 'second'].map(id =>
          FS.readJson<{ peakLanes: number; slots: number }>(FS.resolvePath(`result-${id}.json`, root))
        ),
      )

      // Both processes are inside the admitted count, so each takes the width it asked for and the
      // registry accounts for both without either narrowing the other.
      Expect(results.map(result => result.slots).toSorted()).toEqual([4, 4])
      Expect(results.every(result => result.peakLanes > 1)).toBe(true)
      Expect((await MachineLanes.activeLanes(registryRoot)).reduce((sum, record) => sum + record.slots, 0)).toBe(8)

      await FS.writeText(releasePath, '')
      const exits = await Promise.all(children)
      Expect(exits.every(result => result.exitCode === 0)).toBe(true)
    } finally {
      await FS.writeText(beginPath, '').catch(() => {})
      await FS.writeText(releasePath, '').catch(() => {})
      await Promise.allSettled(children)
      await FS.remove(root)
    }
  })

  Test('does not fail open when a live process holds the registry mutex', async () => {
    const registryRoot = await mkTestDir('tao-machine-live-mutex-')
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('live.json', ownerRoot)
    await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString() })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      await Expect(MachineLanes.acquire({
        lane: 'verify',
        lockTimeoutMs: 5,
        registryRoot,
        repositoryRoot: '/here',
      })).rejects.toThrow('Timed out waiting for the machine-lane registry lock')
      Expect((await leaseFiles(registryRoot)).filter(name => name.endsWith('.lane.json'))).toEqual([])
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('does not reclaim an old mutex while its owning process is still alive', async () => {
    const registryRoot = await mkTestDir('tao-machine-old-live-mutex-')
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('old-live.json', ownerRoot)
    await FS.writeJson(ownerPath, {
      pid: Platform.runtimeProcess.pid,
      startedAt: new Date(Date.now() - 120_000).toISOString(),
    })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      await Expect(MachineLanes.acquire({
        lane: 'verify',
        lockTimeoutMs: 5,
        registryRoot,
        repositoryRoot: '/here',
      })).rejects.toThrow('Timed out waiting for the machine-lane registry lock')
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('a failed slot release remains retryable and never strands its accounting', async () => {
    const registryRoot = await mkTestDir('tao-machine-release-retry-')
    const lane = await MachineLanes.acquire({
      cpuCount: 2,
      lane: 'verify',
      lockTimeoutMs: 5,
      registryRoot,
      repositoryRoot: '/here',
    })
    const reservation = await lane.tryAcquire(1, false)
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('release-blocker.json', ownerRoot)
    await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString() })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      await Expect(reservation?.release()).rejects.toThrow('Timed out waiting for the machine-lane registry lock')
      Expect((await MachineLanes.activeLanes(registryRoot))[0]?.slots).toBe(1)

      await FS.remove(FS.resolvePath('.mutex', registryRoot))
      await FS.remove(ownerPath)
      await reservation?.release()
      Expect((await MachineLanes.activeLanes(registryRoot))[0]?.slots).toBe(0)
    } finally {
      await FS.remove(FS.resolvePath('.mutex', registryRoot)).catch(() => {})
      await FS.remove(ownerPath).catch(() => {})
      await lane.release()
    }
  })

  Test('a failed exclusive release remains retryable and never strands exclusivity', async () => {
    const registryRoot = await mkTestDir('tao-machine-exclusive-release-retry-')
    const first = await MachineLanes.acquire({
      cpuCount: 2,
      lane: 'first',
      lockTimeoutMs: 5,
      registryRoot,
      repositoryRoot: '/first',
    })
    const exclusive = await first.acquireExclusive(100)
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('exclusive-release-blocker.json', ownerRoot)
    await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString() })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      await Expect(exclusive?.release()).rejects.toThrow('Timed out waiting for the machine-lane registry lock')

      await FS.remove(FS.resolvePath('.mutex', registryRoot))
      await FS.remove(ownerPath)
      const second = await MachineLanes.acquire({
        cpuCount: 2,
        lane: 'second',
        lockTimeoutMs: 5,
        registryRoot,
        repositoryRoot: '/second',
      })
      Expect(await second.tryAcquire(1, false)).toBeUndefined()

      await exclusive?.release()
      const reservation = await second.tryAcquire(1, false)
      Expect(reservation?.slots).toBe(1)
      await reservation?.release()
      await second.release()
    } finally {
      await FS.remove(FS.resolvePath('.mutex', registryRoot)).catch(() => {})
      await FS.remove(ownerPath).catch(() => {})
      await first.release()
    }
  })

  Test('a failed named-resource release remains retryable and never strands its lease', async () => {
    const registryRoot = await mkTestDir('tao-machine-resource-release-retry-')
    const lease = await MachineLanes.tryAcquireResource({
      lockTimeoutMs: 5,
      name: 'retryable-resource',
      registryRoot,
      repositoryRoot: '/first',
    })
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('resource-release-blocker.json', ownerRoot)
    await FS.writeJson(ownerPath, { pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString() })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      await Expect(lease?.release()).rejects.toThrow('Timed out waiting for the machine-lane registry lock')

      await FS.remove(FS.resolvePath('.mutex', registryRoot))
      await FS.remove(ownerPath)
      Expect(
        await MachineLanes.tryAcquireResource({
          lockTimeoutMs: 5,
          name: 'retryable-resource',
          registryRoot,
          repositoryRoot: '/second',
        }),
      ).toBeUndefined()

      await lease?.release()
      const next = await MachineLanes.tryAcquireResource({
        lockTimeoutMs: 5,
        name: 'retryable-resource',
        registryRoot,
        repositoryRoot: '/second',
      })
      Expect(next?.owner.repositoryRoot).toBe('/second')
      await next?.release()
    } finally {
      await FS.remove(FS.resolvePath('.mutex', registryRoot)).catch(() => {})
      await FS.remove(ownerPath).catch(() => {})
      await lease?.release().catch(() => {})
    }
  })

  Test('stale-mutex recovery admits only one contender against the same final slot', async () => {
    const registryRoot = await mkTestDir('tao-machine-stale-mutex-race-')
    const lane = await MachineLanes.acquire({
      cpuCount: 1,
      lane: 'verify',
      registryRoot,
      repositoryRoot: '/here',
    })
    const ownerRoot = FS.resolvePath('.mutex-contenders', registryRoot)
    const ownerPath = FS.resolvePath('dead-owner.json', ownerRoot)
    await FS.writeJson(ownerPath, { pid: 2 ** 30, startedAt: new Date().toISOString() })
    await FS.symlink(FS.relativePath(registryRoot, ownerPath), FS.resolvePath('.mutex', registryRoot))
    try {
      const reservations = await Promise.all(
        Array.from({ length: 12 }, () => lane.tryAcquire(1, false)),
      )
      const acquired = reservations.filter(reservation => reservation !== undefined)

      Expect(acquired).toHaveLength(1)
      Expect((await MachineLanes.activeLanes(registryRoot))[0]?.slots).toBe(1)
      await acquired[0]?.release()
    } finally {
      await lane.release()
    }
  })

  Test('an unreadable registry leaves the lane running at full width instead of failing', async () => {
    const lane = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'verify',
      registryRoot: '/proc/tao-machine-lanes-cannot-exist',
      repositoryRoot: '/here',
    })

    Expect(lane.capacity).toBe(4)
    Expect(lane.report().contended).toBe(false)
    // Unbrokered means admitted: a lane that cannot see the queue is never told to wait in it.
    Expect((await lane.tryAcquire(4, false))?.slots).toBe(4)
    Expect(lane.waitReason).toBeUndefined()
    await lane.release()
  })

  Test('a registry that becomes unreadable mid-run admits the lane rather than queueing it', async () => {
    // Admission is advisory: whole-lane queueing is worth a wait only while the queue can be read.
    // Unlike `LandingLock`, which fails closed, a lane whose registry disappears keeps working.
    const root = await mkTestDir('tao-machine-lanes-vanishing-')
    const registryRoot = FS.resolvePath('registry', root)
    const lane = await MachineLanes.acquire({ cpuCount: 4, lane: 'verify', registryRoot, repositoryRoot: '/here' })
    try {
      const reserved = await lane.tryAcquire(4, false)
      Expect(reserved?.slots).toBe(4)
      await reserved?.release()

      // A file where the registry directory belongs: every read and every lock of it now fails.
      await FS.remove(registryRoot)
      await FS.writeText(registryRoot, 'not a directory\n')
      const degraded = await lane.tryAcquire(4, false)

      Expect(degraded?.slots).toBe(4)
      Expect(lane.waitReason).toBeUndefined()
      await degraded?.release()
    } finally {
      await FS.remove(registryRoot).catch(() => {})
      await lane.release().catch(() => {})
      await FS.remove(root)
    }
  })

  Test('an unreadable resource registry fails closed', async () => {
    await Expect(
      MachineLanes.tryAcquireResource({ name: 'studio-ports', registryRoot: '/proc/tao-machine-resource-test' }),
    ).rejects.toThrow('Cannot coordinate machine resource')
  })

  Test('calls a run contended when another lane ran, or when load outran the machine', () => {
    Expect(MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 1, peakLoadAverage: 12 }).contended).toBe(false)
    Expect(MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 2, peakLoadAverage: 12 }).contended).toBe(true)
    // One lane at full width drives load to roughly the CPU count; well past that is work this run
    // never started, whether or not whatever started it registered a lane.
    Expect(MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 1, peakLoadAverage: 40 }).contended).toBe(true)
  })

  Test('describes contention in the terms a reader needs to act on', () => {
    const report = MachineLanes.contentionReport({ cpuCount: 18, peakLanes: 3, peakLoadAverage: 41.27 })

    Expect(MachineLanes.describeContention(report)).toBe('3 Tao lanes ran at once; load peaked at 41.3 on 18 CPUs')
  })

  Test('registers under a per-user cache directory, never inside a worktree', () => {
    // A registry inside a checkout is invisible to every other checkout, which is the whole
    // problem it exists to solve.
    Expect(MachineLanes.registryRoot()).toContain('tao/machine-lanes')
    Expect(MachineLanes.registryRoot().startsWith('/')).toBe(true)
  })
})
