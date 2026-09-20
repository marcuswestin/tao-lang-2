import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { LandingLock, LandingLockBusyError, LandingLockUnreadableError } from '../dev-src/repository-tests/LandingLock'
import { MachineLanes } from '../dev-src/repository-tests/MachineLanes'

/**
 * The landing lock is the only thing standing between two agents landing at once, so these tests
 * are about the three properties that make it safe rather than about its happy path: a second
 * worktree is refused, the same worktree is not refused against itself, and nothing anywhere takes
 * a lock away on a timer.
 */

const ONE = '/worktree/one'
const TWO = '/worktree/two'

async function acquire(registryRoot: string, repositoryRoot: string, label = 'landing') {
  return await LandingLock.acquire({ label, registryRoot, repositoryRoot, waitTimeoutMs: 0 })
}

Describe('landing lock', () => {
  Test('is free until somebody claims it', async () => {
    const root = await mkTestDir('landing-lock-free')
    Expect(await LandingLock.inspect(root)).toBeUndefined()
    const hold = await acquire(root, ONE)
    Expect(hold.acquired).toBe(true)
    Expect((await LandingLock.inspect(root))?.holder).toBe(ONE)
  })

  Test('refuses a second worktree while the first holds it, and names the holder', async () => {
    const root = await mkTestDir('landing-lock-busy')
    await acquire(root, ONE, 'verify from one')
    const error = await acquire(root, TWO).then(() => undefined, (caught: unknown) => caught)
    Expect(error).toBeInstanceOf(LandingLockBusyError)
    Expect((error as LandingLockBusyError).holder.holder).toBe(ONE)
    Expect((error as LandingLockBusyError).message).toContain('verify from one')
  })

  Test('is re-entrant for the worktree that already holds it, so one agent never queues behind itself', async () => {
    const root = await mkTestDir('landing-lock-reentrant')
    const first = await acquire(root, ONE)
    const second = await acquire(root, ONE)
    Expect(first.acquired).toBe(true)
    // The second call did not take a new lock, which is what tells `holding` to leave it held.
    Expect(second.acquired).toBe(false)
    Expect(second.record.acquiredAt).toBe(first.record.acquiredAt)
  })

  Test('hands the lock to the waiting worktree once the holder releases it', async () => {
    const root = await mkTestDir('landing-lock-handover')
    const hold = await acquire(root, ONE)
    // A scoped hold is returned by its token; releasing without one ends a durable claim instead,
    // which is why `land-unlock` and a finishing lane are not the same call.
    Expect(await LandingLock.release({ registryRoot: root, repositoryRoot: ONE, token: hold.token! }))
      .toBe('released')
    const next = await acquire(root, TWO)
    Expect(next.acquired).toBe(true)
    Expect((await LandingLock.inspect(root))?.holder).toBe(TWO)
  })

  Test('releasing a lock nobody holds is a no-op, so a cleanup path is always safe to run', async () => {
    const root = await mkTestDir('landing-lock-release-free')
    Expect(await LandingLock.release({ registryRoot: root, repositoryRoot: ONE })).toBe('not-held')
  })

  Test(
    "refuses to release another worktree's lock, because that is the takeover it never does implicitly",
    async () => {
      const root = await mkTestDir('landing-lock-release-foreign')
      await acquire(root, ONE)
      const error = await LandingLock.release({ registryRoot: root, repositoryRoot: TWO })
        .then(() => undefined, (caught: unknown) => caught)
      Expect((error as Error).message).toContain('not by this worktree')
      Expect((await LandingLock.inspect(root))?.holder).toBe(ONE)
    },
  )

  Test('force-release with the matching holder releases, and reports whose lock it ended', async () => {
    const root = await mkTestDir('landing-lock-force')
    const hold = await acquire(root, ONE, 'wedged landing')
    const previous = await LandingLock.forceRelease(root, { holder: hold.record.pid })
    Expect(previous?.holder).toBe(ONE)
    Expect(previous?.label).toBe('wedged landing')
    Expect(await LandingLock.inspect(root)).toBeUndefined()
  })

  Test('force-release with a wrong holder refuses, naming the current holder', async () => {
    const root = await mkTestDir('landing-lock-force-wrong-holder')
    const hold = await acquire(root, ONE, 'wedged landing')
    const error = await LandingLock.forceRelease(root, { holder: hold.record.pid + 1 })
      .then(() => undefined, (caught: unknown) => caught)
    Expect((error as Error).message).toContain('wedged landing')
    Expect((error as Error).message).toContain(ONE)
    Expect((await LandingLock.inspect(root))?.holder).toBe(ONE)
  })

  Test('force-release with no holder refuses while a readable record exists', async () => {
    const root = await mkTestDir('landing-lock-force-no-holder')
    await acquire(root, ONE, 'wedged landing')
    const error = await LandingLock.forceRelease(root).then(() => undefined, (caught: unknown) => caught)
    Expect((error as Error).message).toContain('wedged landing')
    Expect((await LandingLock.inspect(root))?.holder).toBe(ONE)
  })

  Test('force-release on a free lock is a no-op', async () => {
    const root = await mkTestDir('landing-lock-force-free')
    Expect(await LandingLock.forceRelease(root)).toBeUndefined()
  })

  Test('a durable claim survives its acquiring process, because it is meant to outlive it', async () => {
    const root = await mkTestDir('landing-lock-durable-pid')
    await LandingLock.acquire({ durable: true, label: 'land-lock', registryRoot: root, repositoryRoot: ONE })
    // PID 0 is never live. A durable claim keeps no process promise, so this must change nothing:
    // the agent claims it in one process and lands in another.
    const path = FS.resolvePath('.landing-lock.json', root)
    await FS.writeJson(path, { ...(await FS.readJson<object>(path)), pid: 0 })
    const error = await acquire(root, TWO).then(() => undefined, (caught: unknown) => caught)
    Expect(error).toBeInstanceOf(LandingLockBusyError)
  })

  Test('an interrupted lane does not wedge the machine, because a scoped hold cannot outlive its process', async () => {
    const root = await mkTestDir('landing-lock-interrupted')
    const hold = await acquire(root, ONE)
    // Ctrl-C on a long `verify`: the token is never returned. Unlike the durable claim, a scoped
    // hold lasts exactly one command, so a dead process is proof the hold is over.
    const path = FS.resolvePath('.landing-lock.json', root)
    await FS.writeJson(path, {
      ...(await FS.readJson<object>(path)),
      scopedHolds: [{ pid: 0, token: hold.token }],
    })
    Expect((await acquire(root, TWO)).acquired).toBe(true)
  })

  Test('a locked lane takes the lock while it runs and gives it back when it ends', async () => {
    const root = await mkTestDir('landing-lock-locked-lane')
    let heldDuring: string | undefined
    await LandingLock.holdingForLane({ lane: 'verify', registryRoot: root, repositoryRoot: ONE }, async () => {
      heldDuring = (await LandingLock.inspect(root))?.holder
    })
    Expect(heldDuring).toBe(ONE)
    Expect(await LandingLock.inspect(root)).toBeUndefined()
  })

  Test('compares holders by resolved path, so a symlinked worktree does not queue behind itself', async () => {
    const root = await mkTestDir('landing-lock-symlink')
    const real = await mkTestDir('landing-lock-symlink-real')
    const link = FS.resolvePath('link', root)
    await FS.symlink(real, link)
    await LandingLock.acquire({ durable: true, label: 'one', registryRoot: root, repositoryRoot: real })
    // Reached by its symlinked spelling, the same worktree must be re-entrant rather than blocked.
    const again = await LandingLock.acquire({ label: 'verify', registryRoot: root, repositoryRoot: link })
    Expect(again.acquired).toBe(false)
  })

  Test('refuses a second worktree when the record is unreadable, rather than treating it as free', async () => {
    const root = await mkTestDir('landing-lock-corrupt')
    await acquire(root, ONE)
    await FS.writeText(FS.resolvePath('.landing-lock.json', root), 'not json at all')
    // The bug this pins: a truncated record once read as `free`, so a second worktree acquired it
    // while the first was still landing. Asserting `inspect()` alone did not catch that — only
    // attempting the acquisition does.
    const error = await acquire(root, TWO).then(() => undefined, (caught: unknown) => caught)
    Expect(error).toBeInstanceOf(LandingLockUnreadableError)
    Expect(await LandingLock.inspectState(root)).toMatchObject({ kind: 'unreadable' })
  })

  Test(
    'force-release clears a record too corrupt to name its holder, which is why a person reaches for it',
    async () => {
      const root = await mkTestDir('landing-lock-corrupt-force')
      await acquire(root, ONE)
      await FS.writeText(FS.resolvePath('.landing-lock.json', root), '{ truncated')
      Expect(await LandingLock.forceRelease(root)).toBeUndefined()
      Expect(await LandingLock.inspectState(root)).toMatchObject({ kind: 'free' })
      Expect((await acquire(root, TWO)).acquired).toBe(true)
    },
  )

  Test('counts overlapping holds in one worktree, so the first to finish cannot unlock the others', async () => {
    const root = await mkTestDir('landing-lock-refcount')
    // Two broad lanes in one checkout is ordinary, not exotic.
    const laneA = await acquire(root, ONE)
    const laneB = await acquire(root, ONE)
    Expect(await LandingLock.release({ registryRoot: root, repositoryRoot: ONE, token: laneA.token! }))
      .toBe('still-held')
    // Lane B is still verifying, so no other worktree may take the machine.
    const error = await acquire(root, TWO).then(() => undefined, (caught: unknown) => caught)
    Expect(error).toBeInstanceOf(LandingLockBusyError)
    Expect(await LandingLock.release({ registryRoot: root, repositoryRoot: ONE, token: laneB.token! }))
      .toBe('released')
    Expect((await acquire(root, TWO)).acquired).toBe(true)
  })

  Test('a durable claim outlives the commands that run under it, and ends only when it is unlocked', async () => {
    const root = await mkTestDir('landing-lock-durable')
    await LandingLock.acquire({ durable: true, label: 'land-lock', registryRoot: root, repositoryRoot: ONE })
    // A command-scoped lane runs and finishes; the agent's own claim must survive it.
    await LandingLock.holding({ label: 'verify', registryRoot: root, repositoryRoot: ONE }, async () => undefined)
    Expect((await LandingLock.inspect(root))?.durable).toBe(true)
    Expect(await LandingLock.release({ registryRoot: root, repositoryRoot: ONE })).toBe('released')
    Expect(await LandingLock.inspect(root)).toBeUndefined()
  })

  Test('holding releases only what it acquired, leaving a lock the agent took deliberately in place', async () => {
    const root = await mkTestDir('landing-lock-holding')
    await LandingLock.acquire({ durable: true, label: 'held by the agent', registryRoot: root, repositoryRoot: ONE })
    await LandingLock.holding({ label: 'verify', registryRoot: root, repositoryRoot: ONE }, async () => undefined)
    // The inner run was re-entrant, so the agent's own lock survives it.
    Expect((await LandingLock.inspect(root))?.label).toBe('held by the agent')

    const other = await mkTestDir('landing-lock-holding-own')
    await LandingLock.holding({ label: 'verify', registryRoot: other, repositoryRoot: ONE }, async () => undefined)
    Expect(await LandingLock.inspect(other)).toBeUndefined()
  })

  Test('locks the broad lanes and leaves every narrow one free', () => {
    for (const lane of ['verify', 'verify-full', 'verify-full-sandbox', 'test-all']) {
      Expect(LandingLock.requiresLock(lane)).toBe(true)
    }
    // An agent must be able to check the change it just made without waiting for anybody.
    for (const lane of ['verify-changed', 'test-changed', 'test-file', 'test-retry', 'check', 'fix', 'fmt']) {
      Expect(LandingLock.requiresLock(lane)).toBe(false)
    }
  })

  Test('survives the lane registry pruning the directory it shares with it', async () => {
    const root = await mkTestDir('landing-lock-prune')
    await acquire(root, ONE)
    // The registry reads every non-dotted *.json here as a lane record and deletes the stale ones.
    // A lock deleted by a passing neighbour is a lock two agents can hold, so this is the bug that
    // the dotted filename prevents, pinned here rather than left to the filename looking harmless.
    await MachineLanes.inspectLanes(root, { prune: true })
    Expect((await LandingLock.inspect(root))?.holder).toBe(ONE)
  })

  Test('runs an unlocked lane without touching the lock at all', async () => {
    const root = await mkTestDir('landing-lock-unlocked-lane')
    await LandingLock.holdingForLane(
      { lane: 'verify-changed', registryRoot: root, repositoryRoot: ONE },
      async () => undefined,
    )
    Expect(await LandingLock.inspect(root)).toBeUndefined()
  })
})
