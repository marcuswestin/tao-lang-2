import { FS, readFirebaseConnections } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const connection = {
  apiKey: 'public-api-key',
  projectId: 'notes-project',
  appId: 'web-app',
  authDomain: 'notes.firebaseapp.com',
  storageBucket: 'notes.firebasestorage.app',
  messagingSenderId: '12345',
}

Describe('project-local Firebase connections', () => {
  Test('returns no override for a missing file and reads public fields from the canonical file', async () => {
    const root = await mkTestDir('tao-firebase-connections-')
    try {
      Expect(await readFirebaseConnections(root)).toBeUndefined()
      await FS.writeJson(FS.resolvePath('.tao/local/connections.json', root), {
        appwrite: { projectId: 'another-project' },
        firebase: connection,
      })
      Expect(await readFirebaseConnections(root)).toEqual(connection)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects stale, malformed, and unsupported Firebase settings without showing field values', async () => {
    const root = await mkTestDir('tao-firebase-invalid-')
    const path = FS.resolvePath('.tao/local/connections.json', root)
    try {
      await FS.writeText(path, '{broken')
      await Expect(readFirebaseConnections(root)).rejects.toThrow('must contain valid JSON')
      await FS.writeJson(path, { firebase: { ...connection, apiKey: '' } })
      await Expect(readFirebaseConnections(root)).rejects.toThrow('non-empty apiKey string')
      await FS.writeJson(path, { firebase: { ...connection, privateKey: 'do-not-print' } })
      await Expect(readFirebaseConnections(root)).rejects.toThrow('unsupported field')
      await Expect(readFirebaseConnections(root)).rejects.not.toThrow('do-not-print')
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses a symlink at any connection path component', async () => {
    const root = await mkTestDir('tao-firebase-symlink-')
    try {
      const actual = FS.resolvePath('actual.json', root)
      await FS.writeJson(actual, { firebase: connection })
      const link = FS.resolvePath('.tao/local/connections.json', root)
      await FS.symlink(actual, link)
      await Expect(readFirebaseConnections(root)).rejects.toThrow('must not be a symlink')
      await FS.remove(link)
      await FS.remove(FS.resolvePath('.tao/local', root))
      await FS.symlink(root, FS.resolvePath('.tao/local', root))
      await Expect(readFirebaseConnections(root)).rejects.toThrow('must not be a symlink')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports a file blocking the local directory instead of treating configuration as absent', async () => {
    const root = await mkTestDir('tao-firebase-blocked-path-')
    try {
      await FS.writeText(FS.resolvePath('.tao', root), 'not a directory')
      await Expect(readFirebaseConnections(root)).rejects.toThrow('must be a directory')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports an unreadable connection file instead of using authored placeholder values', async () => {
    const root = await mkTestDir('tao-firebase-unreadable-')
    const path = FS.resolvePath('.tao/local/connections.json', root)
    try {
      await FS.writeJson(path, { firebase: connection })
      await FS.chmod(path, 0o000)
      try {
        await Expect(readFirebaseConnections(root)).rejects.toThrow('could not be read')
      } finally {
        await FS.chmod(path, 0o600)
      }
    } finally {
      await FS.remove(root)
    }
  })
})
