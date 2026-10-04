import { managedDependencyModulesRoot } from '@project-tooling'
import { FS, ProjectLocal } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test } from '@shared/test'
import { withGeneratedModuleLinks } from '../expo-host-src/generated-module-links'
import { RuntimeToolchainPaths } from '../expo-host-src/runtime-toolchain-paths'

Describe('generated dependency modules', () => {
  Test('links host dependencies when no local npm environment is declared and repairs a removed link', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const link = FS.resolvePath('node_modules', output)
      const hostModules = RuntimeToolchainPaths.dependencyRoot()
      const publish = () => FS.writeText(FS.resolvePath('App.tsx', output), 'app')
      Expect(await FS.isFile(FS.resolvePath('react/package.json', hostModules))).toBe(true)

      await withGeneratedModuleLinks(output, root, [], publish)
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(hostModules)
      Expect(await FS.isFile(FS.resolvePath('react/package.json', link))).toBe(true)
      Expect(await FS.readJson(`${output}.tao-module-links.json`)).toEqual({
        version: 1,
        links: [{ relativePath: 'node_modules', target: hostModules }],
      })

      await withGeneratedModuleLinks(output, root, [], publish)
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(hostModules)
      await FS.remove(link)
      await withGeneratedModuleLinks(output, root, [], publish)
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(hostModules)
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses to replace an unowned generated host dependency path', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const occupied = FS.resolvePath('node_modules', output)
      await FS.writeText(occupied, 'private')
      await Expect(withGeneratedModuleLinks(output, root, [], async () => {}))
        .rejects.toThrow('Generated module link path is occupied')
      Expect(await FS.readText(occupied)).toBe('private')
      Expect(await FS.isFile(`${output}.tao-module-links.json`)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('serializes concurrent publication with the generated module link and its ownership manifest', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    const output = FS.resolvePath('host/_gen_tao-app', root)
    const link = FS.resolvePath('node_modules', output)
    const firstEntered = Deferred()
    const releaseFirst = Deferred()
    const secondEntered = Deferred()
    const releaseSecond = Deferred()
    let secondPublishing = false
    let firstRun: Promise<void> | undefined
    let secondRun: Promise<void> | undefined
    try {
      firstRun = withGeneratedModuleLinks(output, root, [], async () => {
        firstEntered.resolve()
        await releaseFirst.promise
        await FS.writeText(FS.resolvePath('App.tsx', output), 'first')
      })
      await Promise.race([firstEntered.promise, firstRun])
      secondRun = withGeneratedModuleLinks(output, root, [], async () => {
        secondPublishing = true
        secondEntered.resolve()
        await releaseSecond.promise
        await FS.writeText(FS.resolvePath('App.tsx', output), 'second')
      })

      const lockDirectory = ProjectLocal.cacheResolve('locks', root)
      const lockHeld = await FS.isDirectory(lockDirectory)
        && (await FS.listDir(lockDirectory)).some(name => name.endsWith('.tao-file-mutation.lock'))
      if (!lockHeld) {
        await Promise.race([secondEntered.promise, secondRun])
      }
      Expect(secondPublishing).toBe(false)

      releaseFirst.resolve()
      await firstRun
      releaseSecond.resolve()
      await secondRun
      Expect(await FS.readText(FS.resolvePath('App.tsx', output))).toBe('second')
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(RuntimeToolchainPaths.dependencyRoot())
      Expect(await FS.readJson(`${output}.tao-module-links.json`)).toEqual({
        version: 1,
        links: [{ relativePath: 'node_modules', target: RuntimeToolchainPaths.dependencyRoot() }],
      })
    } finally {
      releaseFirst.resolve()
      releaseSecond.resolve()
      await Promise.allSettled([firstRun, secondRun].filter((run): run is Promise<void> => run !== undefined))
      await FS.remove(root)
    }
  })

  Test('rejects incorrect direct dependency identity, range, and exact pin before publication', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const manifest = FS.resolvePath('node_modules/util/package.json', root)
      const environment = {
        projectRoot: root,
        namespace: 'root',
        npm: [
          { alias: 'util', packageName: 'real-util', versionRange: '^1' },
        ],
        publications: [],
      }
      let published = false
      const publish = async () => {
        published = true
      }
      await FS.writeJson(manifest, { name: 'wrong-util', version: '1.0.0' })
      await Expect(withGeneratedModuleLinks(output, root, [environment], publish))
        .rejects.toThrow('but real-util was declared')
      await FS.writeJson(manifest, { name: 'real-util', version: '2.0.0' })
      await Expect(withGeneratedModuleLinks(output, root, [environment], publish))
        .rejects.toThrow('requires ^1')
      await FS.writeJson(manifest, { name: 'real-util', version: '1.1.0' })
      await FS.writeJson(FS.resolvePath('.tao/store/lock.jsonc', root), {
        installs: {
          environments: {
            root: {
              projectRoot: '.',
              npm: {
                util: { name: 'real-util', requested: '^1', version: '1.0.0' },
              },
            },
          },
        },
      })
      await Expect(withGeneratedModuleLinks(output, root, [environment], publish))
        .rejects.toThrow('the Tao lock pins 1.0.0')
      Expect(published).toBe(false)
      Expect(await FS.exists(output)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rebuilds removed generated output while retaining its ownership manifest', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const modules = FS.resolvePath('node_modules', root)
      await FS.writeJson(FS.resolvePath('direct/package.json', modules), { name: 'direct', version: '1.0.0' })
      const environment = {
        projectRoot: root,
        namespace: 'root',
        npm: [
          { alias: 'direct', packageName: 'direct', versionRange: '^1' },
        ],
        publications: [],
      }
      const publish = () => FS.writeText(FS.resolvePath('App.tsx', output), 'app')
      await withGeneratedModuleLinks(output, root, [environment], publish)
      await FS.remove(output)
      Expect(await FS.isFile(`${output}.tao-module-links.json`)).toBe(true)
      await withGeneratedModuleLinks(output, root, [environment], publish)
      Expect(await FS.isFile(FS.resolvePath('App.tsx', output))).toBe(true)
      Expect((await FS.entryMetadata(FS.resolvePath('node_modules', output))).linkTarget).toBe(modules)
    } finally {
      await FS.remove(root)
    }
  })

  Test('isolates equal aliases by physical origin and prunes only owned links', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const aRoot = FS.resolvePath('A', root)
      const bRoot = FS.resolvePath('B', root)
      const aModules = managedDependencyModulesRoot(root, 'origin-a')
      const bModules = managedDependencyModulesRoot(root, 'origin-b')
      const rootModules = FS.resolvePath('node_modules', root)
      await FS.writeJson(FS.resolvePath('direct/package.json', rootModules), { name: 'direct', version: '3.0.0' })
      await FS.writeJson(FS.resolvePath('same/package.json', aModules), { name: 'same', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('same/package.json', bModules), { name: 'same', version: '2.0.0' })
      const direct = {
        projectRoot: root,
        namespace: 'root',
        npm: [
          { alias: 'direct', packageName: 'direct', versionRange: '^3' },
        ],
        publications: [],
      }
      const a = {
        projectRoot: aRoot,
        namespace: 'origin-a',
        npm: [
          { alias: 'same', packageName: 'same', versionRange: '^1' },
        ],
        publications: [],
      }
      const b = {
        projectRoot: bRoot,
        namespace: 'origin-b',
        npm: [
          { alias: 'same', packageName: 'same', versionRange: '^2' },
        ],
        publications: [],
      }
      await withGeneratedModuleLinks(output, root, [direct, a, b], async () => {
        await FS.writeText(FS.resolvePath('App.tsx', output), 'app')
      })
      const aLink = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      const bLink = FS.resolvePath('modules/dependencies/origin-b/node_modules', output)
      const directLink = FS.resolvePath('node_modules', output)
      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(rootModules)
      Expect((await FS.entryMetadata(aLink)).linkTarget).toBe(aModules)
      Expect((await FS.entryMetadata(bLink)).linkTarget).toBe(bModules)
      Expect(await FS.readJson<{ version: string }>(FS.resolvePath('same/package.json', aLink)))
        .toEqual({ name: 'same', version: '1.0.0' })
      Expect(await FS.readJson<{ version: string }>(FS.resolvePath('same/package.json', bLink)))
        .toEqual({ name: 'same', version: '2.0.0' })

      const staging = FS.resolvePath('staging', root)
      await FS.writeText(FS.resolvePath('App.tsx', staging), 'next app')
      await withGeneratedModuleLinks(output, root, [b], async () => {
        await FS.synchronizeDirectoryFileSets([{ fromPath: staging, toPath: output }], {
          boundaryPath: FS.resolvePath('host', root),
          sourceBoundaryPath: staging,
        })
      })
      Expect(await FS.isSymbolicLink(aLink)).toBe(false)
      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(RuntimeToolchainPaths.dependencyRoot())
      Expect(await FS.isSymbolicLink(bLink)).toBe(true)
      Expect(await FS.isFile(FS.resolvePath('same/package.json', aModules))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports missing installs and preserves a changed link', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const dependency = {
        projectRoot: FS.resolvePath('A', root),
        namespace: 'origin-a',
        npm: [
          { alias: 'same', packageName: 'same', versionRange: '^1' },
        ],
        publications: [],
      }
      await Expect(withGeneratedModuleLinks(output, root, [dependency], async () => {}))
        .rejects.toThrow('not installed in its private environment')
      const modules = managedDependencyModulesRoot(root, 'origin-a')
      await FS.writeJson(FS.resolvePath('same/package.json', modules), { name: 'same', version: '1.0.0' })
      await withGeneratedModuleLinks(output, root, [dependency], async () => {})
      const link = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      const foreign = FS.resolvePath('foreign', root)
      await FS.mkdir(foreign)
      await FS.replaceSymlink(foreign, link)
      await Expect(withGeneratedModuleLinks(output, root, [], async () => {}))
        .rejects.toThrow('was changed outside Tao')
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(foreign)
    } finally {
      await FS.remove(root)
    }
  })

  Test('links local and private environments to a durable override without claiming foreign links', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const requester = FS.resolvePath('snapshot/project', root)
      const durable = FS.resolvePath('artifact/dependencies', root)
      const output = FS.resolvePath('artifact/compiled/web/_gen_tao-app', root)
      const directModules = FS.resolvePath('node_modules', durable)
      const privateModules = managedDependencyModulesRoot(durable, 'origin-a')
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', requester), '')
      await FS.writeJson(FS.resolvePath('direct/package.json', directModules), { name: 'direct', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('private/package.json', privateModules), { name: 'private', version: '2.0.0' })
      const direct = {
        projectRoot: requester,
        namespace: 'root',
        npm: [
          { alias: 'direct', packageName: 'direct', versionRange: '^1' },
        ],
        publications: [],
      }
      const imported = {
        projectRoot: FS.resolvePath('snapshot/origin', root),
        namespace: 'origin-a',
        npm: [
          { alias: 'private', packageName: 'private', versionRange: '^2' },
        ],
        publications: [],
      }
      await withGeneratedModuleLinks(output, requester, [direct, imported], async () => {}, durable)
      const directLink = FS.resolvePath('node_modules', output)
      const privateLink = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(directModules)
      Expect((await FS.entryMetadata(privateLink)).linkTarget).toBe(privateModules)
      Expect(await FS.readJson(`${output}.tao-module-links.json`)).toEqual({
        version: 1,
        links: [
          { relativePath: 'node_modules', target: directModules },
          { relativePath: 'modules/dependencies/origin-a/node_modules', target: privateModules },
        ],
      })
      await FS.remove(FS.resolvePath('snapshot', root))
      Expect(await FS.exists(requester)).toBe(false)
      Expect(await FS.readJson(FS.resolvePath('direct/package.json', directLink))).toEqual({
        name: 'direct',
        version: '1.0.0',
      })
      Expect(await FS.readJson(FS.resolvePath('private/package.json', privateLink))).toEqual({
        name: 'private',
        version: '2.0.0',
      })

      const foreignLink = FS.resolvePath('modules/dependencies/foreign/node_modules', output)
      await FS.mkdir(FS.dirname(foreignLink))
      await FS.symlink(directModules, foreignLink)
      await withGeneratedModuleLinks(output, requester, [], async () => {}, durable)
      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(RuntimeToolchainPaths.dependencyRoot())
      Expect(await FS.isSymbolicLink(privateLink)).toBe(false)
      Expect((await FS.entryMetadata(foreignLink)).linkTarget).toBe(directModules)

      await Expect(withGeneratedModuleLinks(output, requester, [imported], async () => {
        await FS.symlink(directModules, privateLink)
      }, durable)).rejects.toThrow('Generated module link path is occupied')
      Expect((await FS.entryMetadata(privateLink)).linkTarget).toBe(directModules)
    } finally {
      await FS.remove(root)
    }
  })
})
