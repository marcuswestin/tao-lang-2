import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
import { type LaneRecord, MachineLanes } from '../dev-src/repository-tests/MachineLanes'

/**
 * The registry is what one worktree knows about the others, so every test here is about two lanes
 * meeting on one machine: the second one has to see the first, the first one has to disappear when
 * it ends or dies, and a lane that is already inside somebody else's reservation must not count
 * itself twice.
 */

async function leaseFiles(root: string): Promise<string[]> {
  return (await FS.listDir(root)).filter(name => name.endsWith('.json')).sort()
}

async function writeForeignLease(root: string, record: Partial<LaneRecord> & { pid: number }): Promise<void> {
  await FS.mkdir(root)
  await FS.writeJson(FS.resolvePath(`${record.pid}.json`, root), {
    lane: 'verify',
    repositoryRoot: '/elsewhere',
    slots: 4,
    startedAt: new Date().toISOString(),
    ...record,
  })
}

Describe('machine lanes', () => {
  Test('divides the machine between the lanes running on it, never below a workable width', () => {
    Expect(MachineLanes.shareOf(18, 1)).toBe(18)
    Expect(MachineLanes.shareOf(18, 2)).toBe(9)
    Expect(MachineLanes.shareOf(18, 4)).toBe(4)
    // Ten agents on one laptop still each get enough width to overlap two suites; below that a
    // lane's own wall time costs more than the contention it is dodging.
    Expect(MachineLanes.shareOf(18, 40)).toBe(MachineLanes.MIN_LANE_CAPACITY)
    Expect(MachineLanes.shareOf(2, 8)).toBe(MachineLanes.MIN_LANE_CAPACITY)
  })

  Test('a second lane sees the first and takes half the machine', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // Process 1 is the one pid guaranteed to be alive and not this process, which is what a lease
    // held by another worktree looks like from here.
    await writeForeignLease(registryRoot, { pid: 1 })

    const lane = await MachineLanes.acquire({ lane: 'verify', registryRoot, repositoryRoot: '/here' })

    Expect(lane.capacity).toBe(MachineLanes.shareOf(Platform.cpuCount(), 2))
    const leases = await leaseFiles(registryRoot)
    Expect(leases).toContain('1.json')
    Expect(leases.some(name => name.startsWith(`${Platform.runtimeProcess.pid}-`) && name.endsWith('.lane.json')))
      .toBe(true)
    Expect(lane.report().peakLanes).toBe(2)
    Expect(lane.report().contended).toBe(true)
    await lane.release()
    Expect(await leaseFiles(registryRoot)).toEqual(['1.json'])
  })

  Test('a released lane leaves nothing behind for the next one to divide by', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')

    const lane = await MachineLanes.acquire({ lane: 'dev-test', registryRoot, repositoryRoot: '/here' })
    Expect(await leaseFiles(registryRoot)).toHaveLength(1)
    Expect(lane.capacity).toBe(Platform.cpuCount())

    await lane.release()
    Expect(await leaseFiles(registryRoot)).toEqual([])
  })

  Test('a lane whose process is gone is pruned rather than counted', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // A worktree deleted mid-run, or an agent killed with its terminal, leaves its lease behind.
    // Counting it would shrink every later lane on this machine forever.
    await writeForeignLease(registryRoot, { pid: 2 ** 30 })

    Expect(await MachineLanes.activeLanes(registryRoot)).toEqual([])
    Expect(await leaseFiles(registryRoot)).toEqual([])
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

  Test('rebalances every admission when a second lane joins without oversubscribing', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({
      cpuCount: 6,
      lane: 'first',
      registryRoot,
      repositoryRoot: '/first',
    })
    const firstWork = await first.tryAcquire(3, false)
    Expect(firstWork?.slots).toBe(3)

    const second = await MachineLanes.acquire({
      cpuCount: 6,
      lane: 'second',
      registryRoot,
      repositoryRoot: '/second',
    })
    const secondWork = await second.tryAcquire(3, false)

    Expect(secondWork?.slots).toBe(3)
    // The first lane began with all six slots available, but its revised fair share is three.
    Expect(await first.tryAcquire(1, false)).toBeUndefined()
    const records = await MachineLanes.activeLanes(registryRoot)
    Expect(records.reduce((sum, record) => sum + record.slots, 0)).toBe(6)

    await firstWork?.release()
    await secondWork?.release()
    await first.release()
    const expandedWork = await second.tryAcquire(6, false)
    Expect(second.ceiling).toBe(6)
    Expect(expandedWork?.slots).toBe(6)
    await expandedWork?.release()
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

  Test('coordinates simultaneous admissions from independent processes against one CPU total', async () => {
    const root = await mkTestDir('tao-machine-lanes-processes-')
    const registryRoot = FS.resolvePath('registry', root)
    const beginPath = FS.resolvePath('begin', root)
    const releasePath = FS.resolvePath('release', root)
    const modulePath = Repo.resolvePath('packages/dev/dev-src/repository-tests/MachineLanes.ts')
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
    try {
      const earlyExits: CLI.CommandResult[] = []
      const children = [runChild('first'), runChild('second')].map(child =>
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

      Expect(results.map(result => result.slots).toSorted()).toEqual([2, 2])
      Expect(results.every(result => result.peakLanes > 1)).toBe(true)
      Expect((await MachineLanes.activeLanes(registryRoot)).reduce((sum, record) => sum + record.slots, 0)).toBe(4)

      await FS.writeText(releasePath, '')
      const exits = await Promise.all(children)
      Expect(exits.every(result => result.exitCode === 0)).toBe(true)
    } finally {
      await FS.writeText(releasePath, '').catch(() => {})
      await FS.remove(root)
    }
  })

  Test('an unreadable registry leaves the lane running at full width instead of failing', async () => {
    const lane = await MachineLanes.acquire({
      lane: 'verify',
      registryRoot: '/proc/tao-machine-lanes-cannot-exist',
      repositoryRoot: '/here',
    })

    Expect(lane.capacity).toBe(Platform.cpuCount())
    Expect(lane.report().contended).toBe(false)
    await lane.release()
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
