import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  acceptedShipEntry,
  mergeProjectLocks,
  promoteShipEntry,
  putInstallsLock,
  putShipLockEntry,
  readProjectLock,
  type ShipLockEntry,
  writeProjectLock,
} from '../cli-src/ship-lock'

function suggestion(): ShipLockEntry {
  return {
    identity: 'wordflower/WordFlower',
    inputHash: 'input-one',
    provenance: { at: '2026-09-02T14:05:00.000Z', command: 'tao ship', version: 1 },
    status: 'suggested',
    suggested: {
      bundleIdentifier: 'app.tao.wordflower',
      datasourceConfiguration: {
        ApiURI: 'https://api.instantdb.com',
        AppId: 'hosted-app-id',
      },
      issuerId: 'issuer',
      keyId: 'key',
      namespace: 'app.tao',
    },
  }
}

Describe('tao ship project lock', () => {
  Test('writes, reads, and promotes a suggestion', async () => {
    const root = await mkTestDir('tao-ship-lock-')
    try {
      const accepted = promoteShipEntry(suggestion())
      const path = await writeProjectLock(root, putShipLockEntry({ schemaVersion: 1 }, accepted))
      const source = await FS.readText(path)
      Expect(source).toContain('"status": "accepted"')
      Expect(acceptedShipEntry(await readProjectLock(root), accepted.identity, accepted.inputHash)?.accepted)
        .toEqual(accepted.accepted)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reads comments and trailing commas but refuses stale accepted metadata', async () => {
    const root = await mkTestDir('tao-ship-lock-')
    try {
      await FS.writeText(
        FS.resolvePath('.tao/store/lock.jsonc', root),
        `{
        // Tao owns this file.
        "schemaVersion": 1,
        "ship": { "apps": { "wordflower/WordFlower": ${JSON.stringify(promoteShipEntry(suggestion()))}, }, },
      }`,
      )
      const lock = await readProjectLock(root)
      await Expect(Promise.resolve().then(() => acceptedShipEntry(lock, 'wordflower/WordFlower', 'changed')))
        .rejects.toThrow('is stale')
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps installs and shipping as independent sections of the one project lock', () => {
    const installs = {
      lockfileVersion: 2 as const,
      environments: {},
      local: {
        design: { sourceRoot: '.', root: '../design', version: '1.2.3', bindings: { '@ui': '@design' } },
      },
    }
    const withInstalls = putInstallsLock({ schemaVersion: 1, skillsVersion: '1.0.0' }, installs)
    const shipping = putShipLockEntry({ schemaVersion: 1 }, promoteShipEntry(suggestion()))

    Expect(mergeProjectLocks(withInstalls, shipping)).toEqual({
      installs,
      schemaVersion: 1,
      skillsVersion: '1.0.0',
      ship: shipping.ship,
    })
    Expect(mergeProjectLocks(shipping, withInstalls)).toEqual({
      installs,
      schemaVersion: 1,
      skillsVersion: '1.0.0',
      ship: shipping.ship,
    })
  })

  Test('preserves a newer installed skills version against a stale lock snapshot', async () => {
    const root = await mkTestDir('tao-ship-lock-skills-')
    try {
      await writeProjectLock(root, { schemaVersion: 1 })
      const path = FS.resolvePath('.tao/store/lock.jsonc', root)
      await FS.writeText(path, '{"schemaVersion":1,"skillsVersion":"2.0.0"}\n')
      await writeProjectLock(root, {
        schemaVersion: 1,
        skillsVersion: '1.0.0',
        toolchain: { version: '9.9.9' },
      })
      const result = await readProjectLock(root)
      Expect(result.skillsVersion).toBe('2.0.0')
      Expect(result.toolchain?.version).toBe('9.9.9')
    } finally {
      await FS.remove(root)
    }
  })
})
