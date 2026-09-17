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

  Test('reads the exact iOS launch bundle and assets Expo declared in export metadata', async () => {
    const exportRoot = await mkTestDir('tao-update-export-')
    const bundle = '_expo/static/js/ios/App-abc.hbc'
    await FS.writeFile(FS.resolvePath(bundle, exportRoot), new Uint8Array([1, 2, 3]))
    await FS.writeFile(FS.resolvePath('assets/packager-image-hash', exportRoot), new Uint8Array([4, 5]))
    await FS.writeText(FS.resolvePath('unreferenced.json', exportRoot), '{}')
    await FS.writeJson(FS.resolvePath('metadata.json', exportRoot), {
      bundler: 'metro',
      fileMetadata: {
        ios: {
          assets: [{ ext: 'png', path: 'assets/packager-image-hash' }],
          bundle,
        },
      },
      version: 0,
    })

    Expect(await Runtime.expoUpdateArtifacts(exportRoot, 'ios')).toEqual({
      assets: [{
        contentType: 'image/png',
        fileExtension: '.png',
        key: 'packager-image-hash',
        path: FS.resolvePath('assets/packager-image-hash', exportRoot),
      }],
      launchAsset: {
        contentType: 'application/javascript',
        fileExtension: '.hbc',
        key: 'bundle',
        path: FS.resolvePath(bundle, exportRoot),
      },
    })
  })

  Test('rejects missing and escaping paths from Expo export metadata', async () => {
    const exportRoot = await mkTestDir('tao-invalid-update-export-')
    await FS.writeJson(FS.resolvePath('metadata.json', exportRoot), {
      bundler: 'metro',
      fileMetadata: { ios: { assets: [], bundle: '../outside.hbc' } },
      version: 0,
    })

    await Expect(Runtime.expoUpdateArtifacts(exportRoot, 'ios')).rejects.toThrow(
      'Expo iOS update metadata names an invalid launch bundle',
    )
  })
})
