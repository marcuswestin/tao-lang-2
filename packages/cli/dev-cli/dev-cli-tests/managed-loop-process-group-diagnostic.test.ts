import { CLI, Errors, Platform, ProcessTree, Repo, Time, type TrackedProcess } from '@shared'
import { Deferred, Expect, Test } from '@shared/test'
import {
  type ManagedLoopProcessGroupDiagnosticSourceOperations,
  runManagedLoopProcessGroupDiagnosticSourceRegression,
} from '../dev-cli-src/dev-loop/ManagedLoopProcessGroupDiagnostic'

Test('owned group diagnostic captures an actual child and proves its natural exit without signals', async () => {
  const probes: number[] = []
  let stderr = ''
  const receipt = await runManagedLoopProcessGroupDiagnosticSourceRegression(Platform.randomUUID(), {
    start: (command, spec) =>
      CLI.start(command, {
        ...spec,
        onOutput: (stream, chunk) => {
          if (stream === 'stderr') {
            stderr = (stderr + chunk.toString('utf8')).slice(0, 2048)
          }
          spec?.onOutput?.(stream, chunk)
        },
      }),
    identities: ProcessTree.identities,
    groupOf: ProcessTree.processGroupOf,
    members: ProcessTree.groupMembers,
    processIsAlive: Platform.processIsAlive,
    probe: group => {
      probes.push(group)
      return Platform.signalProcess(-group, 0)
    },
    now: Time.nowMs,
    sleep: Time.sleep,
  })
  Expect(stderr).toBe('')
  Expect(receipt.failures).toEqual([])
  Expect(receipt.evidenceKind).toBe('source regression')
  Expect(receipt.closureProved).toBe(true)
  Expect(receipt.naturalExitProved).toBe(true)
  Expect(receipt.acknowledged).toBe(true)
  Expect(receipt.outputClosed).toBe(true)
  Expect(receipt.disposed).toBe(true)
  Expect(receipt.aliveProbe).toEqual({ outcome: 'alive' })
  Expect(receipt.reapedProbe).toEqual({ outcome: 'absent' })
  Expect(receipt.fence).toBeDefined()
  Expect(probes).toEqual([receipt.fence!.group, receipt.fence!.group])
  Expect(receipt.fence!.process.pid).toBe(receipt.fence!.group)
  Expect(Platform.processIsAlive(receipt.fence!.process.pid)).toBe(false)
  Expect(ProcessTree.groupMembers(receipt.fence!.group)).toEqual([])
})

type Scenario =
  | 'normal'
  | 'denied-alive'
  | 'denied-reaped'
  | 'surviving-member'
  | 'mismatched-group'
  | 'escaped-member'
  | 'capture-failure'
  | 'reviving-member'
  | 'output-failure'
  | 'hanging-output'
  | 'surviving-root'
  | 'reused-root'
  | 'reused-after-probe'
  | 'reused-during-output'

function fixture(scenario: Scenario) {
  const owned: TrackedProcess = { pid: 536_870_901, startedAt: 'owned-kernel-start', command: 'owned child' }
  const foreign: TrackedProcess = { pid: 536_870_902, startedAt: 'foreign-kernel-start', command: 'foreign child' }
  const closed = Deferred<CLI.CommandCloseResult>()
  const events: string[] = []
  const probes: number[] = []
  let clock = 0
  let alive = true
  let exitAt = 30_000
  let revived = false
  let reused = false
  let disposed = false
  let outputClosed = false
  const ops: ManagedLoopProcessGroupDiagnosticSourceOperations = {
    now: () => clock,
    sleep: async ms => {
      clock += ms
      if (alive && clock >= exitAt) {
        alive = false
        events.push('natural exit')
        closed.resolve({ exitCode: 0, signal: null })
      }
    },
    start: (command, spec) => {
      Expect(command).toBe(Platform.runtimeProcess.execPath)
      Expect(spec?.detached).toBe(true)
      Expect(spec?.processPolicy).toBe('server')
      Expect(spec?.stdio).toEqual(['pipe', 'pipe', 'pipe'])
      Expect(spec?.timeoutMs).toBeUndefined()
      Expect(spec?.args).toEqual([
        Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/dev-loop/ManagedLoopProcessGroupDiagnosticChild.ts'),
      ])
      events.push('spawn')
      spec?.onOutput?.('stdout', Buffer.from('owned-group-ready\n'))
      return {
        command,
        args: [...spec?.args ?? []],
        pid: owned.pid,
        get exitCode() {
          return alive ? null : 0
        },
        signalCode: null,
        waitForClose: async () => await closed.promise,
        writeStdin: chunk => {
          Expect(chunk).toBe('finish\n')
          Expect(alive).toBe(true)
          events.push('acknowledgement')
          exitAt = clock + 1000
          return true
        },
        endStdin: () => events.push('stdin closed'),
        closeOutput: async () => {
          Expect(alive).toBe(false)
          outputClosed = true
          events.push('output closed')
          if (scenario === 'reused-during-output') {
            reused = true
          }
          if (scenario === 'output-failure') {
            Errors.throwHostEnvironment('Injected closed output failure')
          }
          if (scenario === 'hanging-output') {
            await Deferred<void>().promise
          }
        },
        dispose: () => {
          Expect(alive).toBe(false)
          disposed = true
          events.push('disposed')
        },
        kill: () => Errors.throwUnexpected('The diagnostic must never signal a child.'),
        onceClose: () => {},
        onceError: () => {},
      }
    },
    identities: pids => {
      Expect(pids).toEqual([owned.pid])
      events.push('kernel inspection')
      if (alive && scenario === 'capture-failure') {
        Errors.throwHostEnvironment('Injected kernel capture failure')
      }
      if (!alive && (scenario === 'reused-root' || reused)) {
        return new Map([[owned.pid, { ...owned, startedAt: 'replacement-kernel-start' }]])
      }
      return new Map(alive || scenario === 'surviving-root' ? [[owned.pid, owned]] : [])
    },
    groupOf: pid => {
      Expect(pid).toBe(owned.pid)
      events.push('group inspection')
      return scenario === 'mismatched-group' ? foreign.pid : owned.pid
    },
    members: group => {
      Expect(group).toBe(owned.pid)
      events.push('member inspection')
      if (alive) {
        return scenario === 'escaped-member' ? [owned, foreign] : [owned]
      }
      return scenario === 'surviving-member' || revived ? [foreign] : []
    },
    processIsAlive: pid => {
      Expect(pid).toBe(owned.pid)
      return alive || scenario === 'surviving-root'
    },
    probe: group => {
      Expect(group).toBe(owned.pid)
      probes.push(group)
      events.push(alive ? 'alive probe' : 'reaped probe')
      if ((alive && scenario === 'denied-alive') || (!alive && scenario === 'denied-reaped')) {
        Errors.throwHostEnvironment('Could not send 0 to the owned process group.', {
          cause: { name: 'SystemError', code: 'EPERM', errno: -1, syscall: 'kill', message: 'denied'.repeat(400) },
        })
      }
      if (!alive && scenario === 'reviving-member') {
        revived = true
      }
      if (!alive && scenario === 'reused-after-probe') {
        reused = true
      }
      return alive
    },
  }
  return { ops, events, probes, clock: () => clock, disposed: () => disposed, outputClosed: () => outputClosed }
}

