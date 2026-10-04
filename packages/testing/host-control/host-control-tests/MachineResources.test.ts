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

Test(
  'retained lineage resolves every rotation from an original generation without changing custody files',
  async () => {
    const root = await mkTestDir('tao-retained-lineage-')
    try {
      const lease = await MachineResources.acquire({
        name: 'android-console-port:5582',
        registryRoot: root,
        command: 'source sentinel',
        repositoryRoot: root,
      })
      const process = { pid: 536_870_912, startedAt: 'original-kernel', command: 'captured root' }
      const first = await MachineResources.retain({
        owners: [lease.owner],
        processes: [process],
        processGroupPid: process.pid,
        quarantined: false,
        reason: 'initial capture',
        registryRoot: root,
      })
      const second = await MachineResources.retain({
        owners: [first],
        processes: [process],
        processGroupPid: process.pid,
        quarantined: true,
        reason: 'retained cleanup',
        registryRoot: root,
      })
      const firstPath = FS.resolvePath(`.retentions/${first.id}.json`, root)
      const secondPath = FS.resolvePath(`.retentions/${second.id}.json`, root)
      const before = [await FS.readText(firstPath), await FS.readText(secondPath)]
      Expect(
        await MachineResources.readRetainedLineage({
          name: lease.owner.name,
          generation: first.id,
          registryRoot: root,
        }),
      )
        .toEqual([first, second])
      Expect(
        await MachineResources.readRetainedLineage({
          name: lease.owner.name,
          generation: 'foreign-generation',
          registryRoot: root,
        }),
      )
        .toBeUndefined()
      Expect(
        await MachineResources.readRetainedLineage({
          name: 'android-console-port:5584',
          generation: first.id,
          registryRoot: root,
        }),
      )
        .toBeUndefined()
      Expect([await FS.readText(firstPath), await FS.readText(secondPath)]).toEqual(before)
      Expect(await MachineResources.readOwner({ name: lease.owner.name, registryRoot: root })).toEqual(second)
    } finally {
      await FS.remove(root)
    }
  },
)

Test(
  'retained lineage rejects malformed or forked custody instead of selecting a generation by enumeration order',
  async () => {
    const root = await mkTestDir('tao-retained-lineage-refusal-')
    try {
      const lease = await MachineResources.acquire({
        name: 'android-console-port:5582',
        registryRoot: root,
        command: 'source sentinel',
        repositoryRoot: root,
      })
      const process = { pid: 536_870_912, startedAt: 'original-kernel', command: 'captured root' }
      const first = await MachineResources.retain({
        owners: [lease.owner],
        processes: [process],
        processGroupPid: process.pid,
        quarantined: false,
        reason: 'initial capture',
        registryRoot: root,
      })
      const second = await MachineResources.retain({
        owners: [first],
        processes: [process],
        processGroupPid: process.pid,
        quarantined: true,
        reason: 'retained cleanup',
        registryRoot: root,
      })
      const forkPath = FS.resolvePath('.retentions/fork.json', root)
      await FS.writeJson(forkPath, {
        originalOwners: [first],
        retainedOwner: { ...second, id: 'source-fork-generation' },
      })
      await Expect(
        MachineResources.readRetainedLineage({ name: lease.owner.name, generation: first.id, registryRoot: root }),
      )
        .rejects.toThrow('ambiguous or cyclic')
      await FS.writeText(forkPath, '{unreadable')
      await Expect(
        MachineResources.readRetainedLineage({ name: lease.owner.name, generation: first.id, registryRoot: root }),
      )
        .rejects.toThrow('Cannot read retained machine resource identities')
    } finally {
      await FS.remove(root)
    }
  },
)

