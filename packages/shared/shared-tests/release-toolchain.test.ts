import { FS, ReleaseCapabilities, ReleaseToolchain } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('Project release toolchain compatibility', () => {
  Test('checks nested project pins against both bundled version and capability profile', async () => {
    const root = await mkTestDir('release-toolchain-')
    const project = FS.resolvePath('nested/project', root)
    const source = FS.resolvePath('Main.tao', project)
    const lock = FS.resolvePath('.tao-project/lock.jsonc', project)
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
    } finally {
      await FS.remove(root)
    }
  })
})
