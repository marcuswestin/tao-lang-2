import { Errors, FS, Platform, TaoHome } from '@shared'
import { Describe, Expect, mkTestDir, Test as RunnerTest, testOverrideSlot } from '@shared/test'
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
} from '../studio-tooling-src/StudioLaunchManifest'
import {
  formatStopReport,
  listLaunches,
  stopExitCode,
  stopLaunches,
} from '../studio-tooling-src/StudioLifecycle'

const taoHomeSlot = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env['TAO_HOME'],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env['TAO_HOME']
    } else {
      Platform.runtimeProcess.env['TAO_HOME'] = value
    }
  },
})
const homeTestState = globalThis as typeof globalThis & { __taoStudioHomeTestTail?: Promise<void> }

function Test(name: string, run: () => void | Promise<void>): void {
  RunnerTest(name, () => {
    const previous = homeTestState.__taoStudioHomeTestTail ?? Promise.resolve()
    const running = previous.then(async () => {
      const home = await mkTestDir('tao-studio-home-')
      const restore = taoHomeSlot.install(home)
      try {
        await run()
      } finally {
        restore()
        await FS.remove(home)
      }
    })
    homeTestState.__taoStudioHomeTestTail = running.then(() => {}, () => {})
    return running
  })
}

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
    processFact: async pid => processes[pid] ?? { evidence: 'gone', pid },
  }
}

function alive(pid: number, command: string, startedAt = 'Mon Jan  1 00:00:00 2026'): ProcessFact {
  return { command, evidence: 'alive', pid, startedAt }
}

