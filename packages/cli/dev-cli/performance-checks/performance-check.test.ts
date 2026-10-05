import { Errors } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import { type MachineLane, MachineLanes } from '@verification/MachineLanes'
import { PerformanceCheck } from '../dev-cli-src/performance/performance-check'

type Dependencies = NonNullable<Parameters<typeof PerformanceCheck.run>[0]>

function fixture() {
  const calls: string[] = []
  const reports: Parameters<Dependencies['writeReport']>[0][] = []
  const environments: Record<string, string>[] = []
  const state = {
    registered: false,
    available: true,
    missingOwner: false,
    peerPresent: false,
    peerSlots: 0,
    load: 1,
    languageExit: 0,
    studioExit: 0,
    sample: undefined as (() => Promise<void>) | undefined,
    language: undefined as (() => Promise<void>) | undefined,
    studio: undefined as (() => Promise<void>) | undefined,
    stop: undefined as (() => Promise<void>) | undefined,
  }
  const lane: MachineLane = {
    id: 'owner',
    capacity: 8,
    ceiling: 8,
    waitReason: undefined,
    acquireExclusive: async () => {
      calls.push('exclusive')
      return {
        release: async () => {
          calls.push('exclusive-release')
        },
      }
    },
    release: async () => {
      calls.push('lane-release')
      state.registered = false
    },
    report: () => ({ contended: false, cpuCount: 8, peakLanes: 1, peakLoadAverage: 1 }),
    tryAcquire: async () => undefined,
    waitForAvailability: async () => {},
    waitForLandingPriority: async () => {},
  }
  const dependencies: Dependencies = {
    acquire: async () => {
      calls.push('acquire')
      state.registered = true
      return lane
    },
    inspect: async () => ({
      available: state.available,
      lanes: [
        ...(state.registered && !state.missingOwner ? [{ id: 'owner', lane: 'performance-check', slots: 0 }] : []),
        ...(state.peerPresent ? [{ id: 'peer', lane: 'verify', slots: state.peerSlots }] : []),
      ].map(record => ({ ...record, maxSlots: 8, pid: 1, repositoryRoot: '/repo', startedAt: 'now' })),
    }),
    cpuCount: () => 8,
    loadAverage: () => state.load,
    now: () => '2026-10-04T00:00:00Z',
    monitor: sample => {
      calls.push('monitor-start')
      state.sample = sample
      return async () => {
        calls.push('monitor-stop')
        await state.stop?.()
      }
    },
    runLanguage: async env => {
      calls.push('language-start')
      environments.push(env)
      await state.language?.()
      calls.push('language-end')
      return state.languageExit
    },
    runStudio: async (_runId, env) => {
      calls.push('studio-start')
      environments.push(env)
      await state.studio?.()
      calls.push('studio-end')
      return state.studioExit
    },
    qualifyStudio: async () => {
      calls.push('qualify')
      return 0
    },
    writeReport: async report => {
      calls.push('write')
      reports.push(report)
    },
    log: () => {},
  }
  return { calls, dependencies, environments, lane, reports, state }
}

