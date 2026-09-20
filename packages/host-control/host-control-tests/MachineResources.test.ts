import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  MachineResourceBusyError,
  MachineResourceFenceError,
  type MachineResourceOwner,
  MachineResources,
  type ProcessIdentity,
} from '../host-control-src/host-control'

const resourceName = 'browser-session-1'

function resourcePath(root: string): string {
  return FS.resolvePath(`resource-${resourceName}.lease`, root)
}

async function writeOwner(
  root: string,
  overrides: Partial<MachineResourceOwner> = {},
): Promise<MachineResourceOwner> {
  const owner: MachineResourceOwner = {
    command: 'develop-browser',
    id: 'foreign-generation',
    name: resourceName,
    pid: Platform.runtimeProcess.pid,
    processStartedAt: 'same-process-start',
    repositoryRoot: '/worktrees/foreign-session',
    startedAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  }
  await FS.mkdir(root)
  await FS.writeJson(resourcePath(root), owner)
  return owner
}

const aliveIdentity = (startedAt: string) => async (): Promise<ProcessIdentity> => ({
  evidence: 'alive',
  startedAt,
})

Describe('machine resource leases', () => {
  Test('protects the exact live owner regardless of lease age', async () => {
    const root = await mkTestDir('tao-host-control-live-owner-')
    try {
      await writeOwner(root)

      await Expect(MachineResources.acquire({
        command: 'acceptance-browser',
        maxAgeMs: 0,
        name: resourceName,
        processIdentity: aliveIdentity('same-process-start'),
        registryRoot: root,
        repositoryRoot: '/worktrees/acceptance',
        waitTimeoutMs: 0,
      })).rejects.toBeInstanceOf(MachineResourceBusyError)
      Expect((await FS.readJson<MachineResourceOwner>(resourcePath(root))).id).toBe('foreign-generation')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reclaims a dead owner and a recycled PID with a different process start', async () => {
    const root = await mkTestDir('tao-host-control-stale-owner-')
    try {
      await writeOwner(root, { pid: 2 ** 30 })
      const afterDeath = await MachineResources.acquire({
        command: 'after-death',
        name: resourceName,
        processIdentity: async pid =>
          pid === 2 ** 30
            ? { evidence: 'gone' }
            : { evidence: 'alive', startedAt: 'new-owner' },
        registryRoot: root,
        repositoryRoot: '/worktrees/current',
        waitTimeoutMs: 0,
      })
      Expect(afterDeath.owner.command).toBe('after-death')
      await afterDeath.release()

      await writeOwner(root, { processStartedAt: 'old-process' })
      const afterReuse = await MachineResources.acquire({
        command: 'after-reuse',
        name: resourceName,
        processIdentity: aliveIdentity('new-process'),
        registryRoot: root,
        repositoryRoot: '/worktrees/current',
        waitTimeoutMs: 0,
      })
      Expect(afterReuse.owner.command).toBe('after-reuse')
      await afterReuse.release()
    } finally {
      await FS.remove(root)
    }
  })

  Test('treats uncertain process identity as a live owner', async () => {
    const root = await mkTestDir('tao-host-control-unknown-owner-')
    try {
      await writeOwner(root)

      await Expect(MachineResources.acquire({
        command: 'uncertain-contender',
        name: resourceName,
        processIdentity: async () => ({ evidence: 'unknown' }),
        registryRoot: root,
        repositoryRoot: '/worktrees/current',
        waitTimeoutMs: 0,
      })).rejects.toBeInstanceOf(MachineResourceBusyError)
    } finally {
      await FS.remove(root)
    }
  })

  Test('fences stale mutations and stale release cannot remove a newer owner', async () => {
    const root = await mkTestDir('tao-host-control-fence-')
    try {
      const lease = await MachineResources.acquire({
        command: 'first',
        name: resourceName,
        processIdentity: aliveIdentity('first-process'),
        registryRoot: root,
        repositoryRoot: '/worktrees/first',
        waitTimeoutMs: 0,
      })
      await lease.assertCurrent(lease.generation)
      await Expect(lease.assertCurrent('wrong-generation')).rejects.toBeInstanceOf(MachineResourceFenceError)

      const replacement = await writeOwner(root, { command: 'replacement', id: 'replacement-generation' })
      await Expect(lease.assertCurrent(lease.generation)).rejects.toBeInstanceOf(MachineResourceFenceError)
      await lease.release()
      await lease.release()
      Expect(await FS.readJson<MachineResourceOwner>(resourcePath(root))).toEqual(replacement)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports the exact busy owner and an actionable diagnostic', async () => {
    const root = await mkTestDir('tao-host-control-busy-')
    try {
      const owner = await writeOwner(root)
      let failure: unknown
      try {
        await MachineResources.acquire({
          command: 'blocked',
          name: resourceName,
          processIdentity: aliveIdentity('same-process-start'),
          registryRoot: root,
          repositoryRoot: '/worktrees/blocked',
          waitTimeoutMs: 0,
        })
      } catch (error) {
        failure = error
      }

      Expect(failure).toBeInstanceOf(MachineResourceBusyError)
      Expect((failure as MachineResourceBusyError).owner).toEqual(owner)
      Expect((failure as Error).message).toContain('develop-browser')
      Expect((failure as Error).message).toContain('/worktrees/foreign-session')
      Expect((failure as Error).message).toContain(`PID ${Platform.runtimeProcess.pid}`)
    } finally {
      await FS.remove(root)
    }
  })
})