Test('permanent resource refusal rotates the complete pair and cannot be cleared or recovered', async () => {
  const root = await mkTestDir('tao-resource-permanent-refusal-')
  try {
    const avd = await MachineResources.acquire({
      name: 'android-avd:OWNED',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    const serial = await MachineResources.acquire({
      name: 'android-emulator:emulator-5586',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    const captured = { command: 'owned emulator', pid: 536_870_912, startedAt: 'captured-kernel' }
    const refused = await MachineResources.retain({
      owners: [avd.owner, serial.owner],
      processes: [captured],
      processGroupPid: captured.pid,
      quarantined: false,
      reason: 'known root with unknown descendant',
      registryRoot: root,
      ownershipRefusal: { version: 1, reason: 'Unknown captured group member' },
    })
    const pair = [avd.owner, serial.owner].map(owner => ({ ...refused, name: owner.name, command: owner.command }))
    Expect(refused.id).not.toBe(avd.generation)
    Expect((await MachineResources.readOwner({ name: serial.owner.name, registryRoot: root }))?.id).toBe(refused.id)
    await Expect(MachineResources.retain({
      owners: [pair[0]!],
      processes: [captured],
      quarantined: false,
      reason: 'partial clearing attempt',
      registryRoot: root,
    })).rejects.toThrow('complete existing fence manifest')
    const rotated = await MachineResources.retain({
      owners: pair.map(owner => ({ ...owner, retention: { ...owner.retention!, ownershipRefusal: undefined } })),
      processes: [captured],
      processGroupPid: captured.pid,
      quarantined: false,
      reason: 'later empty group observation',
      registryRoot: root,
    })
    Expect(rotated.id).not.toBe(refused.id)
    Expect(rotated.retention?.ownershipRefusal).toEqual({ version: 1, reason: 'Unknown captured group member' })
    let shutdowns = 0
    await Expect(MachineResources.recoverRetained({
      name: avd.owner.name,
      generation: rotated.id,
      registryRoot: root,
      shutdown: async () => {
        shutdowns++
        return true
      },
    })).rejects.toThrow('permanent ownership refusal')
    Expect(shutdowns).toBe(0)
    for (const name of [avd.owner.name, serial.owner.name]) {
      Expect((await MachineResources.readOwner({ name, registryRoot: root }))?.id).toBe(rotated.id)
    }
  } finally {
    await FS.remove(root)
  }
})

Test('permanent refusal publication fences a recovery already waiting on shutdown', async () => {
  const root = await mkTestDir('tao-resource-refusal-race-')
  try {
    const avd = await MachineResources.acquire({
      name: 'android-avd:OWNED',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    const serial = await MachineResources.acquire({
      name: 'android-emulator:emulator-5586',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    const captured = { command: 'owned emulator', pid: 536_870_912, startedAt: 'captured-kernel' }
    const known = await MachineResources.retain({
      owners: [avd.owner, serial.owner],
      processes: [captured],
      processGroupPid: captured.pid,
      quarantined: false,
      reason: 'captured',
      registryRoot: root,
    })
    const entered = Deferred<void>()
    const finish = Deferred<boolean>()
    const recovery = MachineResources.recoverRetained({
      name: avd.owner.name,
      generation: known.id,
      registryRoot: root,
      shutdown: async () => {
        entered.resolve()
        return await finish.promise
      },
    })
    const failed = Expect(recovery).rejects.toBeInstanceOf(MachineResourceFenceError)
    await entered.promise
    const sealed = await MachineResources.retain({
      owners: [avd.owner, serial.owner].map(owner => ({ ...known, name: owner.name, command: owner.command })),
      processes: [captured],
      processGroupPid: captured.pid,
      quarantined: false,
      reason: 'unknown during recovery',
      ownershipRefusal: { version: 1, reason: 'Permanent capture uncertainty' },
      registryRoot: root,
    })
    finish.resolve(true)
    await failed
    for (const name of [avd.owner.name, serial.owner.name]) {
      const owner = await MachineResources.readOwner({ name, registryRoot: root })
      Expect(owner?.id).toBe(sealed.id)
      Expect(owner?.retention?.ownershipRefusal?.reason).toBe('Permanent capture uncertainty')
    }
  } finally {
    await FS.remove(root)
  }
})

Test('refusal rotation preserves a changed serial owner and refuses stale pair publication', async () => {
  const root = await mkTestDir('tao-resource-refusal-changed-owner-')
  try {
    const avd = await MachineResources.acquire({
      name: 'android-avd:OWNED',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    const serial = await MachineResources.acquire({
      name: 'android-emulator:emulator-5586',
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    await serial.release()
    const replacement = await MachineResources.acquire({
      name: serial.owner.name,
      command: 'source fixture',
      registryRoot: root,
      repositoryRoot: root,
    })
    await Expect(MachineResources.retain({
      owners: [avd.owner, serial.owner],
      processes: [],
      quarantined: true,
      reason: 'stale pair',
      registryRoot: root,
      ownershipRefusal: { version: 1, reason: 'Unknown ownership' },
    })).rejects.toBeInstanceOf(MachineResourceFenceError)
    Expect((await MachineResources.readOwner({ name: avd.owner.name, registryRoot: root }))?.id).toBe(avd.generation)
    Expect((await MachineResources.readOwner({ name: serial.owner.name, registryRoot: root }))?.id).toBe(
      replacement.generation,
    )
  } finally {
    await FS.remove(root)
  }
})

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
