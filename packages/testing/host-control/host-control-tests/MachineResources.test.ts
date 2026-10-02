import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, settle, Test, until } from '@shared/test'
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
  Test('cancels a pending acquisition while preserving the current owner', async () => {
    const root = await mkTestDir('tao-resource-cancel-')
    const abort = new AbortController()
    const inspectedHolder = Deferred()
    let inspections = 0
    try {
      const owner = await writeOwner(root)
      const pending = MachineResources.acquire({
        command: 'cancelled contender',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        signal: abort.signal,
        waitTimeoutMs: 600_000,
        processIdentity: async () => {
          if (++inspections === 2) {
            inspectedHolder.resolve()
          }
          return { evidence: 'alive', startedAt: 'same-process-start' }
        },
      })
      const rejected = Expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await inspectedHolder.promise
      await settle()
      abort.abort()
      await rejected
      Expect(await MachineResources.readOwner({ name: resourceName, registryRoot: root })).toEqual(owner)
      Expect(await FS.exists(FS.resolvePath('.mutex', root))).toBe(false)
    } finally {
      abort.abort()
      await FS.remove(root)
    }
  })

  Test('cancels a registry wait without removing the holder mutex or leaving a contender', async () => {
    const root = await mkTestDir('tao-resource-cancel-mutex-')
    const abort = new AbortController()
    try {
      const holder = FS.resolvePath('holder.json', root)
      await FS.writeJson(holder, { pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString() })
      await FS.symlink('holder.json', FS.resolvePath('.mutex', root))
      const pending = MachineResources.acquire({
        command: 'cancelled registry waiter',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        processIdentity: aliveIdentity('same-process-start'),
        signal: abort.signal,
        waitTimeoutMs: 600_000,
      })
      const rejected = Expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await until(async () => (await FS.listDir(FS.resolvePath('.mutex-contenders', root)).catch(() => [])).length > 0)
      abort.abort()
      await rejected
      Expect(await FS.realPath(FS.resolvePath('.mutex', root))).toBe(await FS.realPath(holder))
      Expect(await FS.listDir(FS.resolvePath('.mutex-contenders', root))).toEqual([])
      Expect(await FS.exists(resourcePath(root))).toBe(false)
    } finally {
      abort.abort()
      await FS.remove(root)
    }
  })

  Test('releases a successful claim when cancellation races with stale-owner replacement', async () => {
    const root = await mkTestDir('tao-resource-cancel-claim-')
    const abort = new AbortController()
    let inspections = 0
    try {
      await writeOwner(root)
      await Expect(MachineResources.acquire({
        command: 'claim race',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        signal: abort.signal,
        processIdentity: async () => {
          if (++inspections === 1) {
            return { evidence: 'alive', startedAt: 'same-process-start' }
          }
          abort.abort()
          return { evidence: 'gone' }
        },
      })).rejects.toMatchObject({ name: 'AbortError' })
      Expect(await FS.exists(resourcePath(root))).toBe(false)
      const subsequent = await MachineResources.acquire({
        command: 'next caller',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        processIdentity: aliveIdentity('same-process-start'),
        waitTimeoutMs: 0,
      })
      await subsequent.release()
    } finally {
      await FS.remove(root)
    }
  })

  Test('pre-cancelled acquisition leaves an absent registry untouched', async () => {
    const root = await mkTestDir('tao-resource-pre-cancel-')
    const missing = FS.resolvePath('absent', root)
    const abort = new AbortController()
    abort.abort()
    try {
      await Expect(MachineResources.acquire({
        command: 'pre-cancelled',
        name: resourceName,
        registryRoot: missing,
        repositoryRoot: root,
        signal: abort.signal,
      })).rejects.toMatchObject({ name: 'AbortError' })
      Expect(await FS.exists(missing)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('read-only diagnostics leave a missing registry absent', async () => {
    const root = await mkTestDir('tao-host-control-read-only-')
    const missing = FS.resolvePath('missing-registry', root)
    try {
      Expect(await MachineResources.listOwners({ registryRoot: missing })).toEqual([])
      Expect(await MachineResources.readOwner({ name: resourceName, registryRoot: missing })).toBeUndefined()
      Expect(await FS.exists(missing)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('read-only diagnostics tolerate a retained manifest removed after directory listing', async () => {
    const root = await mkTestDir('tao-host-control-reader-race-')
    try {
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          `--tsconfig=${Repo.resolvePath('packages/testing/host-control/tsconfig.json')}`,
          '-e',
          `
const shared = {...await import(${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))})};
const {MockModule, testOverrideSlot} = await import(${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))
          });
const FS = {...shared.FS};
MockModule('@shared', () => ({...shared, FS}));
const {MachineResources} = await import(${
            JSON.stringify(Repo.resolvePath('packages/testing/host-control/host-control-src/MachineResources.ts'))
          });
const root = ${JSON.stringify(root)};
const lease = await MachineResources.acquire({command: 'reader race', name: 'reader-race', registryRoot: root, repositoryRoot: root});
const retained = await MachineResources.retain({owners: [lease.owner], processes: [], quarantined: true, reason: 'reader race', registryRoot: root});
const manifest = FS.resolvePath(retained.id + '.json', FS.resolvePath('.retentions', root));
const original = FS.resolvePath('resource-reader-race.lease', root);
const readJson = FS.readJson;
let removed = false;
const slot = testOverrideSlot({read: () => FS.readJson, write: value => {FS.readJson = value}});
const restore = slot.install(async path => {
  if (path === manifest && !removed) {
    removed = true;
    await FS.remove(original);
    await FS.remove(manifest);
  }
  return await readJson(path);
});
try {
  const owners = await MachineResources.listOwners({registryRoot: root});
  shared.Platform.runtimeConsole.info(JSON.stringify({removed, owners, manifestExists: await FS.exists(manifest)}));
} finally {
  restore();
}
`,
        ],
      })
      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(0)
      Expect(JSON.parse(result.stdout)).toEqual({ removed: true, owners: [], manifestExists: false })
    } finally {
      await FS.remove(root)
    }
  })
  Test('retention atomically rotates every fence to a survivor and survives parent exit and PID reuse', async () => {
    const root = await mkTestDir('tao-host-control-retention-')
    try {
      const options = { processIdentity: aliveIdentity('parent'), registryRoot: root, repositoryRoot: root }
      const first = await MachineResources.acquire({ ...options, command: 'AVD', name: resourceName })
      const second = await MachineResources.acquire({ ...options, command: 'serial', name: 'android-serial' })
      const retained = await MachineResources.retain({
        owners: [first.owner, second.owner],
        processes: [{ command: 'emulator', pid: 2 ** 29, startedAt: 'actual-emulator-start' }],
        quarantined: false,
        reason: 'child survived shutdown',
        registryRoot: root,
      })
      Expect(retained.id).not.toBe(first.generation)
      Expect(retained.pid).toBe(2 ** 29)
      Expect(retained.processStartedAt).toBe('actual-emulator-start')
      Expect((await MachineResources.readOwner({ name: 'android-serial', registryRoot: root }))?.id).toBe(retained.id)
      Expect((await MachineResources.readOwner({ name: resourceName, registryRoot: root }))?.pid).toBe(2 ** 29)
      // Simulate a crash partway through recovery: the atomic manifest still fences both targets.
      await FS.remove(resourcePath(root))
      Expect((await MachineResources.listOwners({ registryRoot: root })).map(owner => owner.name).sort()).toEqual([
        'android-serial',
        resourceName,
      ].sort())
      await Promise.all([first.release(), second.release()])
      for (const name of [resourceName, 'android-serial']) {
        for (const identity of [{ evidence: 'gone' }, { evidence: 'alive', startedAt: 'reused-pid' }] as const) {
          await Expect(MachineResources.acquire({
            ...options,
            command: 'contender after parent exit',
            maxAgeMs: 0,
            name,
            processIdentity: async () => identity,
            waitTimeoutMs: 0,
          })).rejects.toBeInstanceOf(MachineResourceBusyError)
        }
      }
      let recoveryOwner: MachineResourceOwner | undefined
      await MachineResources.recoverRetained({
        generation: retained.id,
        name: resourceName,
        registryRoot: root,
        shutdown: async owner => {
          recoveryOwner = owner
          return true
        },
      })
      Expect(recoveryOwner?.retention?.resourceNames).toEqual([resourceName, 'android-serial'])
      for (const name of [resourceName, 'android-serial']) {
        const available = await MachineResources.acquire({ ...options, command: 'recovered', name, waitTimeoutMs: 0 })
        await available.release()
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('recovery checks generation before shutdown and owner again before clearing any fence', async () => {
    const root = await mkTestDir('tao-host-control-recovery-fence-')
    try {
      const lease = await MachineResources.acquire({
        command: 'owned',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
      })
      const retained = await MachineResources.retain({
        owners: [lease.owner],
        processes: [],
        quarantined: true,
        reason: 'unknown child',
        registryRoot: root,
      })
      let shutdowns = 0
      await Expect(MachineResources.recoverRetained({
        generation: lease.generation,
        name: resourceName,
        registryRoot: root,
        shutdown: async () => {
          shutdowns++
          return true
        },
      })).rejects.toBeInstanceOf(MachineResourceFenceError)
      Expect(shutdowns).toBe(0)
      await Expect(MachineResources.recoverRetained({
        generation: retained.id,
        name: resourceName,
        registryRoot: root,
        shutdown: async () => false,
      })).rejects.toBeInstanceOf(Errors.HostEnvironmentError)
      let replacement: MachineResourceOwner | undefined
      await Expect(MachineResources.recoverRetained({
        generation: retained.id,
        name: resourceName,
        registryRoot: root,
        shutdown: async owner => {
          replacement = await MachineResources.retain({
            owners: [owner],
            processes: [],
            quarantined: true,
            reason: 'new generation',
            registryRoot: root,
          })
          return true
        },
      })).rejects.toBeInstanceOf(MachineResourceFenceError)
      await Expect(MachineResources.acquire({
        command: 'contender',
        name: resourceName,
        registryRoot: root,
        repositoryRoot: root,
        waitTimeoutMs: 0,
        processIdentity: async () => ({ evidence: 'gone' }),
      })).rejects.toBeInstanceOf(MachineResourceBusyError)
      Expect(replacement?.id).not.toBe(retained.id)
    } finally {
      await FS.remove(root)
    }
  })
  Test('concurrent releases join one pending registry cleanup', async () => {
    const root = await mkTestDir('tao-host-control-release-')
    try {
      // Module mocking lives in an isolated worker because FS is an immutable module namespace.
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          `--tsconfig=${Repo.resolvePath('packages/testing/host-control/tsconfig.json')}`,
          '-e',
          `
const shared = {...await import(${JSON.stringify(Repo.resolvePath('packages/shared/shared-src/shared.ts'))})};
const {MockModule, until, testOverrideSlot} = await import(${
            JSON.stringify(Repo.resolvePath('packages/shared/shared-src/testing/Test-Bun.ts'))
          });
const {Platform} = shared;
const FS = {...shared.FS};
MockModule('@shared', () => ({...shared, FS}));
const {MachineResources} = await import(${
            JSON.stringify(Repo.resolvePath('packages/testing/host-control/host-control-src/MachineResources.ts'))
          });
const root = ${JSON.stringify(root)};
const mutex = FS.resolvePath('.mutex', root);
const path = FS.resolvePath('resource-release-control.lease', root);
const lease = await MachineResources.acquire({command: 'release-control', name: 'release-control', registryRoot: root, repositoryRoot: root});
await FS.writeJson(FS.resolvePath('blocker.json', root), {pid: Platform.runtimeProcess.pid, startedAt: new Date().toISOString()});
await FS.symlink('blocker.json', mutex);
const symlink = FS.symlink;
let acquisitions = 0;
const slot = testOverrideSlot({read: () => FS.symlink, write: value => {FS.symlink = value}});
const restore = slot.install(async (target, link) => {
  await symlink(target, link);
  if (link === mutex) acquisitions += 1;
});
const first = lease.release();
const second = lease.release();
try {
  await until(async () => (await FS.listDir(FS.resolvePath('.mutex-contenders', root))).length > 0);
  const heldBeforeUnblock = await FS.exists(path);
  await FS.remove(mutex);
  await Promise.all([first, second]);
  Platform.runtimeConsole.info(JSON.stringify({acquisitions, heldBeforeUnblock, remaining: await FS.exists(path), contenders: await FS.listDir(FS.resolvePath('.mutex-contenders', root))}));
} finally {
  await FS.remove(mutex);
  await Promise.allSettled([first, second]);
  restore();
}
`,
        ],
      })
      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(0)
      Expect(JSON.parse(result.stdout)).toEqual({
        acquisitions: 1,
        heldBeforeUnblock: true,
        remaining: false,
        contenders: [],
      })
    } finally {
      await FS.remove(root)
    }
  })

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