Describe('standalone performance protection', () => {
  Test('measures sequentially inside the exclusive lease and preserves evidence after cleanup', async () => {
    const fake = fixture()
    const language = Deferred()
    fake.state.language = async () => await language.promise
    const result = PerformanceCheck.run(fake.dependencies)
    await until(() => fake.calls.includes('language-start'))
    Expect(fake.calls).toEqual(['acquire', 'exclusive', 'monitor-start', 'language-start'])
    language.resolve()
    Expect(await result).toBe(0)
    Expect(fake.calls).toEqual([
      'acquire',
      'exclusive',
      'monitor-start',
      'language-start',
      'language-end',
      'studio-start',
      'studio-end',
      'qualify',
      'monitor-stop',
      'exclusive-release',
      'lane-release',
      'write',
    ])
    Expect(fake.reports[0]?.status).toBe('passed')
    Expect(fake.environments).toHaveLength(2)
    Expect(fake.environments[0]?.['TAO_MACHINE_LANE_ID']).toBe('owner')
    Expect(fake.environments[1]?.['TAO_STUDIO_PREVIEW_PERFORMANCE']).toBe('true')
    Expect(fake.environments[1]?.['TAO_STUDIO_PREVIEW_PERFORMANCE_ARTIFACT_ROOT']).toContain('.artifacts/performance/')
  })

  Test('refuses unavailable registries, busy lanes, and load above half the CPUs', async () => {
    for (
      const change of [
        { available: false },
        { peerPresent: true },
        { load: 4.01 },
        { load: NaN },
      ]
    ) {
      const fake = fixture()
      Object.assign(fake.state, change)
      Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
      Expect(fake.calls).toEqual(['write'])
      Expect(fake.reports[0]?.status).toBe('inconclusive')
      Expect(fake.reports[0]?.reasons.length).toBe(1)
    }
    const boundary = fixture()
    boundary.state.load = 4
    Expect(await PerformanceCheck.run(boundary.dependencies)).toBe(0)
  })

  Test('fails closed when registration or exclusive acquisition falls back', async () => {
    const unregistered = fixture()
    Object.defineProperty(unregistered.lane, 'id', { value: undefined })
    Expect(await PerformanceCheck.run(unregistered.dependencies)).toBe(2)
    Expect(unregistered.calls).toEqual(['acquire', 'lane-release', 'write'])
    const unavailable = fixture()
    unavailable.lane.acquireExclusive = async () => undefined
    Expect(await PerformanceCheck.run(unavailable.dependencies)).toBe(2)
    Expect(unavailable.calls).toEqual(['acquire', 'lane-release', 'write'])
  })

  Test('rechecks admission after acquiring exclusivity', async () => {
    const fake = fixture()
    const acquire = fake.lane.acquireExclusive
    fake.lane.acquireExclusive = async () => {
      const lease = await acquire()
      fake.state.load = 8
      return lease
    }
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
    Expect(fake.calls).toEqual(['acquire', 'exclusive', 'exclusive-release', 'lane-release', 'write'])
  })

  Test('retains transient contamination and never labels a contaminated budget failure a regression', async () => {
    const fake = fixture()
    fake.state.language = async () => {
      fake.state.load = 8
      await fake.state.sample!()
      fake.state.load = 1
    }
    fake.state.languageExit = 1
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
    Expect(fake.calls).not.toContain('studio-start')
    Expect(fake.reports[0]?.observations.some(sample => sample.loadAverage === 8)).toBe(true)
    Expect(fake.reports[0]?.status).toBe('inconclusive')
    Expect(fake.reports[0]?.stages).toEqual([{ name: 'language', exitCode: 1 }])
  })

  Test('allows queued peers but rejects active peers and lost owner registration', async () => {
    const queued = fixture()
    queued.state.language = async () => {
      queued.state.peerPresent = true
    }
    Expect(await PerformanceCheck.run(queued.dependencies)).toBe(0)
    for (const change of [{ peerPresent: true, peerSlots: 1 }, { missingOwner: true }, { available: false }]) {
      const fake = fixture()
      fake.state.language = async () => {
        Object.assign(fake.state, change)
      }
      Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
      Expect(fake.calls).not.toContain('studio-start')
    }
  })

  Test('waits for pending activity sampling before releasing either lease', async () => {
    const fake = fixture()
    const stopped = Deferred()
    fake.state.stop = async () => await stopped.promise
    const result = PerformanceCheck.run(fake.dependencies)
    await until(() => fake.calls.includes('monitor-stop'))
    Expect(fake.calls).not.toContain('exclusive-release')
    Expect(fake.calls).not.toContain('lane-release')
    Expect(fake.reports).toEqual([])
    stopped.resolve()
    Expect(await result).toBe(0)
    Expect(fake.calls.slice(-3)).toEqual(['exclusive-release', 'lane-release', 'write'])
  })

  Test('releases leases after thrown measurements and preserves cleanup failures', async () => {
    const fake = fixture()
    fake.state.language = async () => {
      Errors.throwHostEnvironment('fixture measurement failed')
    }
    fake.lane.acquireExclusive = async () => ({
      release: async () => {
        fake.calls.push('exclusive-release')
        Errors.throwHostEnvironment('fixture release failed')
      },
    })
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
    Expect(fake.calls.slice(-4)).toEqual(['monitor-stop', 'exclusive-release', 'lane-release', 'write'])
    Expect(fake.reports[0]?.reasons).toHaveLength(2)
  })

  Test('reports uncontaminated child failures after running both timing stages', async () => {
    const fake = fixture()
    fake.state.languageExit = 1
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(1)
    Expect(fake.calls).toContain('studio-end')
    Expect(fake.reports[0]?.status).toBe('failed')
    Expect(fake.reports[0]?.reasons).toEqual([])
  })

  Test('requires artifact qualification even after a successful Studio child', async () => {
    const fake = fixture()
    fake.dependencies.qualifyStudio = async () => {
      Errors.throwHostEnvironment('fixture missing preview reports')
    }
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(2)
    Expect(fake.calls).toContain('studio-end')
    Expect(fake.calls.slice(-4)).toEqual(['monitor-stop', 'exclusive-release', 'lane-release', 'write'])
    Expect(fake.reports[0]?.status).toBe('inconclusive')
    Expect(fake.reports[0]?.reasons[0]).toContain('fixture missing preview reports')
  })

  Test('fails when complete preview evidence exceeds its calibrated ceilings', async () => {
    const fake = fixture()
    fake.dependencies.qualifyStudio = async () => 1
    Expect(await PerformanceCheck.run(fake.dependencies)).toBe(1)
    Expect(fake.reports[0]?.stages).toEqual([
      { name: 'language', exitCode: 0 },
      { name: 'studio-preview', exitCode: 1 },
    ])
  })

  Test('blocks a real peer reservation until the performance lease releases', async () => {
    const registryRoot = await mkTestDir('performance-exclusive')
    const fake = fixture()
    fake.dependencies.inspect = async () => await MachineLanes.inspectLanes(registryRoot)
    fake.dependencies.acquire = async () =>
      await MachineLanes.acquire({
        lane: 'performance-check',
        repositoryRoot: '/performance',
        registryRoot,
        cpuCount: 8,
        loadAverage: () => 1,
      })
    const language = Deferred()
    fake.state.language = async () => await language.promise
    const result = PerformanceCheck.run(fake.dependencies)
    await until(() => fake.calls.includes('language-start'))
    const peer = await MachineLanes.acquire({
      lane: 'peer',
      repositoryRoot: '/peer',
      registryRoot,
      cpuCount: 8,
      loadAverage: () => 1,
    })
    try {
      Expect(await peer.tryAcquire(1, false)).toBeUndefined()
      language.resolve()
      Expect(await result).toBe(0)
      const reservation = await peer.tryAcquire(1, false)
      Expect(reservation).toBeDefined()
      await reservation?.release()
      Expect((await MachineLanes.activeLanes(registryRoot)).map(lane => lane.lane)).toEqual(['peer'])
    } finally {
      language.resolve()
      await result
      await peer.release()
    }
  })
})