for (
  const scenario of [
    'normal',
    'denied-alive',
    'denied-reaped',
    'surviving-member',
    'mismatched-group',
    'escaped-member',
    'capture-failure',
    'reviving-member',
    'output-failure',
    'hanging-output',
    'surviving-root',
    'reused-root',
    'reused-after-probe',
    'reused-during-output',
  ] as const
) {
  Test(`owned group diagnostic ${scenario} drains naturally and preserves refusal evidence`, async () => {
    const f = fixture(scenario)
    const unprovedRoot = scenario === 'surviving-root' || scenario.startsWith('reused-')
    const receipt = await runManagedLoopProcessGroupDiagnosticSourceRegression(Platform.randomUUID(), f.ops)
    Expect(receipt.evidenceKind).toBe('source regression')
    Expect(receipt.closureProved).toBe(scenario === 'normal')
    Expect(receipt.naturalExitProved).toBe(!unprovedRoot)
    Expect(receipt.acknowledged).toBe(true)
    Expect(receipt.disposed).toBe(!unprovedRoot)
    Expect(f.disposed()).toBe(!unprovedRoot)
    Expect(f.outputClosed()).toBe(!unprovedRoot || scenario === 'reused-during-output')
    Expect(f.events.indexOf('acknowledgement') < f.events.indexOf('natural exit')).toBe(true)
    if (!unprovedRoot) {
      Expect(f.events.indexOf('natural exit') < f.events.indexOf('disposed')).toBe(true)
    }
    if (scenario === 'normal') {
      Expect(receipt.failures).toEqual([])
      Expect(f.probes).toHaveLength(2)
      Expect(f.clock()).toBe(1200)
      Expect(f.events.indexOf('member inspection') < f.events.indexOf('alive probe')).toBe(true)
    } else {
      Expect(receipt.failures.length > 0).toBe(true)
    }
    if (scenario === 'denied-alive' || scenario === 'denied-reaped') {
      const observation = scenario === 'denied-alive' ? receipt.aliveProbe : receipt.reapedProbe
      Expect(observation?.outcome).toBe('inconclusive')
      Expect(observation?.causes?.[1]).toEqual({
        name: 'SystemError',
        code: 'EPERM',
        errno: -1,
        syscall: 'kill',
        message: 'denied'.repeat(400).slice(0, 1024),
      })
    }
    if (scenario === 'mismatched-group' || scenario === 'escaped-member' || scenario === 'capture-failure') {
      Expect(receipt.fence).toBeUndefined()
      Expect(f.probes).toEqual([])
      Expect(f.clock()).toBe(1200)
    }
    if (scenario === 'surviving-member') {
      Expect(receipt.reapedProbe).toBeUndefined()
      Expect(f.probes).toHaveLength(1)
      Expect(f.clock()).toBe(180_000)
    }
    if (scenario === 'reviving-member') {
      Expect(receipt.reapedProbe?.outcome).toBe('inconclusive')
    }
    if (scenario === 'output-failure' || scenario === 'hanging-output') {
      Expect(receipt.outputClosed).toBe(false)
      Expect(receipt.failures.at(-1)?.stage).toBe('output capture')
    }
    if (scenario === 'hanging-output' || scenario === 'surviving-root') {
      Expect(f.clock()).toBe(180_000)
    }
    if (scenario === 'surviving-root' || scenario === 'reused-root') {
      Expect(receipt.reapedProbe).toBeUndefined()
      Expect(f.probes).toHaveLength(1)
      Expect(receipt.failures.at(-1)?.stage).toBe('natural exit')
    }
    if (scenario === 'reused-root') {
      Expect(f.events.slice(f.events.indexOf('natural exit')).includes('member inspection')).toBe(false)
    }
    if (scenario === 'reused-after-probe' || scenario === 'reused-during-output') {
      Expect(f.probes).toHaveLength(2)
      Expect(receipt.failures.at(-1)?.stage).toBe(
        scenario === 'reused-after-probe' ? 'reaped group observation' : 'closed handle disposal',
      )
    }
  })
}
