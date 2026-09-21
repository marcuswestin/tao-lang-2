import { type CLI, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  MachineResourceBusyError,
  type MachineResourceLease,
  type MachineResourceOwner,
} from '@verification/MachineLanes'
import type { StoredLaunch, StudioLaunchManifest } from '../studio-tooling-src/StudioLaunchManifest'
import type { StopReport } from '../studio-tooling-src/StudioLifecycle'
import { StudioNative } from '../studio-tooling-src/StudioNative'

const holder: MachineResourceOwner = {
  command: 'studio-native',
  id: '46359-3fcaecc6',
  name: 'studio-native-host',
  pid: 46359,
  processStartedAt: 'Fri Sep  4 21:40:38 2026',
  repositoryRoot: '/worktrees/studio-visual-design',
  startedAt: '2026-09-05T01:40:40.292Z',
}

const lease = {
  owner: { ...holder, id: 'ours', pid: 1, repositoryRoot: '/worktrees/ours' },
  release: async () => {},
} as unknown as MachineResourceLease

type Attempt = {
  acquire: NonNullable<Parameters<typeof StudioNative.testing.acquireNativeHostLease>[1]>['acquire']
  waits: number[]
}

/** busyOnce refuses the first claim with the holder above and grants every later one. */
function busyOnce(): Attempt {
  const waits: number[] = []
  return {
    acquire: async options => {
      waits.push(options.waitTimeoutMs ?? -1)
      if (waits.length === 1) {
        throw new MachineResourceBusyError(holder)
      }
      return lease
    },
    waits,
  }
}

function launchRecord(overrides: Partial<StudioLaunchManifest> = {}): StoredLaunch {
  const manifest: StudioLaunchManifest = {
    artifactRoot: '/worktrees/studio-visual-design/.artifacts/user/studio-native',
    generation: 3,
    launchId: 'launch-visual-design',
    mode: 'native',
    ownerPid: holder.pid,
    processes: [{ command: 'bun', pid: holder.pid, role: 'studio-server' }],
    repositoryRoot: holder.repositoryRoot,
    startedAt: holder.startedAt,
    state: 'ready',
    version: 1,
    ...overrides,
  }
  return {
    manifest,
    path: `${holder.repositoryRoot}/.artifacts/user/studio/launches/${manifest.launchId}.json`,
    supported: true,
  }
}

function stopped(launchId: string): StopReport {
  return {
    outcomes: [{
      cleanup: { killedPids: [], releasedPorts: [59501], signaledPids: [holder.pid] },
      launchId,
      manifestRemoved: true,
      outcome: 'stopped',
    }],
    version: 1,
  }
}