/** A host that will not describe its process table: alive, with no identity to compare. */
function undetermined(pid: number): ProcessFact {
  return { evidence: 'unknown', pid }
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
  Test('moves legacy launches on listing and keeps other repositories out of the result', async () => {
    const firstRoot = await mkTestDir('tao-studio-legacy-first-')
    const secondRoot = await mkTestDir('tao-studio-legacy-second-')
    try {
      const legacyDirectory = FS.resolvePath('.artifacts/user/studio/launches', firstRoot)
      await writeManifestAtomically(FS.resolvePath('browser-fixture.json', legacyDirectory), {
        artifactRoot: FS.resolvePath('.artifacts/user/studio', firstRoot),
        generation: 1,
        launchId: 'browser-fixture',
        mode: 'browser',
        ownerPid: 100,
        processes: [],
        repositoryRoot: firstRoot,
        startedAt: '2026-01-01T00:00:00.000Z',
        state: 'ready',
        version: 1,
      })
      await publish(secondRoot, { launchId: 'browser-second', state: 'stopped' })

      Expect((await readLaunches(firstRoot)).map(stored => stored.manifest.launchId)).toEqual(['browser-fixture'])
      Expect(await FS.exists(FS.resolvePath('browser-fixture.json', legacyDirectory))).toBe(false)
      Expect(await FS.isFile(FS.resolvePath('browser-fixture.json', TaoHome.resolve('studio/launches')))).toBe(true)
      await openLaunchRecord({ artifactRoot: firstRoot, mode: 'browser', repositoryRoot: firstRoot })
      Expect((await readLaunches(secondRoot)).map(stored => stored.manifest.launchId)).toEqual(['browser-second'])
    } finally {
      await FS.remove(firstRoot)
      await FS.remove(secondRoot)
    }
  })

  Test('accepts Studio launch artifacts in home without trusting another home path', async () => {
    const root = await mkTestDir('tao-studio-native-home-')
    try {
      const artifactRoot = TaoHome.resolve('studio/launches/native/com.devtao.studio.fixture')
      await publish(root, { artifactRoot, mode: 'native' })
      const [stored] = await readLaunches(root)
      Expect((await validateLaunch(stored!, probes())).unusableReason).toBeUndefined()
      await publish(root, { artifactRoot: TaoHome.resolve('studio/launches/browser'), mode: 'browser' })
      const [browser] = await readLaunches(root)
      Expect((await validateLaunch(browser!, probes())).unusableReason).toBeUndefined()
      await publish(root, { artifactRoot: TaoHome.resolve('studio/logs'), mode: 'native' })
      const [outside] = await readLaunches(root)
      Expect((await validateLaunch(outside!, probes())).unusableReason).toContain('outside')
    } finally {
      await FS.remove(root)
    }
  })

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

  Test('matches a command the two hosts spell differently', async () => {
    // `ps -o comm=` gives an absolute path; a process describing itself falls back to a basename.
    // Comparing them literally disowns every launch recorded on one host and stopped from another.
    const recorded = { command: 'bun', pid: 100, role: 'studio-server' as const, startedAt: 'Mon Jan  1 00:00:00 2026' }

    Expect(isSameProcess(recorded, alive(100, '/opt/homebrew/bin/bun'))).toBe(true)
    Expect(isSameProcess(recorded, alive(100, '/opt/homebrew/bin/node'))).toBe(false)
  })

  Test('never owns a process on liveness alone', async () => {
    const recorded = { command: 'bun', pid: 100, role: 'studio-server' as const, startedAt: 'Mon Jan  1 00:00:00 2026' }

    // Alive, but the host said nothing about what it is. That is not identity.
    Expect(isSameProcess(recorded, { evidence: 'alive', pid: 100 })).toBe(false)
    Expect(isSameProcess(recorded, undetermined(100))).toBe(false)
    Expect(isSameProcess(recorded, { evidence: 'gone', pid: 100 })).toBe(false)
  })

  Test('owns an unidentifiable process only when it holds a port this launch recorded', async () => {
    const root = await mkTestDir('tao-studio-port-identity-')
    try {
      await publish(root)
      const listing = await listLaunches({
        // The process table says only "alive"; the recorded port says "and it is serving mine".
        probes: probes({ listeners: { 42100: [100] }, processes: { 100: { evidence: 'alive', pid: 100 } } }),
        repositoryRoot: root,
      })

      Expect(listing.launches[0]?.status).toBe('live')
      Expect(listing.launches[0]?.ownedPids).toEqual([100])
      Expect(listing.launches[0]?.ports.owned).toEqual([42100])
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses to stop, or to forget, what this host will not answer about', async () => {
    const root = await mkTestDir('tao-studio-undetermined-')
    try {
      await publish(root)
      let signalled = false
      const report = await stopLaunches({
        probes: probes({ processes: { 100: undetermined(100) } }),
        repositoryRoot: root,
        signal: async () => {
          signalled = true
        },
      })

      Expect(signalled).toBe(false)
      Expect(report.outcomes[0]?.outcome).toBe('refused')
      Expect(report.outcomes[0]?.reason).toContain('would not say whether 100')
      Expect(report.outcomes[0]?.manifestRemoved).toBe(false)
      // The record survives, because it is the only thing that knows what might still be running.
      Expect((await readLaunches(root)).length).toBe(1)
      Expect(stopExitCode(report)).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses to forget a launch whose recorded port is still held', async () => {
    const root = await mkTestDir('tao-studio-held-port-')
    try {
      await publish(root)
      const report = await stopLaunches({
        // The recorded pid is genuinely gone, but something is still serving the launch's port.
        probes: probes({ listeners: { 42100: [999] } }),
        repositoryRoot: root,
        signal: async () => {},
      })

      Expect(report.outcomes[0]?.outcome).toBe('refused')
      Expect(report.outcomes[0]?.reason).toContain('port 42100 is still held')
      Expect(report.outcomes[0]?.manifestRemoved).toBe(false)
      Expect((await readLaunches(root)).length).toBe(1)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports only the ports it observed become free', async () => {
    const root = await mkTestDir('tao-studio-released-ports-')
    try {
      await publish(root)
      const listeners: Record<number, readonly number[]> = { 42100: [100] }
      const report = await stopLaunches({
        probes: probes({ listeners, processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
        signal: async () => {
          // The process dies but something else takes the port straight away.
          listeners[42100] = [777]
        },
        sleep: async () => {},
      })

      Expect(report.outcomes[0]?.cleanup.signaledPids).toEqual([100])
      Expect(report.outcomes[0]?.cleanup.releasedPorts).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('disowns a recorded id that a different program now holds', async () => {
    const recorded = { command: 'bun', pid: 100, role: 'studio-server' as const, startedAt: 'Mon Jan  1 00:00:00 2026' }

    Expect(isSameProcess(recorded, alive(100, 'bun'))).toBe(true)
    Expect(isSameProcess(recorded, alive(100, 'Google Chrome'))).toBe(false)
    Expect(isSameProcess(recorded, alive(100, 'bun', 'Tue Feb  2 00:00:00 2026'))).toBe(false)
    Expect(isSameProcess(recorded, { evidence: 'gone' as const, pid: 100 })).toBe(false)
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
      const listeners: Record<number, readonly number[]> = { 42100: [100] }
      const report = await stopLaunches({
        probes: probes({ listeners, processes }),
        repositoryRoot: root,
        signal: async (signal, pids) => {
          signals.push({ pids, signal })
          // 100 stops on TERM and frees its port; 101 only stops when it is killed.
          if (signal === 'SIGTERM') {
            processes[100] = { evidence: 'gone' as const, pid: 100 }
            listeners[42100] = []
          } else {
            for (const pid of pids) {
              processes[pid] = { evidence: 'gone' as const, pid }
            }
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
      const processes: Record<number, ProcessFact> = { 100: alive(100, 'bun') }
      const dependencies = {
        probes: probes({ processes }),
        repositoryRoot: root,
        signal: async () => {
          processes[100] = { evidence: 'gone' as const, pid: 100 }
        },
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

  Test('never escalates to an id reused by another copy of the same program', async () => {
    const root = await mkTestDir('tao-studio-stop-reuse-window-')
    try {
      await publish(root)
      const signals: { pids: readonly number[]; signal: string }[] = []
      // The recorded process exits under SIGTERM and its id is immediately taken by another
      // `bun`. Only the start time separates them, so only the start time prevents the SIGKILL.
      const processes: Record<number, ProcessFact> = { 100: alive(100, 'bun') }
      const report = await stopLaunches({
        probes: probes({ processes }),
        repositoryRoot: root,
        signal: async (signal, pids) => {
          signals.push({ pids, signal })
          if (signal === 'SIGTERM') {
            processes[100] = alive(100, 'bun', 'Tue Feb  2 09:00:00 2026')
          }
        },
        sleep: async () => {},
      })

      Expect(signals.map(entry => entry.signal)).toEqual(['SIGTERM'])
      Expect(report.outcomes[0]?.outcome).toBe('stopped')
      Expect(report.outcomes[0]?.cleanup.killedPids).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps the manifest when a process survives SIGKILL, rather than claiming success', async () => {
    const root = await mkTestDir('tao-studio-stop-survivor-')
    try {
      await publish(root)
      const report = await stopLaunches({
        // Nothing this stop does changes the process: it ignores every signal.
        probes: probes({ processes: { 100: alive(100, 'bun') } }),
        repositoryRoot: root,
        signal: async () => {},
        sleep: async () => {},
      })

      Expect(report.outcomes[0]?.outcome).toBe('refused')
      Expect(report.outcomes[0]?.reason).toContain('still running after SIGKILL: 100')
      Expect(report.outcomes[0]?.manifestRemoved).toBe(false)
      Expect(stopExitCode(report)).toBe(1)
      // The record survives, because it is the only thing that still knows what is running.
      Expect((await readLaunches(root)).length).toBe(1)
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
          Errors.throwUnexpected('must not signal an unusable manifest')
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

      const processes: Record<number, ProcessFact> = { 100: alive(100, 'bun') }
      const report = await stopLaunches({
        launchId: 'browser-two',
        probes: probes({ processes }),
        repositoryRoot: root,
        signal: async () => {
          processes[100] = { evidence: 'gone' as const, pid: 100 }
        },
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
