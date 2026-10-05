import { FS, ReleaseCapabilities, ReleaseToolchain } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Project release toolchain compatibility', () => {
  Test('stops at an unpinned nearest project instead of preparing or inheriting its parent', async () => {
    const root = await mkTestDir('release-toolchain-boundary-')
    const project = FS.resolvePath('nested/project', root)
    const source = FS.resolvePath('Main.tao', project)
    const lock = FS.resolvePath('.tao/store/lock.jsonc', root)
    const own = { version: '0.4.3', profile: ReleaseCapabilities.profile(3) }
    try {
      await FS.writeJson(lock, { toolchain: { version: '0.4.1' } })
      await FS.mkdir(FS.resolvePath('.tao', project))
      await FS.writeText(FS.resolvePath('.tao/.gitignore', project), 'private/\n')
      await FS.writeText(source, 'use Text from @tao/ui')
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'Studio', own)).resolves.toBeUndefined()
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'editor', own)).resolves.toBeUndefined()
      Expect(await FS.exists(FS.resolvePath('.tao/local', root))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.tao/cache', project))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('.tao/.gitignore', project))).toBe('private/\n')
      Expect(await FS.readJson(lock)).toEqual({ toolchain: { version: '0.4.1' } })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(root, 'editor', own)).rejects.toThrow(
        'This project pins Tao 0.4.1',
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('checks nested project pins against both bundled version and capability profile', async () => {
    const root = await mkTestDir('release-toolchain-')
    const project = FS.resolvePath('nested/project', root)
    const source = FS.resolvePath('Main.tao', project)
    const lock = FS.resolvePath('.tao/store/lock.jsonc', project)
    const own = { version: '0.4.3', profile: ReleaseCapabilities.profile(3) }
    try {
      await FS.writeText(source, 'Project Nested')
      await FS.writeJson(lock, { toolchain: { version: '0.4.1', releaseProfile: { phase: 1 } } })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'Studio', own)).rejects.toThrow(
        'This project pins Tao 0.4.1 phase 1, but this Studio bundles Tao 0.4.3 phase 3.',
      )
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(root, 'editor', own)).resolves.toBeUndefined()
      await FS.writeJson(lock, { toolchain: { version: '0.4.3', releaseProfile: { phase: 1 } } })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'editor', own)).rejects.toThrow('phase 1')
      await FS.writeJson(lock, {
        toolchain: { version: '0.4.3', releaseProfile: { phase: 3, fingerprint: 'stale-policy' } },
      })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'Studio', own)).rejects.toThrow(
        'matching Tao Studio release',
      )
      await FS.writeJson(lock, {
        toolchain: {
          version: '0.4.3',
          releaseProfile: { phase: 3, fingerprint: ReleaseCapabilities.fingerprint(own.profile) },
        },
      })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'Studio', own)).resolves.toBeUndefined()
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'editor')).rejects.toThrow('Tao development')
      await FS.writeJson(lock, { toolchain: { version: 'development' } })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'Studio')).resolves.toBeUndefined()
      await FS.writeText(lock, '{ "toolchain": { "version": "0.4.3" ')
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'editor', own)).rejects.toThrow(
        `The Tao project lock at ${lock} is not valid JSONC`,
      )
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(source, 'editor', own)).rejects.toThrow(
        'git restore .tao/store/lock.jsonc',
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('checks a main-era lock after its one-time move into the project store', async () => {
    const root = await mkTestDir('release-toolchain-old-lock-')
    try {
      const old = FS.resolvePath('.tao/lock.jsonc', root)
      const stored = FS.resolvePath('.tao/store/lock.jsonc', root)
      await FS.writeJson(old, { schemaVersion: 1, toolchain: { version: '0.4.1' } })
      await Expect(ReleaseToolchain.requireMatchingProjectRelease(root, 'editor', {
        version: '0.4.3',
        profile: ReleaseCapabilities.profile(3),
      })).rejects.toThrow('This project pins Tao 0.4.1')
      Expect(await FS.exists(old)).toBe(false)
      Expect(await FS.readJson(stored)).toMatchObject({ schemaVersion: 1, toolchain: { version: '0.4.1' } })
    } finally {
      await FS.remove(root)
    }
  })
})
