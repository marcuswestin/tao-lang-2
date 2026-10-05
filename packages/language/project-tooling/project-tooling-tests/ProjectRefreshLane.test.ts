import { Deferred, Describe, Expect, Test } from '@shared/test'
import { createProjectRefreshLane } from '../project-tooling-src/ProjectRefreshLane'
import type { ProjectToolingResult } from '../project-tooling-src/ProjectTooling'

function result(revision: number): ProjectToolingResult {
  return {
    root: '/project',
    status: 'fresh',
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
  Test('runs a request made during an active refresh after that refresh settles', async () => {
    const started = Deferred()
    const release = Deferred()
    const published: number[] = []
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      calls += 1
      if (calls === 1) {
        started.resolve()
        await release.promise
      }
      return result(calls)
    }, value => published.push(value.revision))

    const first = lane.requestRefresh()
    await started.promise
    const second = lane.requestRefresh()
    Expect(calls).toBe(1)
    release.resolve()
    Expect((await first).revision).toBe(1)
    Expect((await second).revision).toBe(2)
    Expect(lane.lastResult?.revision).toBe(2)
    Expect(published).toEqual([1, 2])
    await lane.dispose()
  })

  Test('disposal finishes active work and cancels queued work', async () => {
    const started = Deferred()
    const release = Deferred()
    let calls = 0
    const lane = createProjectRefreshLane(async () => {
      calls += 1
      started.resolve()
      await release.promise
      return result(1)
    })

    const first = lane.requestRefresh()
    await started.promise
    const queued = lane.requestRefresh()
    const queuedRejection = Expect(queued).rejects.toThrow('disposed')
    const disposing = lane.dispose()
    release.resolve()
    Expect((await first).revision).toBe(1)
    await queuedRejection
    await disposing
    Expect(calls).toBe(1)
    await Expect(lane.requestRefresh()).rejects.toThrow('disposed')
  })
})
