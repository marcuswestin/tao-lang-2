import { managedDependencyModulesRoot } from '@project-tooling'
import { FS, ProjectLocal } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, testOverrideSlot, Test } from '@shared/test'
import {
  generatedModuleLinkFileOperations,
  withGeneratedModuleLinks,
} from '../expo-host-src/generated-module-links'
import { RuntimeToolchainPaths } from '../expo-host-src/runtime-toolchain-paths'

type FileOperationCalls = { removals: string[]; symlinks: string[]; writes: string[] }
type MutableFileOperations = typeof generatedModuleLinkFileOperations

const removeSlot = testOverrideSlot<typeof generatedModuleLinkFileOperations.remove>({
  read: () => generatedModuleLinkFileOperations.remove,
  write: value => { (generatedModuleLinkFileOperations as MutableFileOperations).remove = value },
})
const symlinkSlot = testOverrideSlot<typeof generatedModuleLinkFileOperations.symlink>({
  read: () => generatedModuleLinkFileOperations.symlink,
  write: value => { (generatedModuleLinkFileOperations as MutableFileOperations).symlink = value },
})
const writeJsonSlot = testOverrideSlot<typeof generatedModuleLinkFileOperations.writeJson>({
  read: () => generatedModuleLinkFileOperations.writeJson,
  write: value => { (generatedModuleLinkFileOperations as MutableFileOperations).writeJson = value },
})

