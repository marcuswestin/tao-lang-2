import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
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
    Expect(await leaseFiles(registryRoot)).toEqual(['1.json', `${Platform.runtimeProcess.pid}.json`].sort())
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

  Test('a lane already inside a reserved width neither registers nor divides again', async () => {
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
    // `_test` runs inside the slots `verify` already reserved for it; a lease here would make one
    // lane look like two and halve the machine against itself.
    Expect(await leaseFiles(registryRoot)).toEqual([])
    await nested.release()
    await explicit.release()
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
