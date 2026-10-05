import { Errors } from '@shared'
import { Deferred, Describe, Expect, settle, Test } from '@shared/test'
import { createProjectRefreshLane } from '../project-tooling-src/ProjectRefreshLane'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

function result(revision: number, status: ProjectToolingResult['status'] = 'fresh'): ProjectToolingResult {
  return {
    root: '/project',
    status,
    diagnostics: [],
    contractPaths: [],
    sourceMappings: [],
    dependencyRoots: [],
    configInputPaths: [],
    externalSidecarInputPaths: [],
    sidecarOwnershipInputPaths: [],
    nativeBindingInputPaths: [],
    nativeBindingOutputPaths: [],
    changedOutputPaths: [],
    revision,
  }
}

Describe('project refresh lane', () => {
  Test('shares one later refresh across a burst while active and publishes before callers resolve', async () => {
    const started = Deferred()
    const release = Deferred()
    const events: string[] = []
    let calls = 0
    let running = 0
    let peakRunning = 0
    const lane = createProjectRefreshLane(async () => {
      const revision = ++calls
      running += 1
      peakRunning = Math.max(peakRunning, running)
      if (revision === 1) {
        started.resolve()
        await release.promise
      }
      running -= 1
      return result(revision)
    }, value => {
      Expect(lane.lastResult).toBe(value)
      events.push(`published ${value.revision}`)
    })

    const first = lane.requestRefresh().then(value => {
      events.push(`resolved ${value.revision}`)
      return value
    })
    await started.promise
    const burst = Array.from({ length: 32 }, () => lane.requestRefresh())
    Expect(calls).toBe(1)
    release.resolve()
    Expect((await first).revision).toBe(1)
    const values = await Promise.all(burst)
    Expect(values.map(value => value.revision)).toEqual(Array(32).fill(2))
    Expect(values.every(value => value === values[0])).toBe(true)
    Expect(calls).toBe(2)
    Expect(peakRunning).toBe(1)
    Expect(lane.lastResult).toBe(values[0])
    Expect(events).toEqual(['published 1', 'resolved 1', 'published 2'])
    await lane.dispose()
  })

  Test('requests made after the pending refresh starts share a third refresh', async () => {
    const started = [Deferred(), Deferred()]
    const release = [Deferred(), Deferred()]
    const published: number[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      const revision = ++calls
      if (revision <= 2) {
        started[revision - 1]!.resolve()
        await release[revision - 1]!.promise
      }
      return result(revision)
    }, value => published.push(value.revision))

    const first = lane.requestRefresh()
    await started[0]!.promise
    const second = [lane.requestRefresh(), lane.requestRefresh()]
    release[0]!.resolve()
    await started[1]!.promise
    const third = [lane.requestRefresh(), lane.requestRefresh()]
    Expect(calls).toBe(2)
    release[1]!.resolve()
    Expect((await first).revision).toBe(1)
    Expect((await Promise.all(second)).map(value => value.revision)).toEqual([2, 2])
    Expect((await Promise.all(third)).map(value => value.revision)).toEqual([3, 3])
    Expect(calls).toBe(3)
    Expect(published).toEqual([1, 2, 3])
    await lane.dispose()
  })

  Test('combines pending force requests without changing active options or caller receipts', async () => {
    const started = [Deferred(), Deferred()]
    const release = [Deferred(), Deferred()]
    const received: Array<{ force?: boolean }> = []
    let calls = 0
    const lane = createProjectRefreshLane(async options => {
      const revision = ++calls
      received.push(options)
      if (revision <= 2) {
        started[revision - 1]!.resolve()
        await release[revision - 1]!.promise
      }
      return result(revision)
    })

    const initialOptions = { force: false }
    const first = lane.requestRefresh(initialOptions)
    initialOptions.force = true
    await started[0]!.promise
    const pending = [
      lane.requestRefresh(),
      lane.requestRefresh({ force: true }),
      lane.requestRefresh({ force: false }),
      lane.requestRefresh(),
    ]
    Expect(received).toEqual([{ force: false }])
    release[0]!.resolve()
    await started[1]!.promise
    const following = [lane.requestRefresh({ force: false }), lane.requestRefresh()]
    Expect(received).toEqual([{ force: false }, { force: true }])
    release[1]!.resolve()
    Expect((await first).revision).toBe(1)
    const pendingResults = await Promise.all(pending)
    Expect(pendingResults.map(value => value.revision)).toEqual([2, 2, 2, 2])
    Expect(pendingResults.every(value => value === pendingResults[0])).toBe(true)
    const followingResults = await Promise.all(following)
    Expect(followingResults.map(value => value.revision)).toEqual([3, 3])
    Expect(followingResults[0]).toBe(followingResults[1])
    Expect(received).toEqual([{ force: false }, { force: true }, { force: false }])
    Expect(calls).toBe(3)
    Expect(lane.lastResult).toBe(followingResults[0])
    await lane.dispose()
  })

  Test('an explicit request refreshes again after a stale result', async () => {
    const published: string[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      calls += 1
      return result(calls, calls === 1 ? 'stale' : 'fresh')
    }, value => published.push(value.status))

    const stale = await lane.requestRefresh()
    Expect(stale.status).toBe('stale')
    Expect(lane.lastResult).toBe(stale)
    const fresh = await lane.requestRefresh()
    Expect(fresh.status).toBe('fresh')
    Expect(fresh.revision).toBe(2)
    Expect(lane.lastResult).toBe(fresh)
    Expect((await lane.requestRefresh()).revision).toBe(3)
    Expect(calls).toBe(3)
    Expect(published).toEqual(['stale', 'fresh', 'fresh'])
    await lane.dispose()
  })

  Test('a failed active refresh rejects its callers and still runs the shared pending refresh', async () => {
    const started = Deferred()
    const release = Deferred()
    const failure = Errors.abortError('refresh failed')
    const published: number[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      const revision = ++calls
      if (revision === 1) {
        started.resolve()
        await release.promise
        throw failure
      }
      return result(revision)
    }, value => published.push(value.revision))

    const first = lane.requestRefresh()
    const rejection = Expect(first).rejects.toBe(failure)
    await started.promise
    const pending = [lane.requestRefresh(), lane.requestRefresh()]
    release.resolve()
    await rejection
    Expect((await Promise.all(pending)).map(value => value.revision)).toEqual([2, 2])
    Expect(lane.lastResult?.revision).toBe(2)
    Expect((await lane.requestRefresh()).revision).toBe(3)
    Expect(calls).toBe(3)
    Expect(published).toEqual([2, 3])
    await lane.dispose()
  })

  Test('a failed shared pending refresh preserves the last result and allows a later request', async () => {
    const started = Deferred()
    const release = Deferred()
    const failure = Errors.abortError('pending refresh failed')
    const published: number[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      const revision = ++calls
      if (revision === 1) {
        started.resolve()
        await release.promise
      }
      if (revision === 2) {
        throw failure
      }
      return result(revision)
    }, value => published.push(value.revision))

    const first = lane.requestRefresh()
    await started.promise
    const pending = [lane.requestRefresh(), lane.requestRefresh()]
    const rejections = pending.map(value => Expect(value).rejects.toBe(failure))
    release.resolve()
    const previous = await first
    await Promise.all(rejections)
    Expect(lane.lastResult).toBe(previous)
    Expect(calls).toBe(2)
    Expect((await lane.requestRefresh()).revision).toBe(3)
    Expect(published).toEqual([1, 3])
    await lane.dispose()
  })

  Test('disposal immediately cancels the pending burst and waits for active publication', async () => {
    const started = Deferred()
    const release = Deferred()
    const published: number[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      calls += 1
      started.resolve()
      await release.promise
      return result(1)
    }, value => published.push(value.revision))

    const first = lane.requestRefresh()
    await started.promise
    const pending = Array.from({ length: 8 }, () => lane.requestRefresh())
    let canceled = 0
    const rejections = pending.map(value => {
      void value.catch(() => {
        canceled += 1
      })
      return Expect(value).rejects.toThrow('disposed')
    })
    let disposed = false
    const disposing = lane.dispose().then(() => {
      disposed = true
    })
    await Expect(lane.requestRefresh()).rejects.toThrow('disposed')
    try {
      await settle()
      Expect(canceled).toBe(8)
      Expect(disposed).toBe(false)
      Expect(published).toEqual([])
    } finally {
      release.resolve()
    }
    await Promise.all(rejections)
    Expect((await first).revision).toBe(1)
    await disposing
    Expect(disposed).toBe(true)
    Expect(calls).toBe(1)
    Expect(published).toEqual([1])
    Expect(lane.lastResult?.revision).toBe(1)
    await lane.dispose()
  })
})