async function withFileOperationCalls<T>(
  run: (calls: FileOperationCalls) => Promise<T>,
  failWriteJsonPath?: string,
): Promise<T> {
  const calls: FileOperationCalls = { removals: [], symlinks: [], writes: [] }
  const baseRemove = generatedModuleLinkFileOperations.remove
  const baseSymlink = generatedModuleLinkFileOperations.symlink
  const baseWriteJson = generatedModuleLinkFileOperations.writeJson
  const restoreRemove = removeSlot.install(async path => {
    calls.removals.push(path)
    return baseRemove(path)
  })
  const restoreSymlink = symlinkSlot.install(async (target, path) => {
    calls.symlinks.push(path)
    return baseSymlink(target, path)
  })
  const restoreWriteJson = writeJsonSlot.install(async (path, content, options) => {
    calls.writes.push(path)
    if (path === failWriteJsonPath) {
      throw new TypeError('simulated manifest write failure')
    }
    return baseWriteJson(path, content, options)
  })
  try {
    return await run(calls)
  } finally {
    restoreWriteJson()
    restoreSymlink()
    restoreRemove()
  }
}

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

      const generatedManifest = `${output}.tao-module-links.json`
      const calls = await withFileOperationCalls(async observed => {
        await withGeneratedModuleLinks(
          output,
          root,
          [],
          () => FS.writeText(FS.resolvePath('App.tsx', output), 'next app'),
          root,
          { preserveUnchangedLinks: true },
        )
        return observed
      })
      Expect(await FS.readText(FS.resolvePath('App.tsx', output))).toBe('next app')
      Expect(calls.removals.filter(path => path === link)).toEqual([])
      Expect(calls.symlinks.filter(path => path === link)).toEqual([])
      Expect(calls.writes.filter(path => path === generatedManifest)).toEqual([])
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(hostModules)
      await FS.remove(link)
      await withGeneratedModuleLinks(output, root, [], publish, root, { preserveUnchangedLinks: true })
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

      const operations = await withFileOperationCalls(async calls => {
        await withGeneratedModuleLinks(
          output,
          root,
          [b],
          () => FS.writeText(FS.resolvePath('App.tsx', output), 'next app'),
          root,
          { preserveUnchangedLinks: true },
        )
        return calls
      })
      Expect(await FS.isSymbolicLink(aLink)).toBe(false)
      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(RuntimeToolchainPaths.dependencyRoot())
      Expect(await FS.isSymbolicLink(bLink)).toBe(true)
      Expect(operations.removals).not.toContain(bLink)
      Expect(operations.symlinks).not.toContain(bLink)
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
      await Expect(withGeneratedModuleLinks(output, root, [], async () => {}, root, { preserveUnchangedLinks: true }))
        .rejects.toThrow('was changed outside Tao')
      Expect((await FS.entryMetadata(link)).linkTarget).toBe(foreign)
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores removed links after publication failure without touching retained links', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const aModules = managedDependencyModulesRoot(root, 'origin-a')
      const bModules = managedDependencyModulesRoot(root, 'origin-b')
      await FS.writeJson(FS.resolvePath('alpha/package.json', aModules), { name: 'alpha', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('beta/package.json', bModules), { name: 'beta', version: '1.0.0' })
      const a = {
        projectRoot: FS.resolvePath('A', root),
        namespace: 'origin-a',
        npm: [{ alias: 'alpha', packageName: 'alpha', versionRange: '^1' }],
        publications: [],
      }
      const b = {
        projectRoot: FS.resolvePath('B', root),
        namespace: 'origin-b',
        npm: [{ alias: 'beta', packageName: 'beta', versionRange: '^1' }],
        publications: [],
      }
      await withGeneratedModuleLinks(output, root, [a, b], async () => {})

      const aLink = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      const bLink = FS.resolvePath('modules/dependencies/origin-b/node_modules', output)
      const aTarget = (await FS.entryMetadata(aLink)).linkTarget
      const bTarget = (await FS.entryMetadata(bLink)).linkTarget
      const operations = await withFileOperationCalls(async calls => {
        await Expect(withGeneratedModuleLinks(
          output,
          root,
          [b],
          async () => { throw new TypeError('publication failed') },
          root,
          { preserveUnchangedLinks: true },
        )).rejects.toThrow('publication failed')
        return calls
      })

      Expect((await FS.entryMetadata(aLink)).linkTarget).toBe(aTarget)
      Expect((await FS.entryMetadata(bLink)).linkTarget).toBe(bTarget)
      Expect(operations.removals).toContain(aLink)
      Expect(operations.symlinks).toContain(aLink)
      Expect(operations.removals).not.toContain(bLink)
      Expect(operations.symlinks).not.toContain(bLink)
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores removed links and retained links after manifest write failure', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const directModules = FS.resolvePath('node_modules', root)
      const aModules = managedDependencyModulesRoot(root, 'origin-a')
      const bModules = managedDependencyModulesRoot(root, 'origin-b')
      const cModules = managedDependencyModulesRoot(root, 'origin-c')
      await FS.writeJson(FS.resolvePath('local/package.json', directModules), { name: 'local', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('alpha/package.json', aModules), { name: 'alpha', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('beta/package.json', bModules), { name: 'beta', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('gamma/package.json', cModules), { name: 'gamma', version: '1.0.0' })
      const local = {
        projectRoot: root,
        namespace: 'root',
        npm: [{ alias: 'local', packageName: 'local', versionRange: '^1' }],
        publications: [],
      }
      const a = {
        projectRoot: FS.resolvePath('A', root),
        namespace: 'origin-a',
        npm: [{ alias: 'alpha', packageName: 'alpha', versionRange: '^1' }],
        publications: [],
      }
      const b = {
        projectRoot: FS.resolvePath('B', root),
        namespace: 'origin-b',
        npm: [{ alias: 'beta', packageName: 'beta', versionRange: '^1' }],
        publications: [],
      }
      const c = {
        projectRoot: FS.resolvePath('C', root),
        namespace: 'origin-c',
        npm: [{ alias: 'gamma', packageName: 'gamma', versionRange: '^1' }],
        publications: [],
      }
      await withGeneratedModuleLinks(output, root, [local, a, b], async () => {})

      const manifest = `${output}.tao-module-links.json`
      const directLink = FS.resolvePath('node_modules', output)
      const aLink = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      const bLink = FS.resolvePath('modules/dependencies/origin-b/node_modules', output)
      const cLink = FS.resolvePath('modules/dependencies/origin-c/node_modules', output)
      const targets = {
        direct: (await FS.entryMetadata(directLink)).linkTarget,
        a: (await FS.entryMetadata(aLink)).linkTarget,
        b: (await FS.entryMetadata(bLink)).linkTarget,
      }
      const operations = await withFileOperationCalls(async calls => {
        await Expect(withGeneratedModuleLinks(
          output,
          root,
          [local, b, c],
          async () => {},
          root,
          { preserveUnchangedLinks: true },
        )).rejects.toThrow('simulated manifest write failure')
        return calls
      }, manifest)

      Expect((await FS.entryMetadata(directLink)).linkTarget).toBe(targets.direct)
      Expect((await FS.entryMetadata(aLink)).linkTarget).toBe(targets.a)
      Expect((await FS.entryMetadata(bLink)).linkTarget).toBe(targets.b)
      Expect(await FS.isSymbolicLink(cLink)).toBe(false)
      Expect(operations.writes).toContain(manifest)
      Expect(operations.removals).toContain(cLink)
      Expect(operations.symlinks).toContain(cLink)
      Expect(operations.symlinks).toContain(aLink)
      for (const retainedLink of [directLink, bLink]) {
        Expect(operations.removals).not.toContain(retainedLink)
        Expect(operations.symlinks).not.toContain(retainedLink)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('restores removed owned links after install failure and leaves retained links untouched', async () => {
    const root = await mkTestDir('tao-generated-dependencies-')
    try {
      const output = FS.resolvePath('host/_gen_tao-app', root)
      const modules = FS.resolvePath('node_modules', root)
      const dependency = (namespace: string, alias: string) => {
        const dependencyModules = managedDependencyModulesRoot(root, namespace)
        return {
          environment: {
            projectRoot: FS.resolvePath(namespace, root),
            namespace,
            npm: [{ alias, packageName: alias, versionRange: '^1' }],
            publications: [],
          },
          dependencyModules,
        }
      }
      const a = dependency('origin-a', 'alpha')
      const b = dependency('origin-b', 'beta')
      const c = dependency('origin-c', 'gamma')
      await FS.writeJson(FS.resolvePath('alpha/package.json', a.dependencyModules), { name: 'alpha', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('beta/package.json', b.dependencyModules), { name: 'beta', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('gamma/package.json', c.dependencyModules), { name: 'gamma', version: '1.0.0' })
      await FS.writeJson(FS.resolvePath('local/package.json', modules), { name: 'local', version: '1.0.0' })
      const local = {
        projectRoot: root,
        namespace: 'root',
        npm: [{ alias: 'local', packageName: 'local', versionRange: '^1' }],
        publications: [],
      }
      await withGeneratedModuleLinks(output, root, [local, a.environment, b.environment], async () => {})

      const aLink = FS.resolvePath('modules/dependencies/origin-a/node_modules', output)
      const bLink = FS.resolvePath('modules/dependencies/origin-b/node_modules', output)
      const cLink = FS.resolvePath('modules/dependencies/origin-c/node_modules', output)
      const foreign = FS.resolvePath('foreign', root)
      await FS.mkdir(foreign)
      await FS.mkdir(FS.dirname(cLink))
      await FS.symlink(foreign, cLink)
      const previousATarget = (await FS.entryMetadata(aLink)).linkTarget
      const previousBTarget = (await FS.entryMetadata(bLink)).linkTarget

      await Expect(withGeneratedModuleLinks(
        output,
        root,
        [local, b.environment, c.environment],
        async () => {},
        root,
        { preserveUnchangedLinks: true },
      ))
        .rejects.toThrow('Generated module link path is occupied')
      Expect((await FS.entryMetadata(aLink)).linkTarget).toBe(previousATarget)
      Expect((await FS.entryMetadata(bLink)).linkTarget).toBe(previousBTarget)
      Expect((await FS.entryMetadata(cLink)).linkTarget).toBe(foreign)
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
