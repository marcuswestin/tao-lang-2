import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type TR from 'tao-runtime/TR'

type RuntimeManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, string>
  files?: string[]
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
  version?: string
}

const runtimePackageRoot = FS.resolvePath('..', import.meta.dir)
const runtimeToolchainPackageRoot = FS.resolvePath('../runtime-toolchain', runtimePackageRoot)
const frameworkPackages = ['react', 'react-native', 'react-native-safe-area-context'] as const

function providerPackageFixture(): TR.DataProvider {
  let snapshot: string | undefined
  return {
    connect: () => ({
      load: () => snapshot,
      save: value => {
        snapshot = value
      },
    }),
  }
}

Describe('tao-runtime package boundary', () => {
  Test('packages the generated-code runtime and host-neutral core surfaces', async () => {
    const manifest = await FS.readJson<RuntimeManifest>(FS.resolvePath('package.json', runtimePackageRoot))

    Expect(manifest.private).toBe(true)
    Expect(manifest.version).toBeUndefined()
    Expect(manifest.files).toEqual(['TaoRuntime-src'])
    Expect(manifest.exports).toEqual({
      '.': './TaoRuntime-src/TR.ts',
      './TR': './TaoRuntime-src/TR.ts',
      './core': './TaoRuntime-src/core/Effects.ts',
    })
    const packagedDependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }
    const allDependencies = {
      ...packagedDependencies,
      ...manifest.devDependencies,
    }
    Expect(Object.values(allDependencies).some(version => version.startsWith('workspace:'))).toBe(false)
    Expect(Object.keys(packagedDependencies).some(name => name.startsWith('tao-'))).toBe(false)
  })

  Test('does not import Tao toolchain packages', async () => {
    const sourceRoot = FS.resolvePath('TaoRuntime-src', runtimePackageRoot)
    const forbiddenAliasImport =
      /(?:from\s+|import\(|require\()\s*['"]@(?:ast-utils|compiler|formatter|parser|runtime-toolchain|shared|source-actions|validator|workspace)(?:\/|['"])/
    const forbiddenPackageImport = /(?:from\s+|import\(|require\()\s*['"]tao-[^'"]+['"]/

    for await (const path of FS.walk(sourceRoot, { extensions: ['.ts', '.tsx'] })) {
      const source = await FS.readText(path)
      Expect(source).not.toMatch(forbiddenAliasImport)
      Expect(source).not.toMatch(forbiddenPackageImport)
    }
  })

  Test('uses the Expo host framework versions for local runtime development', async () => {
    const runtimeManifest = await FS.readJson<RuntimeManifest>(FS.resolvePath('package.json', runtimePackageRoot))
    const hostManifest = await FS.readJson<RuntimeManifest>(
      FS.resolvePath('package.json', runtimeToolchainPackageRoot),
    )

    for (const packageName of frameworkPackages) {
      Expect(runtimeManifest.devDependencies?.[packageName]).toBe(hostManifest.dependencies?.[packageName])
    }
  })

  Test('exports the provider protocol through the runtime TR subpath', async () => {
    const provider = providerPackageFixture()
    const connection = provider.connect({
      configuration: {},
      schema: { entities: {}, name: 'PackageFixture' },
      storageKey: 'demo',
    })

    await connection.save('{"provider":"third-party"}')

    Expect(await connection.load()).toBe('{"provider":"third-party"}')
  })
})
