import { StudioDeviceTrust } from '@runtime/TR-studio-device-trust'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StudioDeviceTrustStore } from '../studio-src/device/StudioDeviceTrustStore'

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
