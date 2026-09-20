import { Describe, Expect, Test } from '@shared/test'
import {
  createHostSessionOrchestrator,
  type HostSessionLeaseManager,
} from '../host-control-src/session/HostSessionOrchestrator'
import { HostControlError } from '../host-control-src/HostControl'

function leaseManager(): Readonly<{ held: Set<string>; manager: HostSessionLeaseManager }> {
  const held = new Set<string>()
  return {
    held,
    manager: {
      acquire: async name => {
        if (held.has(name)) {
          throw new HostControlError('busy', `Host target '${name}' is already leased.`)
        }
        held.add(name)
        let released = false
        return {
          generation: `generation-${name}`,
          release: async () => {
            if (!released) {
              held.delete(name)
              released = true
            }
          },
        }
      },
    },
  }
}

function orchestrator(
  ids: readonly string[],
  leases: HostSessionLeaseManager,
  overrides: Partial<Readonly<{ runId: string; worktreeId: string }>> = {},
) {
  let index = 0
  return createHostSessionOrchestrator({
    artifactRoot: '/artifacts/host-sessions',
    command: 'test-host',
    leases,
    randomId: () => ids[index++] ?? ids[ids.length - 1]!,
    repositoryRoot: '/worktrees/current',
    runId: overrides.runId ?? 'run-1',
    worktreeId: overrides.worktreeId ?? 'worktree-a',
  })
}

const revision = { build: 'build-123', source: 'source-456' } as const

