import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { StandaloneBuild } from '../cli-src/standalone-build'
import { StandaloneResources } from '../cli-src/standalone-resources'

Describe('standalone resources', () => {
  Test('stages only registered Metro patches and pins their exact registered package versions', async () => {
    const root = await mkTestDir('tao-standalone-host-patches-')
    try {
      const hostRoot = FS.resolvePath('packages/apps/expo-host', root)
      const stagedHost = FS.resolvePath('staged-host', root)
      await FS.mkdir(stagedHost)
      const portableBun = FS.resolvePath('portable-bun', root)
      await FS.writeText(portableBun, '#!/bin/sh\nexit 0\n')
      await FS.chmod(portableBun, 0o755)
      await FS.writeJson(FS.resolvePath('package.json', root), {
        patchedDependencies: {
          'metro@0.84.5': 'patches/metro@0.84.5.patch',
          '@expo/metro-file-map@57.0.3': 'patches/@expo__metro-file-map@57.0.3.patch',
          'unrelated-tool@3.2.1': 'patches/unrelated-tool@3.2.1.patch',
        },
      })
      await FS.writeJson(FS.resolvePath('package.json', hostRoot), {
        name: 'tao-expo-host',
        version: '1.0.0',
        main: 'index.ts',
        dependencies: {
          metro: '^0.84.6',
          '@expo/metro-file-map': '^57.0.2',
          expo: 'workspace:*',
        },
      })
      await FS.writeJson(FS.resolvePath('tsconfig.json', stagedHost), {
        extends: '../../../../packages/tsconfig.base.json',
      })
      await FS.writeJson(FS.resolvePath('packages/tsconfig.base.json', root), {
        compilerOptions: { strict: true, paths: { '@repo/*': ['../*'] } },
      })
      for (
        const [name, version] of [
          ['metro', '0.84.6'],
          ['@expo/metro-file-map', '57.0.3'],
          ['typescript', '5.9.3'],
          ['@types/react', '19.0.0'],
        ]
      ) {
        await FS.writeJson(FS.resolvePath(`node_modules/${name}/package.json`, hostRoot), { name, version })
      }
      const patchContents = new Map([
        ['patches/metro@0.84.5.patch', 'metro patch bytes\n'],
        ['patches/@expo__metro-file-map@57.0.3.patch', 'Expo file map patch bytes\n'],
        ['patches/unrelated-tool@3.2.1.patch', 'unrelated patch bytes\n'],
      ])
      for (const [path, contents] of patchContents) {
        await FS.writeText(FS.resolvePath(path, root), contents)
      }

      await StandaloneBuild.makeHostInstallable(root, stagedHost, portableBun)

      const stagedManifest = await FS.readJson<{
        dependencies: Record<string, string>
        patchedDependencies: Record<string, string>
      }>(FS.resolvePath('package.json', stagedHost))
      Expect(stagedManifest.patchedDependencies).toEqual({
        'metro@0.84.5': 'patches/metro@0.84.5.patch',
        '@expo/metro-file-map@57.0.3': 'patches/@expo__metro-file-map@57.0.3.patch',
      })
      Expect(stagedManifest.dependencies).toMatchObject({ metro: '0.84.5', '@expo/metro-file-map': '57.0.3' })
      for (const [path, contents] of patchContents) {
        const stagedPath = FS.resolvePath(path, stagedHost)
        if (path.includes('unrelated-tool')) {
          Expect(await FS.exists(stagedPath)).toBe(false)
        } else {
          Expect(await FS.readText(stagedPath)).toBe(contents)
        }
      }
      Expect(await FS.readJson(FS.resolvePath('tsconfig.json', stagedHost))).toMatchObject({
        compilerOptions: { strict: true },
      })
    } finally {
      await FS.remove(root)
    }
  })

  Test('ships the licence texts that cover the runtime it carries into apps', async () => {
    for (const name of StandaloneResources.LICENSE_FILES) {
      Expect(await FS.isFile(FS.resolvePath(`../../../../${name}`, import.meta.dir))).toBe(true)
    }
    Expect(StandaloneResources.LICENSE_FILES).toContain('LICENSE-APP-EXCEPTION.md')
  })

  Test('unpacks the payload into a stamped tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'stdlib/@tao/ui/Views.tao': 'public view Text(Value text) { }\n' })

      Expect(await StandaloneResources.unpack(archive, directory)).toBe(directory)

      Expect(await FS.readText(FS.resolvePath('stdlib/@tao/ui/Views.tao', directory)))
        .toBe('public view Text(Value text) { }\n')
      // The name is the on-disk contract `TaoResources` probes for; an installed tree outlives a build.
      Expect(await FS.isFile(FS.resolvePath('.tao-resources', directory))).toBe(true)
    })
  })

  Test('keeps a tree already unpacked from the same payload', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'host/package.json': '{}\n' })
      await StandaloneResources.unpack(archive, directory)
      await FS.writeText(FS.resolvePath('host/_gen_tao-app/App.tsx', directory), 'generated\n')

      await StandaloneResources.unpack(archive, directory)

      Expect(await FS.readText(FS.resolvePath('host/_gen_tao-app/App.tsx', directory))).toBe('generated\n')
    })
  })

  // A binary rebuilt into the same directory must not read a stdlib the older build shipped.
  Test('replaces a tree unpacked from another payload and removes the old one', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      await StandaloneResources.unpack(await payload({ 'stdlib/@tao/ui/Old.tao': 'old\n' }), directory)

      await StandaloneResources.unpack(await payload({ 'stdlib/@tao/ui/New.tao': 'new\n' }), directory)

      Expect(await FS.exists(FS.resolvePath('stdlib/@tao/ui/Old.tao', directory))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('stdlib/@tao/ui/New.tao', directory))).toBe('new\n')
      // The resource directory and the one tree behind it; the earlier payload's tree is gone.
      Expect(await FS.listDir(root)).toHaveLength(2)
    })
  })

  // A first run that probes mid-replacement and finds nothing settles on `/$bunfs` for its whole run.
  Test('never leaves the resource directory missing while it replaces a tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const stamp = FS.resolvePath('.tao-resources', directory)
      await StandaloneResources.unpack(await payload({ 'stdlib/Package.tao': 'old\n' }), directory)
      const replacement = await payload({ 'stdlib/Package.tao': 'new\n' })

      let settled = false
      const replacing = StandaloneResources.unpack(replacement, directory).finally(() => {
        settled = true
      })
      const observed: boolean[] = []
      while (!settled) {
        observed.push(FS.existsSync(stamp))
        await new Promise(resolve => setImmediate(resolve))
      }
      await replacing

      Expect(await FS.readText(FS.resolvePath('stdlib/Package.tao', directory))).toBe('new\n')
      Expect(observed.length).toBeGreaterThan(0)
      Expect(observed.filter(present => !present)).toEqual([])
    })
  })

  // A shell completion and the command it completes are enough to start two first runs at once.
  // REMOVAL CANDIDATE: Replace the 32-start stress fixture only with a controlled losing publisher that preserves rename-race coverage.
  Test('lets concurrent first runs race to one complete tree', async () => {
    await withRoot(async root => {
      const directory = FS.resolvePath('resources', root)
      const archive = await payload({ 'modules/@tao/runtime/package.json': '{}\n' })

      // Enough runs that some usually lose the rename of their staging tree into place; with a
      // handful, each tends to find the tree already there and never reach it.
      const runs = Array.from({ length: 32 }, () => StandaloneResources.unpack(archive, directory))
      const results = await Promise.all(runs)

      Expect(new Set(results)).toEqual(new Set([directory]))
      Expect(await FS.readText(FS.resolvePath('modules/@tao/runtime/package.json', directory))).toBe('{}\n')
      Expect(await FS.listDir(root)).toHaveLength(2)
    })
  })

  Test('names the directory it could not unpack into', async () => {
    await withRoot(async root => {
      const blocker = FS.resolvePath('not-a-directory', root)
      await FS.writeText(blocker, '')
      const directory = FS.resolvePath('resources', blocker)

      await Expect(StandaloneResources.unpack(await payload({ 'stdlib/Package.tao': '' }), directory))
        .rejects.toThrow(`Tao could not unpack its resources into ${directory}`)
    })
  })
})

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-standalone-resources-')
  try {
    await run(root)
  } finally {
    await FS.remove(root)
  }
}

async function payload(files: Record<string, string>): Promise<Uint8Array> {
  return await new Bun.Archive(files, { compress: 'gzip' }).bytes()
}
