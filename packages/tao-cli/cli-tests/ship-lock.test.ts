import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  acceptedShipEntry,
  promoteShipEntry,
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
  Test('writes, reads, and promotes a suggestion without credential contents', async () => {
    const root = await mkTestDir('tao-ship-lock-')
    try {
      const accepted = promoteShipEntry(suggestion())
      const path = await writeProjectLock(root, putShipLockEntry({ schemaVersion: 1 }, accepted))
      const source = await FS.readText(path)
      Expect(source).toContain('"status": "accepted"')
      Expect(source).not.toContain('PRIVATE KEY')
      Expect(source).toContain('https://api.instantdb.com')
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
        FS.resolvePath('.tao-project/lock.jsonc', root),
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
})