Describe('host session orchestration', () => {
  Test('allocates concurrent browser and Studio sessions without sharing identities or leases', async () => {
    const leases = leaseManager()
    const sessions = await Promise.all([
      orchestrator(['same'], leases.manager).open({
        app: 'hnreader',
        mode: 'development',
        revision,
        target: { kind: 'browserContext' },
      }),
      orchestrator(['same'], leases.manager, { runId: 'run-2', worktreeId: 'worktree-b' }).open({
        app: 'hnreader',
        mode: 'development',
        revision,
        target: { id: 'preview-1', kind: 'studioSemanticSession' },
      }),
    ])
    try {
      const [browser, studio] = sessions
      Expect(browser.allocation.identity.id).not.toBe(studio.allocation.identity.id)
      Expect(browser.allocation.identity.artifactRoot).not.toBe(studio.allocation.identity.artifactRoot)
      Expect(browser.allocation.identity.appId).not.toBe(studio.allocation.identity.appId)
      Expect(browser.allocation.identity.driverPortNamespace).not.toBe(studio.allocation.identity.driverPortNamespace)
      Expect(browser.allocation.cleanup.leases.map(lease => lease.name)).toEqual([
        'browser-context:session-worktree-a-run-1-same',
      ])
      Expect(studio.allocation.cleanup.leases.map(lease => lease.name)).toEqual(['studio-semantic-session:preview-1'])
      Expect([...leases.held].toSorted()).toEqual([
        'browser-context:session-worktree-a-run-1-same',
        'studio-semantic-session:preview-1',
      ])
    } finally {
      await Promise.all(sessions.map(async session => await session.close()))
    }
    Expect([...leases.held]).toEqual([])
  })

  Test('fences the same simulator and global physical macOS input while allowing distinct targets', async () => {
    const leases = leaseManager()
    const sessions = orchestrator(['ios-1', 'ios-2', 'android-1', 'ios-3'], leases.manager)
    const simulator = await sessions.open({
      app: 'clockwork',
      mode: 'development',
      revision,
      target: { id: 'simulator-udid', kind: 'iosSimulator' },
    })
    try {
      await Expect(sessions.open({
        app: 'clockwork',
        mode: 'development',
        revision,
        target: { id: 'simulator-udid', kind: 'iosSimulator' },
      })).rejects.toMatchObject({ code: 'busy' })
      const android = await sessions.open({
        app: 'clockwork',
        mode: 'development',
        revision,
        target: { id: 'emulator-5554', kind: 'androidEmulator' },
      })
      const physical = await sessions.open({
        app: 'clockwork',
        mode: 'acceptance',
        needsPhysicalMacOSInput: true,
        revision,
        target: { id: 'simulator-udid-2', kind: 'iosSimulator' },
      })
      try {
        Expect(physical.allocation.cleanup.leases.map(lease => lease.name)).toEqual([
          'macos-physical-input',
          'ios-simulator:simulator-udid-2',
        ])
        await Expect(sessions.open({
          app: 'clockwork',
          mode: 'acceptance',
          needsPhysicalMacOSInput: true,
          revision,
          target: { id: 'emulator-5556', kind: 'androidEmulator' },
        })).rejects.toMatchObject({ code: 'busy' })
      } finally {
        await Promise.all([android.close(), physical.close()])
      }
    } finally {
      await simulator.close()
    }
  })

  Test('disambiguates repeated allocator IDs and makes acceptance state immutable while development retains state', async () => {
    const leases = leaseManager()
    const sessions = orchestrator(['collision', 'collision'], leases.manager)
    const [development, acceptance] = await Promise.all([
      sessions.open({
        app: 'hnreader',
        mode: 'development',
        revision,
        target: { kind: 'browserContext' },
      }),
      sessions.open({
        app: 'hnreader',
        mode: 'acceptance',
        revision,
        target: { kind: 'browserContext' },
      }),
    ])
    try {
      Expect(development.allocation.identity.id).toBe('session-worktree-a-run-1-collision')
      Expect(acceptance.allocation.identity.id).toBe('session-worktree-a-run-1-collision-2')
      Expect(development.allocation.state).toEqual({ initial: 'retained', retained: true })
      Expect(development.allocation.cleanup.applicationData.action).toBe('retain')
      Expect(acceptance.allocation.state).toEqual({ initial: 'fresh', retained: false })
      Expect(acceptance.allocation.cleanup.applicationData.action).toBe('remove')
      Expect(acceptance.allocation.identity.revision.immutable).toBe(true)
      Expect(Object.isFrozen(acceptance.allocation.identity.revision)).toBe(true)
      Expect(Object.isFrozen(acceptance.allocation.cleanup)).toBe(true)
    } finally {
      await Promise.all([development.close(), acceptance.close()])
    }
  })

  Test('keeps long underscore scopes in deterministic platform-safe application identities', async () => {
    const leases = leaseManager()
    const longWorktree = `worktree_${'x'.repeat(240)}`
    const longRun = `run_${'y'.repeat(240)}`
    const first = await orchestrator(['session_token'], leases.manager, {
      runId: longRun,
      worktreeId: longWorktree,
    }).open({
      app: 'clockwork_app',
      mode: 'acceptance',
      revision,
      target: { kind: 'browserContext' },
    })
    const firstAppId = first.allocation.identity.appId
    try {
      Expect(firstAppId).toMatch(/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/)
      Expect(firstAppId.length).toBeLessThanOrEqual(100)
      Expect(firstAppId).not.toContain('_')
      const isolated = await orchestrator(['session_token'], leases.manager, {
        runId: `${longRun}_other`,
        worktreeId: longWorktree,
      }).open({
        app: 'clockwork_app',
        mode: 'acceptance',
        revision,
        target: { kind: 'browserContext' },
      })
      try {
        Expect(isolated.allocation.identity.appId).not.toBe(firstAppId)
      } finally {
        await isolated.close()
      }
    } finally {
      await first.close()
    }
    const repeated = await orchestrator(['session_token'], leases.manager, {
      runId: longRun,
      worktreeId: longWorktree,
    }).open({
      app: 'clockwork_app',
      mode: 'acceptance',
      revision,
      target: { kind: 'browserContext' },
    })
    try {
      Expect(repeated.allocation.identity.appId).toBe(firstAppId)
    } finally {
      await repeated.close()
    }
  })
})