Describe('native host takeover', () => {
  Test('asks before stopping the holder, then retries with a wait once it is told to go', async () => {
    const attempt = busyOnce()
    const questions: string[] = []
    const stoppedOwners: MachineResourceOwner[] = []
    const log: string[] = []

    const acquired = await StudioNative.testing.acquireNativeHostLease('studio-native', {
      acquire: attempt.acquire,
      askConfirm: async message => {
        questions.push(message)
        return true
      },
      isInteractive: () => true,
      log: message => log.push(message),
      stopOwner: async owner => {
        stoppedOwners.push(owner)
        return `stopped PID ${owner.pid}`
      },
    })

    Expect(acquired).toBe(lease)
    Expect(questions).toEqual(['Stop that session and take the native host?'])
    Expect(stoppedOwners).toEqual([holder])
    Expect(attempt.waits).toEqual([0, 10_000])
    Expect(log[0]).toBe(
      'native host is held by studio-native in /worktrees/studio-visual-design (PID 46359), since 2026-09-05T01:40:40.292Z',
    )
    Expect(log[1]).toBe('stopped PID 46359')
  })

  Test('keeps the busy error and touches nothing when the person declines', async () => {
    const attempt = busyOnce()
    let stops = 0

    await Expect(StudioNative.testing.acquireNativeHostLease('studio-native', {
      acquire: attempt.acquire,
      askConfirm: async () => false,
      isInteractive: () => true,
      log: () => {},
      stopOwner: async () => {
        stops += 1
        return ''
      },
    })).rejects.toThrow(
      "Machine resource 'studio-native-host' is busy: studio-native in /worktrees/studio-visual-design (PID 46359)",
    )
    Expect(stops).toBe(0)
    Expect(attempt.waits).toEqual([0])
  })

  Test('never prompts or stops anything without a terminal to answer from', async () => {
    const attempt = busyOnce()
    let prompts = 0

    await Expect(StudioNative.testing.acquireNativeHostLease('studio-native', {
      acquire: attempt.acquire,
      askConfirm: async () => {
        prompts += 1
        return true
      },
      isInteractive: () => false,
      log: () => {},
      stopOwner: async () => '',
    })).rejects.toBeInstanceOf(MachineResourceBusyError)
    Expect(prompts).toBe(0)
    Expect(attempt.waits).toEqual([0])
  })

  Test('takes a free host without asking', async () => {
    let prompts = 0
    const acquired = await StudioNative.testing.acquireNativeHostLease('studio-native', {
      acquire: async () => lease,
      askConfirm: async () => {
        prompts += 1
        return true
      },
      isInteractive: () => true,
      log: () => {},
    })

    Expect(acquired).toBe(lease)
    Expect(prompts).toBe(0)
  })

  Test('stops a holder through the Studio launch it recorded, in its own worktree', async () => {
    const stopRequests: unknown[] = []

    const message = await StudioNative.testing.stopNativeHostOwner(holder, {
      launches: async root => root === holder.repositoryRoot ? [launchRecord()] : [],
      runner: async () => Errors.throwUnexpected('Expected: no process signalled while a recorded launch is stopped.'),
      stop: async (options = {}) => {
        stopRequests.push(options)
        return stopped(options.launchId ?? '')
      },
    })

    Expect(stopRequests).toEqual([{ launchId: 'launch-visual-design', repositoryRoot: holder.repositoryRoot }])
    Expect(message).toContain('stopped studio-native launch launch-visual-design in /worktrees/studio-visual-design')
    Expect(message).toContain('sent SIGTERM to 46359')
  })

  Test('refuses to take the host when the recorded launch would not stop', async () => {
    await Expect(StudioNative.testing.stopNativeHostOwner(holder, {
      launches: async () => [launchRecord()],
      stop: async () => ({
        outcomes: [{
          cleanup: { killedPids: [], releasedPorts: [], signaledPids: [] },
          launchId: 'launch-visual-design',
          manifestRemoved: false,
          outcome: 'refused',
          reason: 'this host will not report on that process',
        }],
        version: 1,
      }),
    })).rejects.toThrow(
      'Could not stop the Studio launch holding the native host (launch-visual-design): this host will not report on that process',
    )
  })

  Test('signals a holder no launch recorded and escalates only while it lingers', async () => {
    const commands: string[][] = []
    let probes = 0
    const runner = async (command: string, spec: CLI.CommandSpec): Promise<CLI.CommandResult> => {
      const args = spec.args ?? []
      commands.push([command, ...args])
      if (args[0] === '-0') {
        probes += 1
        // Alive for the first two probes after SIGTERM, then gone.
        return { exitCode: probes > 2 ? 1 : 0, stderr: '', stdout: '' } as CLI.CommandResult
      }
      return { exitCode: 0, stderr: '', stdout: '' } as CLI.CommandResult
    }

    const message = await StudioNative.testing.stopNativeHostOwner(holder, {
      launches: async () => [launchRecord({ ownerPid: 1, processes: [] })],
      ownerIsLive: async () => true,
      runner,
      sleep: async () => {},
    })

    Expect(message).toBe('stopped studio-native (PID 46359) in /worktrees/studio-visual-design')
    Expect(commands[0]).toEqual(['/bin/kill', '-TERM', '46359'])
    Expect(commands.some(command => command[1] === '-KILL')).toBe(false)
    Expect(probes).toBe(3)
  })

  Test('signals nothing when the holder no longer runs under the PID its lease recorded', async () => {
    const message = await StudioNative.testing.stopNativeHostOwner(holder, {
      launches: async () => [],
      ownerIsLive: async () => false,
      runner: async () => Errors.throwUnexpected('Expected: no process signalled once the holder has ended.'),
    })

    Expect(message).toBe(
      'studio-native (PID 46359) in /worktrees/studio-visual-design had already ended; nothing to stop',
    )
  })
})
