import Runtime from '@runtime-toolchain'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('release bundle proof', () => {
  Test('accepts exported native bundles without the Studio preview marker', async () => {
    const exportRoot = await mkTestDir('tao-release-bundle-')
    await FS.writeText(FS.resolvePath('_expo/static/js/ios/App.js', exportRoot), 'console.log("release")')

    const proof = await Runtime.proveReleaseBundle(exportRoot)

    Expect(proof.bundleFiles).toEqual([FS.resolvePath('_expo/static/js/ios/App.js', exportRoot)])
    Expect(proof.studioMarker).toBe('taoStudioParentOrigin')
  })

  Test('uses a deliberate preview bundle as the positive control', async () => {
    const exportRoot = await mkTestDir('tao-preview-bundle-')
    await FS.writeText(
      FS.resolvePath('_expo/static/js/ios/App.js', exportRoot),
      'const parentOrigin = params.get("taoStudioParentOrigin")',
    )

    await Expect(Runtime.proveReleaseBundle(exportRoot)).rejects.toThrow(
      'release bundle excludes Tao Studio modules',
    )
  })

  Test('refuses an empty export so absence cannot pass vacuously', async () => {
    const exportRoot = await mkTestDir('tao-empty-bundle-')

    await Expect(Runtime.proveReleaseBundle(exportRoot)).rejects.toThrow(
      'release export contains a JavaScript or Hermes bundle',
    )
  })
})
