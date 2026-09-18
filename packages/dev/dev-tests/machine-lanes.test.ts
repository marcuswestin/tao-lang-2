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
    maxSlots: Platform.cpuCount(),
    repositoryRoot: '/elsewhere',
    slots: 4,
    startedAt: new Date().toISOString(),
    ...record,
  })
}

Describe('machine lanes', () => {
  Test('fairly divides available CPUs and gives every registered lane a chance to admit', () => {
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

    Expect([...MachineLanes.fairAllocations(18, records(1)).values()]).toEqual([18])
    Expect([...MachineLanes.fairAllocations(18, records(2)).values()]).toEqual([9, 9])
    Expect([...MachineLanes.fairAllocations(18, records(4)).values()]).toEqual([5, 5, 4, 4])
    // More lanes than CPUs is the case the one-slot floor exists for: every lane may still run
    // something, and the machine is oversubscribed by the number of lanes above its CPU count.
    Expect([...MachineLanes.fairAllocations(2, records(8)).values()]).toEqual(Array(8).fill(1))
  })

  Test('a second lane sees the first and takes half the machine', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    // Process 1 is the one pid guaranteed to be alive and not this process, which is what a lease
    // held by another worktree looks like from here.
    await writeForeignLease(registryRoot, { pid: 1 })

    const lane = await MachineLanes.acquire({ lane: 'verify', registryRoot, repositoryRoot: '/here' })

    Expect(lane.capacity).toBe(Math.ceil(Platform.cpuCount() / 2))
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

    Expect(work?.slots).toBe(4)
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

  Test('admits a lane that joins a machine whose slots are all reserved', async () => {
    // The stall this prevents: lanes that registered while the machine was emptier hold every slot
    // until their running nodes end, and a lane that joins after them must not wait on that.
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({ cpuCount: 2, lane: 'first', registryRoot, repositoryRoot: '/first' })
    const firstWork = await first.tryAcquire(2, false)
    Expect(firstWork?.slots).toBe(2)

    const second = await MachineLanes.acquire({ cpuCount: 2, lane: 'second', registryRoot, repositoryRoot: '/second' })
    const secondWork = await second.tryAcquire(1, false)

    Expect(secondWork?.slots).toBe(1)
    Expect(second.waitReason).toBeUndefined()
    const records = await MachineLanes.activeLanes(registryRoot)
    // Three slots on a two-CPU machine: the joining lane's floor, and nothing beyond it.
    Expect(records.reduce((sum, record) => sum + record.slots, 0)).toBe(3)

    // The floor is one slot per lane, not a way around the machine total: a lane that is already
    // running something waits like any other.
    Expect(await second.tryAcquire(1, true)).toBeUndefined()
    Expect(second.waitReason).toBe('this lane holds 1 of its 1 slots; 2 lanes are registered')

    await firstWork?.release()
    await secondWork?.release()
    await first.release()
    await second.release()
  })

  Test('does not let a joining lane stack a whole share on top of a full machine', async () => {
    // A lane that registered while the machine was emptier keeps the wider share it reserved under.
    // The lane that joins gets its floor so it can start, and then waits with everyone else: the
    // machine holds one extra slot, not a second full share on top of the first.
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const early = await MachineLanes.acquire({ cpuCount: 4, lane: 'early', registryRoot, repositoryRoot: '/early' })
    const earlyWork = await early.tryAcquire(4, false)
    Expect(earlyWork?.slots).toBe(4)

    const late = await MachineLanes.acquire({ cpuCount: 4, lane: 'late', registryRoot, repositoryRoot: '/late' })
    Expect(late.capacity).toBe(2)
    const floor = await late.tryAcquire(2, true)

    Expect(floor?.slots).toBe(1)
    Expect(await late.tryAcquire(1, true)).toBeUndefined()
    Expect(late.waitReason).toBe("every one of the machine's 4 slots is reserved; 2 lanes are registered")
    const total = (await MachineLanes.activeLanes(registryRoot)).reduce((sum, record) => sum + record.slots, 0)
    Expect(total).toBe(5)

    await floor?.release()
    await earlyWork?.release()
    await early.release()
    await late.release()
  })

  Test('says what a declined admission is waiting for', async () => {
    const registryRoot = await mkTestDir('tao-machine-lanes-')
    const first = await MachineLanes.acquire({ cpuCount: 4, lane: 'first', registryRoot, repositoryRoot: '/first' })
    const second = await MachineLanes.acquire({
      cpuCount: 4,
      lane: 'second',
      registryRoot,
      repositoryRoot: '/second-worktree',
    })

    const held = await first.tryAcquire(2, false)
    Expect(held?.slots).toBe(2)
    Expect(await first.tryAcquire(1, false)).toBeUndefined()
    Expect(first.waitReason).toBe('this lane holds 2 of its 2 slots; 2 lanes are registered')
    Expect(await second.tryAcquire(3, false)).toBeUndefined()
    Expect(second.waitReason).toBe('this node wants 3 slots, more than the 2 free to this lane; 2 lanes are registered')

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

  Test('exclusive confirmation drains a reservation held by another process', async () => {
    const root = await mkTestDir('tao-machine-exclusive-process-')
    const registryRoot = FS.resolvePath('registry', root)
    const releasePath = FS.resolvePath('release', root)
    const modulePath = Repo.resolvePath('packages/dev/dev-src/repository-tests/MachineLanes.ts')
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

      Expect(results.map(result => result.slots).toSorted()).toEqual([2, 2])
      Expect(results.every(result => result.peakLanes > 1)).toBe(true)
      Expect((await MachineLanes.activeLanes(registryRoot)).reduce((sum, record) => sum + record.slots, 0)).toBe(4)

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
      lane: 'verify',
      registryRoot: '/proc/tao-machine-lanes-cannot-exist',
      repositoryRoot: '/here',
    })

    Expect(lane.capacity).toBe(Platform.cpuCount())
    Expect(lane.report().contended).toBe(false)
    await lane.release()
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
