import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import {
  MachineLanes,
  MachineResourceBusyError,
  type MachineResourceOwner,
  type ProcessIdentity,
} from '../dev-src/repository-tests/MachineLanes'

const resourceName = 'studio-native-host'

function resourcePath(registryRoot: string): string {
  return FS.resolvePath(`resource-${resourceName}.lease`, registryRoot)
}

async function writeOwner(
  registryRoot: string,
  overrides: Partial<MachineResourceOwner> = {},
): Promise<MachineResourceOwner> {
  const owner: MachineResourceOwner = {
    command: 'studio-native',
    id: 'foreign-owner',
    name: resourceName,
    pid: Platform.runtimeProcess.pid,
    repositoryRoot: '/worktrees/foreign-native-session',
    startedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
  await FS.mkdir(registryRoot)
  await FS.writeJson(resourcePath(registryRoot), owner)
  return owner
}

const aliveIdentity = (startedAt = 'Thu Sep  4 12:00:00 2026') => async (): Promise<ProcessIdentity> => ({
  evidence: 'alive',
  startedAt,
})

Describe('native host lease', () => {
  Test('records the owning PID, worktree, command, lease time, and process identity', async () => {
    const registryRoot = await mkTestDir('tao-native-host-record-')
    const processStartedAt = 'Thu Sep  4 12:00:00 2026'
    try {
      const lease = await MachineLanes.acquireResource({
        command: 'full-verify-native',
        name: resourceName,
        processIdentity: aliveIdentity(processStartedAt),
        registryRoot,
        repositoryRoot: '/worktrees/native-verification',
        waitTimeoutMs: 0,
      })
      const stored = await FS.readJson<MachineResourceOwner>(resourcePath(registryRoot))

      Expect(stored).toMatchObject({
        command: 'full-verify-native',
        name: resourceName,
        pid: Platform.runtimeProcess.pid,
        processStartedAt,
        repositoryRoot: '/worktrees/native-verification',
      })
      Expect(Number.isFinite(Date.parse(stored.startedAt))).toBe(true)
      Expect(lease.owner).toEqual(stored)
      await lease.release()
      Expect(await FS.exists(resourcePath(registryRoot))).toBe(false)
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('reports an actionable owner after a bounded wait without entering the second operation', async () => {
    const registryRoot = await mkTestDir('tao-native-host-busy-')
    let enteredPreparation = false
    try {
      const owner = await writeOwner(registryRoot, { processStartedAt: 'same-process' })
      let failure: unknown
      try {
        const lease = await MachineLanes.acquireResource({
          command: 'studio-canary',
          name: resourceName,
          processIdentity: aliveIdentity('same-process'),
          registryRoot,
          repositoryRoot: '/worktrees/canary',
          waitTimeoutMs: 5,
        })
        enteredPreparation = true
        await lease.release()
      } catch (error) {
        failure = error
      }

      Expect(enteredPreparation).toBe(false)
      Expect(failure).toBeInstanceOf(MachineResourceBusyError)
      Expect((failure as MachineResourceBusyError).failureKind).toBe('native-host-busy')
      Expect((failure as MachineResourceBusyError).owner).toEqual(owner)
      Expect((failure as Error).message).toContain('studio-native')
      Expect((failure as Error).message).toContain('/worktrees/foreign-native-session')
      Expect((failure as Error).message).toContain(`PID ${Platform.runtimeProcess.pid}`)
      Expect((failure as Error).message).toContain('finish or stop it')
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('prunes a lease only after the owner process is demonstrably gone', async () => {
    const registryRoot = await mkTestDir('tao-native-host-stale-')
    try {
      await writeOwner(registryRoot, { pid: 2 ** 30, processStartedAt: 'old-process' })
      const lease = await MachineLanes.acquireResource({
        command: 'studio-smoke-native',
        name: resourceName,
        processIdentity: async pid =>
          pid === 2 ** 30
            ? { evidence: 'gone' }
            : { evidence: 'alive', startedAt: 'new-process' },
        registryRoot,
        repositoryRoot: '/worktrees/smoke',
        waitTimeoutMs: 0,
      })

      Expect(lease.owner.command).toBe('studio-smoke-native')
      Expect((await FS.readJson<MachineResourceOwner>(resourcePath(registryRoot))).id).toBe(lease.owner.id)
      await lease.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('prunes a recycled PID only when its process start identity differs', async () => {
    const registryRoot = await mkTestDir('tao-native-host-recycled-')
    try {
      await writeOwner(registryRoot, { processStartedAt: 'old-process' })
      const lease = await MachineLanes.acquireResource({
        command: 'studio-canary',
        name: resourceName,
        processIdentity: aliveIdentity('new-process'),
        registryRoot,
        repositoryRoot: '/worktrees/canary',
        waitTimeoutMs: 0,
      })

      Expect(lease.owner.id).not.toBe('foreign-owner')
      await lease.release()
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('never prunes a live old owner merely because the lease is old', async () => {
    const registryRoot = await mkTestDir('tao-native-host-live-old-')
    try {
      await writeOwner(registryRoot, { processStartedAt: 'same-process' })

      await Expect(MachineLanes.acquireResource({
        command: 'full-verify-native',
        name: resourceName,
        processIdentity: aliveIdentity('same-process'),
        registryRoot,
        repositoryRoot: '/worktrees/verification',
        waitTimeoutMs: 0,
      })).rejects.toBeInstanceOf(MachineResourceBusyError)
      Expect((await FS.readJson<MachineResourceOwner>(resourcePath(registryRoot))).id).toBe('foreign-owner')
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('keeps an owner when process identity cannot be determined', async () => {
    const registryRoot = await mkTestDir('tao-native-host-unknown-')
    try {
      await writeOwner(registryRoot, { processStartedAt: 'recorded-process' })

      await Expect(MachineLanes.acquireResource({
        command: 'studio-smoke-native',
        name: resourceName,
        processIdentity: async () => ({ evidence: 'unknown' }),
        registryRoot,
        repositoryRoot: '/worktrees/smoke',
        waitTimeoutMs: 0,
      })).rejects.toBeInstanceOf(MachineResourceBusyError)
      Expect((await FS.readJson<MachineResourceOwner>(resourcePath(registryRoot))).id).toBe('foreign-owner')
    } finally {
      await FS.remove(registryRoot)
    }
  })

  Test('atomically gives exactly one of two racing processes the native host', async () => {
    const root = await mkTestDir('tao-native-host-race-')
    const beginPath = FS.resolvePath('begin', root)
    const releasePath = FS.resolvePath('release', root)
    const machineLanesPath = Repo.resolvePath('packages/dev/dev-src/repository-tests/MachineLanes.ts')
    const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
    const script = `
      import { Errors, FS, Time } from ${JSON.stringify(sharedPath)}
      import { MachineLanes, MachineResourceBusyError } from ${JSON.stringify(machineLanesPath)}
      const root = process.env['TAO_NATIVE_HOST_TEST_ROOT']
      const id = process.env['TAO_NATIVE_HOST_TEST_ID']
      if (!root || !id) Errors.throwUnexpected('Missing native host race input.')
      while (!await FS.exists(FS.resolvePath('begin', root))) await Time.sleep(5)
      try {
        const lease = await MachineLanes.acquireResource({
          command: 'native-' + id,
          name: 'studio-native-host',
          registryRoot: FS.resolvePath('registry', root),
          repositoryRoot: '/worktrees/' + id,
          waitTimeoutMs: 0,
        })
        await FS.writeJson(FS.resolvePath('result-' + id + '.json', root), { outcome: 'acquired' })
        while (!await FS.exists(FS.resolvePath('release', root))) await Time.sleep(5)
        await lease.release()
      } catch (error) {
        if (!(error instanceof MachineResourceBusyError)) throw error
        await FS.writeJson(FS.resolvePath('result-' + id + '.json', root), {
          outcome: 'busy', ownerCommand: error.owner.command, ownerRoot: error.owner.repositoryRoot,
        })
      }
    `
    const runChild = (id: string) =>
      CLI.run('bun', {
        args: ['-e', script],
        env: { TAO_NATIVE_HOST_TEST_ID: id, TAO_NATIVE_HOST_TEST_ROOT: root },
        stdio: 'pipe',
      })
    let children: Promise<CLI.CommandResult>[] = []
    try {
      children = [runChild('first'), runChild('second')]
      await FS.writeText(beginPath, '')
      await until(async () =>
        await FS.exists(FS.resolvePath('result-first.json', root))
        && await FS.exists(FS.resolvePath('result-second.json', root)), {
        description: 'both native host racers to record their outcomes',
      })
      const results = await Promise.all(
        ['first', 'second'].map(id =>
          FS.readJson<{
            outcome: 'acquired' | 'busy'
            ownerCommand?: string
            ownerRoot?: string
          }>(FS.resolvePath(`result-${id}.json`, root))
        ),
      )

      Expect(results.map(result => result.outcome).toSorted()).toEqual(['acquired', 'busy'])
      const busy = results.find(result => result.outcome === 'busy')
      Expect(busy?.ownerCommand).toMatch(/^native-(first|second)$/)
      Expect(busy?.ownerRoot).toMatch(/^\/worktrees\/(first|second)$/)

      await FS.writeText(releasePath, '')
      const exits = await Promise.all(children)
      Expect(exits.every(result => result.exitCode === 0)).toBe(true)
    } finally {
      await FS.writeText(beginPath, '').catch(() => {})
      await FS.writeText(releasePath, '').catch(() => {})
      await Promise.allSettled(children)
      await FS.remove(root)
    }
  })
})
