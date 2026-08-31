import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  isManifest,
  isSameProcess,
  launchDirectory,
  openLaunchRecord,
  type OwnershipProbes,
  type ProcessFact,
  readLaunches,
  removeLaunch,
  type StudioLaunchManifest,
  validateLaunch,
  writeManifestAtomically,
} from '../dev-src/studio/StudioLaunchManifest'
import {
  formatStopReport,
  listLaunches,
  stopExitCode,
  stopLaunches,
} from '../dev-src/studio/StudioLifecycle'

type ProbeState = {
  listeners: Record<number, readonly number[]>
  missingPaths: readonly string[]
  processes: Record<number, ProcessFact>
}

function probes(state: Partial<ProbeState> = {}): OwnershipProbes {
  const listeners = state.listeners ?? {}
  const processes = state.processes ?? {}
  const missingPaths = state.missingPaths ?? []
  return {
    listenerPidsOnPort: async port => listeners[port] ?? [],
    pathExists: async path => !missingPaths.includes(path),
    processFact: async pid => processes[pid] ?? { pid, running: false },
  }
}

function alive(pid: number, command: string, startedAt = 'Mon Jan  1 00:00:00 2026'): ProcessFact {
  return { command, pid, running: true, startedAt }
}

async function publish(
  repositoryRoot: string,
  overrides: Partial<StudioLaunchManifest> = {},
): Promise<StudioLaunchManifest> {
  const manifest: StudioLaunchManifest = {
    artifactRoot: FS.resolvePath('.artifacts/user/studio', repositoryRoot),
    generation: 1,
    launchId: 'browser-fixture',
    mode: 'browser',
    ownerPid: 100,
    processes: [{ command: 'bun', pid: 100, role: 'studio-server', startedAt: 'Mon Jan  1 00:00:00 2026' }],
    repositoryRoot,
    startedAt: '2026-01-01T00:00:00.000Z',
    state: 'ready',
    studioPort: 42100,
    version: 1,
    ...overrides,
  }
  await writeManifestAtomically(
    FS.resolvePath(`${manifest.launchId}.json`, launchDirectory(repositoryRoot)),
    manifest,
  )
  return manifest
}

