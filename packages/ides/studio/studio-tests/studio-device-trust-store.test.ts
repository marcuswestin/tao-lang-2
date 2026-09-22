import { StudioDeviceTrust } from '@runtime/TR-studio-device-trust'
import { CLI, FS, Platform, Repo, Time } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, until } from '@shared/test'
import {
  StudioDeviceTrustStore,
  StudioDeviceTrustStoreTesting,
} from '../studio-src/device/StudioDeviceTrustStore'

Describe('Studio device trust store', () => {
  Test('creates a persistent identity once and reloads it with its devices', async () => {
    await withRoot(async root => {
      const store = await StudioDeviceTrustStore.open(root)
      const identity = store.identity()
      Expect(StudioDeviceTrust.publicKeyOf(identity)).toBe(identity.publicKey)
      Expect(store.fingerprint()).toBe(StudioDeviceTrust.fingerprint(identity.publicKey))
      Expect(await FS.readJson(FS.resolvePath('studio-identity.json', root))).toEqual({ ...identity, version: 1 })
      Expect(store.trusted()).toEqual([])
      Expect(await FS.isFile(FS.resolvePath('trusted-devices.json', root))).toBe(false)

      const device = StudioDeviceTrust.generateIdentity()
      await store.trust(record(device.publicKey, 'roPhone'))
      Expect(store.isTrusted(device.publicKey)).toBe(true)
      Expect(store.trusted()).toEqual([{
        device: { model: 'iPhone17,1', name: 'roPhone', os: 'iOS 26' },
        devicePublicKey: device.publicKey,
        fingerprint: StudioDeviceTrust.fingerprint(device.publicKey),
        pairedAt: '2026-09-02T10:00:00.000Z',
      }])

      const reloaded = await StudioDeviceTrustStore.open(root)
      Expect(reloaded.identity()).toEqual(identity)
      Expect(reloaded.trusted()).toEqual(store.trusted())
      Expect(reloaded.isTrusted(device.publicKey)).toBe(true)
    })
  })

  Test('replaces, touches, and revokes device records', async () => {
    await withRoot(async root => {
      const store = await StudioDeviceTrustStore.open(root)
      const device = StudioDeviceTrust.generateIdentity()
      const other = StudioDeviceTrust.generateIdentity()
      await store.trust(record(device.publicKey, 'roPhone'))
      await store.trust(record(other.publicKey, 'roPad'))
      await store.trust({ ...record(device.publicKey, 'roPhone renamed'), fingerprint: 'ignored' })
      Expect(await store.touch(device.publicKey, '2026-09-02T11:00:00.000Z')).toBe(true)
      Expect(await store.touch('unknown', '2026-09-02T11:00:00.000Z')).toBe(false)

      Expect(store.trusted().map(item => [item.device.name, item.lastSeenAt])).toEqual([
        ['roPhone renamed', '2026-09-02T11:00:00.000Z'],
        ['roPad', undefined],
      ])
      Expect(store.trusted()[0]?.fingerprint).toBe(StudioDeviceTrust.fingerprint(device.publicKey))
      Expect(await store.revoke(device.publicKey)).toBe(true)
      Expect(await store.revoke(device.publicKey)).toBe(false)
      Expect(store.isTrusted(device.publicKey)).toBe(false)
      Expect((await StudioDeviceTrustStore.open(root)).trusted().map(item => item.devicePublicKey)).toEqual([
        other.publicKey,
      ])
      await Expect(store.trust(record('not a key', 'bad'))).rejects.toThrow('valid public key')
    })
  })

  Test('ignores malformed files instead of failing to open', async () => {
    await withRoot(async root => {
      await FS.writeText(FS.resolvePath('studio-identity.json', root), '{"version": 1, "publicKey": "short"')
      await FS.writeJson(FS.resolvePath('trusted-devices.json', root), {
        devices: [
          { device: { name: 'roPhone' }, devicePublicKey: 'short', pairedAt: 'never' },
          'nonsense',
          record(StudioDeviceTrust.generateIdentity().publicKey, 'roPad'),
          { devicePublicKey: StudioDeviceTrust.generateIdentity().publicKey, pairedAt: 'not a date' },
        ],
        version: 1,
      })
      const store = await StudioDeviceTrustStore.open(root)
      Expect(StudioDeviceTrust.validPublicKey(store.identity().publicKey)).toBe(true)
      Expect(store.trusted().map(item => item.device.name)).toEqual(['roPad'])

      const forged = StudioDeviceTrust.generateIdentity()
      await FS.writeJson(FS.resolvePath('studio-identity.json', root), {
        publicKey: forged.publicKey,
        secretKey: StudioDeviceTrust.generateIdentity().secretKey,
        version: 1,
      })
      await FS.writeJson(FS.resolvePath('trusted-devices.json', root), { devices: [], version: 2 })
      const regenerated = await StudioDeviceTrustStore.open(root)
      Expect(regenerated.identity().publicKey).not.toBe(forged.publicKey)
      Expect(StudioDeviceTrust.publicKeyOf(regenerated.identity())).toBe(regenerated.identity().publicKey)
      Expect(regenerated.trusted()).toEqual([])
    })
  })

  Test('serializes overlapping writes and leaves no partial file behind', async () => {
    await withRoot(async root => {
      const store = await StudioDeviceTrustStore.open(root)
      const devices = Array.from(
        { length: 6 },
        (_, index) => record(StudioDeviceTrust.generateIdentity().publicKey, `d${index}`),
      )
      const writes = devices.map(device => store.trust(device))
      writes.push(store.revoke(devices[1]!.devicePublicKey).then(() => {}))
      await Promise.all(writes)
      await store.flush()

      Expect(await FS.listDir(root)).toEqual(['studio-identity.json', 'trusted-devices.json'])
      const reloaded = await StudioDeviceTrustStore.open(root)
      Expect(reloaded.trusted().map(item => item.device.name)).toEqual(['d0', 'd2', 'd3', 'd4', 'd5'])
    })
  })

  Test('reclaims an ownerless filesystem lock after its acquisition grace period', async () => {
    await withRoot(async root => {
      const lockPath = FS.resolvePath('.studio-device-trust-v2.lock', root)
      await FS.writeText(lockPath, '')
      await Time.sleep(2_100)

      const opened = StudioDeviceTrustStore.open(root).then(
        () => true,
        () => false,
      )
      // `opened` already resolves true/false on its own; racing it against a sleep let a loaded host
      // make the sleep branch win and flip this to false even though the open would have succeeded.
      Expect(await opened).toBe(true)
      Expect(await FS.exists(lockPath)).toBe(false)
    })
  })

  Test('publishes a complete owner atomically after a paused candidate writer', async () => {
    await withRoot(async root => {
      const lockPath = FS.resolvePath('.studio-device-trust-v2.lock', root)
      const writerPaused = Deferred()
      const releaseWriter = Deferred()
      const first = StudioDeviceTrustStoreTesting.publishOwnerFileClaim(
        lockPath,
        { pid: Platform.runtimeProcess.pid, processStartedAt: 'first', token: 'first' },
        async () => {
          writerPaused.resolve()
          await releaseWriter.promise
        },
      )
      try {
        await writerPaused.promise

        Expect(await FS.exists(lockPath)).toBe(false)
        Expect(
          await StudioDeviceTrustStoreTesting.publishOwnerFileClaim(
            lockPath,
            { pid: Platform.runtimeProcess.pid, processStartedAt: 'second', token: 'second' },
          ),
        ).toBe(true)
        Expect(await FS.readJson(lockPath)).toEqual({
          pid: Platform.runtimeProcess.pid,
          processStartedAt: 'second',
          token: 'second',
        })
      } finally {
        releaseWriter.resolve()
        await first
        await FS.remove(lockPath)
      }
    })
  })

  Test('treats a reused live pid as a stale owner when its process start identity changed', async () => {
    Expect(
      await StudioDeviceTrustStoreTesting.lockOwnerIsLive(
        { pid: 4242, processStartedAt: 'old process', token: 'owner' },
        async () => ({ evidence: 'alive', startedAt: 'new process' }),
      ),
    ).toBe(false)
    Expect(
      await StudioDeviceTrustStoreTesting.lockOwnerIsLive(
        { pid: 4242, processStartedAt: 'same process', token: 'owner' },
        async () => ({ evidence: 'alive', startedAt: 'same process' }),
      ),
    ).toBe(true)
  })

  Test('never steals a lock from an owner whose start time it cannot compare', async () => {
    // An owner file written by a build that read process start times differently — this one shelled
    // out to `ps`, which an agent sandbox denies, before it moved to the libproc reader — carries a
    // spelling this build cannot compare. Two incomparable strings are not evidence that the PID
    // changed hands, and only that evidence may take a lock away.
    Expect(
      await StudioDeviceTrustStoreTesting.lockOwnerIsLive(
        { pid: 4242, processStartedAt: 'Mon Sep  1 12:00:00 2026', token: 'owner' },
        async () => ({ evidence: 'alive', startedAt: 'proc:1789812267:567095' }),
      ),
    ).toBe(true)
    // Same scheme, different value, is the reuse this comparison exists to catch.
    Expect(
      await StudioDeviceTrustStoreTesting.lockOwnerIsLive(
        { pid: 4242, processStartedAt: 'proc:1789812267:567095', token: 'owner' },
        async () => ({ evidence: 'alive', startedAt: 'proc:1789899999:111111' }),
      ),
    ).toBe(false)
  })

  Test('reads a live process start time without a subprocess the sandbox can deny', async () => {
    // The point of the change: this process is alive, and its identity must carry a start time here.
    // The `ps` reader returned `unknown` with no start time in every sandboxed run, which quietly
    // disabled the reuse check above.
    const identity = await StudioDeviceTrustStoreTesting.inspectProcessIdentity(Platform.runtimeProcess.pid)

    Expect(identity.evidence).toBe('alive')
    Expect(identity.evidence === 'alive' ? identity.startedAt : undefined).toBeDefined()
  })

  Test('rejects a stale legacy directory whose old protocol cannot be reclaimed safely', async () => {
    await withRoot(async root => {
      const legacyPath = FS.resolvePath('.studio-device-trust.lock', root)
      const ownerPath = FS.resolvePath('owner.json', legacyPath)
      await FS.mkdir(legacyPath)
      await FS.writeJson(ownerPath, { pid: 999_999, token: 'stale' })

      await Expect(StudioDeviceTrustStore.open(root)).rejects.toThrow(
        /belongs to a stopped process[\s\S]*cannot be reclaimed safely across Studio versions/,
      )
      Expect(await FS.readJson(ownerPath)).toEqual({ pid: 999_999, token: 'stale' })
      Expect(await FS.exists(FS.resolvePath('.studio-device-trust-v2.lock', root))).toBe(false)
    })
  })

  Test('fails with repair guidance instead of waiting forever on an abandoned reclaim guard', async () => {
    await withRoot(async root => {
      // A reclaimer that stopped after retiring the lock but before removing its guard leaves only this.
      const guardPath = FS.resolvePath('.studio-device-trust-v2.lock.reclaim-guard', root)
      await FS.writeJson(guardPath, { pid: 999_999, token: 'stopped-reclaimer' })

      await Expect(StudioDeviceTrustStore.open(root)).rejects.toThrow(/reclaim guard .* is stale/)
      Expect(await FS.readJson(guardPath)).toEqual({ pid: 999_999, token: 'stopped-reclaimer' })
    })
  })

  Test('does not reclaim a replacement v2 owner that appeared after stale observation', async () => {
    await withRoot(async root => {
      const lockPath = FS.resolvePath('.studio-device-trust-v2.lock', root)
      const displacedPath = FS.resolvePath('displaced-v2-lock', root)
      await FS.writeJson(lockPath, { pid: 999_999, token: 'stale' })
      const observation = await StudioDeviceTrustStoreTesting.observeFileClaim(lockPath)
      Expect(observation).toBeDefined()

      await StudioDeviceTrustStoreTesting.reclaimFileClaim(
        lockPath,
        observation!,
        { pid: Platform.runtimeProcess.pid, token: 'reclaimer' },
        async () => {
          await FS.move(lockPath, displacedPath)
          await FS.writeJson(lockPath, { pid: Platform.runtimeProcess.pid, token: 'replacement' })
        },
      )

      Expect(await FS.readJson(lockPath)).toEqual({ pid: Platform.runtimeProcess.pid, token: 'replacement' })
      Expect(await FS.readJson(displacedPath)).toEqual({ pid: 999_999, token: 'stale' })
    })
  })

  Test('does not reclaim a replacement legacy barrier after stale observation', async () => {
    await withRoot(async root => {
      const legacyPath = FS.resolvePath('.studio-device-trust.lock', root)
      const staleTarget = FS.resolvePath('stale-legacy-owner', root)
      const replacementTarget = FS.resolvePath('replacement-legacy-owner', root)
      const displacedPath = FS.resolvePath('displaced-legacy-barrier', root)
      await FS.mkdir(staleTarget)
      await FS.writeJson(FS.resolvePath('owner.json', staleTarget), { pid: 999_999, token: 'stale' })
      await FS.symlink(staleTarget, legacyPath)
      const observation = await StudioDeviceTrustStoreTesting.observeLegacyLock(legacyPath)
      Expect(observation).toBeDefined()

      await StudioDeviceTrustStoreTesting.retireLegacyLinkIfUnchanged(
        legacyPath,
        observation!,
        'reclaimer',
        async () => {
          await FS.move(legacyPath, displacedPath)
          await FS.mkdir(replacementTarget)
          await FS.writeJson(FS.resolvePath('owner.json', replacementTarget), {
            pid: Platform.runtimeProcess.pid,
            token: 'replacement',
          })
          await FS.symlink(replacementTarget, legacyPath)
        },
      )

      Expect(await FS.readJson(FS.resolvePath('owner.json', legacyPath))).toEqual({
        pid: Platform.runtimeProcess.pid,
        token: 'replacement',
      })
      Expect(await FS.exists(displacedPath)).toBe(true)
    })
  })

  Test('rejects an aged malformed legacy directory with bounded repair guidance', async () => {
    await withRoot(async root => {
      const legacyPath = FS.resolvePath('.studio-device-trust.lock', root)
      await FS.mkdir(legacyPath)
      await FS.writeText(FS.resolvePath('owner.json', legacyPath), 'not json')
      await Time.sleep(2_100)

      // `opening` rejects on its own once the repair guidance is ready; racing it against a sleep let
      // a loaded host make the sleep branch win and throw the wrong error before `opening` settled.
      const opening = StudioDeviceTrustStore.open(root)
      await Expect(opening).rejects.toThrow(/has no valid owner[\s\S]*move that one lock path aside/)
    })
  })

  Test('waits for an independent legacy directory-lock process before opening the store', async () => {
    await withRoot(async root => {
      const readyPath = FS.resolvePath('legacy-ready', root)
      const releasePath = FS.resolvePath('legacy-release', root)
      const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      const script = `
        import { FS, Platform, Time } from ${JSON.stringify(sharedPath)}
        const root = ${JSON.stringify(root)}
        const lockPath = FS.resolvePath('.studio-device-trust.lock', root)
        await FS.mkdir(lockPath)
        await FS.writeJson(FS.resolvePath('owner.json', lockPath), {
          pid: Platform.runtimeProcess.pid,
          token: 'legacy-owner',
        })
        await FS.writeText(${JSON.stringify(readyPath)}, 'ready')
        while (!await FS.exists(${JSON.stringify(releasePath)})) {
          await Time.sleep(10)
        }
        await FS.remove(lockPath)
      `
      const legacy = CLI.run('bun', { args: ['-e', script], stdio: 'pipe' })
      try {
        await until(async () => await FS.exists(readyPath), { description: 'the legacy lock owner' })
        let opened = false
        const opening = StudioDeviceTrustStore.open(root).then(store => {
          opened = true
          return store
        })
        await Time.sleep(100)
        Expect(opened).toBe(false)
        await FS.writeText(releasePath, 'release')
        await opening
        Expect(opened).toBe(true)
        Expect((await legacy).exitCode).toBe(0)
      } finally {
        await FS.writeText(releasePath, 'release').catch(() => {})
        await legacy
      }
    })
  })

  Test('keeps one identity and every trust decision across independent processes', async () => {
    await withRoot(async root => {
      const modulePath = Repo.resolvePath('packages/ides/studio/studio-src/device/StudioDeviceTrustStore.ts')
      const trustPath = Repo.resolvePath('packages/apps/runtime/TaoRuntime-src/TR-studio-device-trust.ts')
      const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      const workers = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const script = `
          import { StudioDeviceTrustStore } from ${JSON.stringify(modulePath)}
          import { StudioDeviceTrust } from ${JSON.stringify(trustPath)}
          import { HCI } from ${JSON.stringify(sharedPath)}
          const store = await StudioDeviceTrustStore.open(${JSON.stringify(root)})
          const device = StudioDeviceTrust.generateIdentity()
          await store.trust({
            device: { model: 'iPhone', name: ${JSON.stringify(`worker-${index}`)}, os: 'iOS' },
            devicePublicKey: device.publicKey,
            fingerprint: '',
            pairedAt: '2026-09-02T10:00:00.000Z',
          })
          HCI.writeLine(JSON.stringify({ identity: store.publicKey(), key: device.publicKey }))
        `
        return await CLI.run('bun', { args: ['-e', script], stdio: 'pipe' })
      }))
      Expect(workers.map(worker => worker.exitCode)).toEqual(Array(8).fill(0))
      const results = workers.map(worker => JSON.parse(worker.stdout.trim()) as { identity: string; key: string })
      Expect(new Set(results.map(result => result.identity)).size).toBe(1)
      const reloaded = await StudioDeviceTrustStore.open(root)
      Expect(new Set(reloaded.trusted().map(device => device.devicePublicKey))).toEqual(
        new Set(results.map(result => result.key)),
      )
    })
  })
})

function record(devicePublicKey: string, name: string) {
  return {
    device: { model: 'iPhone17,1', name, os: 'iOS 26' },
    devicePublicKey,
    fingerprint: '',
    pairedAt: '2026-09-02T10:00:00.000Z',
  }
}

async function withRoot(use: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir(FS.resolvePath('tao-studio-trust-store-', FS.tmpdir()))
  try {
    await use(root)
  } finally {
    await FS.remove(root)
  }
}