Describe('Studio launch manifests', () => {
  Test('publishes a manifest before anything is known and advances its generation', async () => {
    const root = await mkTestDir('tao-studio-launch-')
    try {
      const record = await openLaunchRecord({
        artifactRoot: FS.resolvePath('.artifacts/user/studio', root),
        mode: 'browser',
        ownerPid: 4242,
        projectRoot: FS.resolvePath('Apps/HNReader', root),
        repositoryRoot: root,
      })

      Expect(record.snapshot().state).toBe('starting')
      Expect(record.snapshot().generation).toBe(1)
      Expect(await FS.isFile(record.path)).toBe(true)

      const ready = await record.update({ state: 'ready', studioPort: 42100, studioUrl: 'http://127.0.0.1:42100' })
      Expect(ready.generation).toBe(2)

      const [stored] = await readLaunches(root)
      Expect(stored?.manifest.studioUrl).toBe('http://127.0.0.1:42100')
      Expect(stored?.supported).toBe(true)

      const finalized = await record.finalize({ shutdownReason: 'user requested' })
      Expect(finalized.state).toBe('stopped')
      Expect(finalized.shutdownReason).toBe('user requested')
    } finally {
      await FS.remove(root)
    }
  })

  Test('never leaves a partially written manifest for a reader to find', async () => {
    const root = await mkTestDir('tao-studio-launch-atomic-')
    try {
      const record = await openLaunchRecord({
        artifactRoot: FS.resolvePath('.artifacts', root),
        mode: 'browser',
        repositoryRoot: root,
      })
      await Promise.all(
        Array.from({ length: 20 }, (_, index) => record.update({ studioPort: 42100 + index })),
      )

      const [stored] = await readLaunches(root)
      Expect(stored).toBeDefined()
      Expect(isManifest(await FS.readJson(record.path))).toBe(true)
      Expect(await FS.listDir(launchDirectory(root))).toEqual([`${record.launchId}.json`])
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps concurrent launches in the same repository separate', async () => {
    const root = await mkTestDir('tao-studio-launch-concurrent-')
    try {
      const [first, second] = await Promise.all([
        openLaunchRecord({ artifactRoot: root, mode: 'browser', ownerPid: 11, repositoryRoot: root }),
        openLaunchRecord({ artifactRoot: root, mode: 'native', ownerPid: 22, repositoryRoot: root }),
      ])
      await first.update({ processes: [{ command: 'bun', pid: 11, role: 'studio-server' }], studioPort: 42100 })
      await second.update({ processes: [{ command: 'hutch', pid: 22, role: 'native-shell' }], studioPort: 42200 })

      const listing = await listLaunches({
        probes: probes({ processes: { 11: alive(11, 'bun') } }),
        repositoryRoot: root,
      })

      Expect(listing.launches.length).toBe(2)
      Expect(listing.launches.find(row => row.launchId === first.launchId)?.status).toBe('live')
      Expect(listing.launches.find(row => row.launchId === second.launchId)?.status).toBe('stale')
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps a launch visible on a host whose process table cannot be read', async () => {
    // Inside an agent sandbox `ps` is denied, so a fact carries liveness and no command. A launch
    // must still be listable and stoppable there, or every agent is blind to its own Studio.
    const recorded = { command: 'bun', pid: 100, role: 'studio-server' as const, startedAt: 'Mon Jan  1 00:00:00 2026' }

    Expect(isSameProcess(recorded, { pid: 100, running: true })).toBe(true)
    Expect(isSameProcess(recorded, { pid: 100, running: false })).toBe(false)
  })

  Test('disowns a recorded id that a different program now holds', async () => {
    const recorded = { command: 'bun', pid: 100, role: 'studio-server' as const, startedAt: 'Mon Jan  1 00:00:00 2026' }

    Expect(isSameProcess(recorded, alive(100, 'bun'))).toBe(true)
    Expect(isSameProcess(recorded, alive(100, 'Google Chrome'))).toBe(false)
    Expect(isSameProcess(recorded, alive(100, 'bun', 'Tue Feb  2 00:00:00 2026'))).toBe(false)
    Expect(isSameProcess(recorded, { pid: 100, running: false })).toBe(false)
  })

  Test('refuses a manifest whose schema version this build does not understand', async () => {
    const root = await mkTestDir('tao-studio-launch-version-')
    try {
      await publish(root, { version: 99 })
      const [stored] = await readLaunches(root)
      const validated = await validateLaunch(stored!, probes({ processes: { 100: alive(100, 'bun') } }))

      Expect(validated.unusableReason).toContain('schema version 99')
      Expect(validated.owned).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('ignores a malformed manifest instead of acting on it', async () => {
    const root = await mkTestDir('tao-studio-launch-malformed-')
    try {
      await FS.writeText(FS.resolvePath('broken.json', launchDirectory(root)), '{ not json')
      await FS.writeJson(FS.resolvePath('partial.json', launchDirectory(root)), { launchId: 'x', version: 1 })
      await publish(root)

      const launches = await readLaunches(root)
      Expect(launches.map(launch => launch.manifest.launchId)).toEqual(['browser-fixture'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses a manifest whose artifact root escapes its repository', async () => {
    const root = await mkTestDir('tao-studio-launch-escape-')
    try {
      await publish(root, { artifactRoot: '/tmp/elsewhere' })
      const [stored] = await readLaunches(root)
      const validated = await validateLaunch(stored!, probes({ processes: { 100: alive(100, 'bun') } }))

      Expect(validated.unusableReason).toContain('outside')
      Expect(validated.owned).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports a port whose listener the launch does not own as foreign', async () => {
    const root = await mkTestDir('tao-studio-launch-port-')
    try {
      await publish(root)
      const listing = await listLaunches({
        probes: probes({ listeners: { 42100: [999] }, processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
      })

      Expect(listing.launches[0]?.ports.foreign).toEqual([42100])
      Expect(listing.launches[0]?.ports.owned).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('removes only a manifest inside its own launch directory', async () => {
    const root = await mkTestDir('tao-studio-launch-remove-')
    try {
      const outside = FS.resolvePath('keep.json', root)
      await publish(root)
      const [stored] = await readLaunches(root)
      await FS.writeJson(outside, { keep: true })

      Expect(await removeLaunch({ ...stored!, path: outside })).toBe(false)
      Expect(await FS.isFile(outside)).toBe(true)
      Expect(await removeLaunch(stored!)).toBe(true)
      Expect(await readLaunches(root)).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })
})

Describe('Studio lifecycle commands', () => {
  Test('stops the processes a launch owns and escalates only to survivors', async () => {
    const root = await mkTestDir('tao-studio-stop-')
    try {
      await publish(root, {
        processes: [
          { command: 'bun', pid: 100, role: 'studio-server', startedAt: 'Mon Jan  1 00:00:00 2026' },
          { command: 'node', pid: 101, role: 'metro', startedAt: 'Mon Jan  1 00:00:00 2026' },
        ],
      })
      const signals: { pids: readonly number[]; signal: string }[] = []
      const processes: Record<number, ProcessFact> = {
        100: alive(100, 'bun'),
        101: alive(101, 'node'),
      }
      const report = await stopLaunches({
        probes: probes({ listeners: { 42100: [100] }, processes }),
        repositoryRoot: root,
        signal: async (signal, pids) => {
          signals.push({ pids, signal })
          if (signal === 'SIGTERM') {
            processes[100] = { pid: 100, running: false }
          }
        },
        sleep: async () => {},
      })

      Expect(signals[0]).toEqual({ pids: [100, 101], signal: 'SIGTERM' })
      Expect(signals[1]).toEqual({ pids: [101], signal: 'SIGKILL' })
      Expect(report.outcomes[0]?.outcome).toBe('stopped')
      Expect(report.outcomes[0]?.cleanup.releasedPorts).toEqual([42100])
      Expect(report.outcomes[0]?.manifestRemoved).toBe(true)
      Expect(await readLaunches(root)).toEqual([])
      Expect(stopExitCode(report)).toBe(0)
    } finally {
      await FS.remove(root)
    }
  })

  Test('never signals when nothing is owned, and still succeeds', async () => {
    const root = await mkTestDir('tao-studio-stop-empty-')
    try {
      await publish(root)
      let signalled = false
      const report = await stopLaunches({
        probes: probes(),
        repositoryRoot: root,
        signal: async () => {
          signalled = true
        },
      })

      Expect(signalled).toBe(false)
      Expect(report.outcomes[0]?.outcome).toBe('already-stopped')
      Expect(report.outcomes[0]?.cleanup.signaledPids).toEqual([])
      Expect(stopExitCode(report)).toBe(0)
    } finally {
      await FS.remove(root)
    }
  })

  Test('is idempotent: a second stop finds nothing left to do', async () => {
    const root = await mkTestDir('tao-studio-stop-idempotent-')
    try {
      await publish(root)
      const dependencies = {
        probes: probes({ processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
        signal: async () => {},
        sleep: async () => {},
      }
      const first = await stopLaunches(dependencies)
      const second = await stopLaunches(dependencies)

      Expect(first.outcomes[0]?.outcome).toBe('stopped')
      Expect(second.outcomes).toEqual([])
      Expect(stopExitCode(second)).toBe(0)
    } finally {
      await FS.remove(root)
    }
  })

  Test('never signals a reused process id', async () => {
    const root = await mkTestDir('tao-studio-stop-reuse-')
    try {
      await publish(root)
      const signals: number[][] = []
      const report = await stopLaunches({
        // The recorded id is alive, but it is Chrome now, not the Studio server it was.
        probes: probes({ processes: { 100: alive(100, 'Google Chrome') } }),
        repositoryRoot: root,
        signal: async (_signal, pids) => {
          signals.push([...pids])
        },
      })

      Expect(signals).toEqual([])
      Expect(report.outcomes[0]?.outcome).toBe('already-stopped')
      Expect(report.outcomes[0]?.reason).toContain('no longer this launch')
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses an unusable manifest rather than guessing', async () => {
    const root = await mkTestDir('tao-studio-stop-refuse-')
    try {
      await publish(root, { version: 99 })
      const report = await stopLaunches({
        probes: probes({ processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
        signal: async () => {
          throw new Error('must not signal an unusable manifest')
        },
      })

      Expect(report.outcomes[0]?.outcome).toBe('refused')
      Expect(stopExitCode(report)).toBe(1)
      Expect(formatStopReport(report)).toContain('refused')
    } finally {
      await FS.remove(root)
    }
  })

  Test('requires --all before stopping more than one launch', async () => {
    const root = await mkTestDir('tao-studio-stop-many-')
    try {
      await publish(root, { launchId: 'browser-one' })
      await publish(root, { launchId: 'browser-two', startedAt: '2026-01-02T00:00:00.000Z' })

      let thrown: unknown
      try {
        await stopLaunches({ probes: probes(), repositoryRoot: root })
      } catch (error) {
        thrown = error
      }
      Expect((thrown as Error).message).toContain('--all')

      const all = await stopLaunches({ all: true, probes: probes(), repositoryRoot: root })
      Expect(all.outcomes.map(outcome => outcome.launchId).toSorted()).toEqual(['browser-one', 'browser-two'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('leaves other launches alone when one is selected', async () => {
    const root = await mkTestDir('tao-studio-stop-selected-')
    try {
      await publish(root, { launchId: 'browser-one' })
      await publish(root, { launchId: 'browser-two', startedAt: '2026-01-02T00:00:00.000Z' })

      const report = await stopLaunches({
        launchId: 'browser-two',
        probes: probes({ processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
        signal: async () => {},
        sleep: async () => {},
      })

      Expect(report.outcomes.map(outcome => outcome.launchId)).toEqual(['browser-two'])
      Expect((await readLaunches(root)).map(launch => launch.manifest.launchId)).toEqual(['browser-one'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports a partial startup as a launch that owns nothing yet', async () => {
    const root = await mkTestDir('tao-studio-partial-')
    try {
      const record = await openLaunchRecord({ artifactRoot: root, mode: 'browser', repositoryRoot: root })
      await record.update({ shutdownReason: 'Metro never became ready', state: 'failed' })

      const listing = await listLaunches({ probes: probes(), repositoryRoot: root })
      Expect(listing.launches[0]?.state).toBe('failed')
      Expect(listing.launches[0]?.status).toBe('stale')
      Expect(listing.launches[0]?.ownedPids).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })
})
