import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import * as ts from 'typescript'
import { hostModulePaths, ProjectHostModuleSession } from '../project-tooling-src/ProjectHostModules'
import { checkProjectTypeScript } from '../project-tooling-src/ProjectTypeScriptCheck'
import {
  ensureProjectTypeScriptConfig,
  findProjectRoot,
  writeProjectTypeScriptConfigUnderLock,
} from '../project-tooling-src/ProjectTypeScriptConfig'

const systemReadFileSlot = testOverrideSlot({
  read: () => ts.sys.readFile,
  write: value => {
    ts.sys.readFile = value
  },
})

const systemFileExistsSlot = testOverrideSlot({
  read: () => ts.sys.fileExists,
  write: value => {
    ts.sys.fileExists = value
  },
})

Describe('project TypeScript configuration', () => {
  Test('finds the nearest .tao marker, ignoring an ancestor tsconfig alone', async () => {
    const root = await mkTestDir('tao-project-config-root-', { location: 'host' })
    try {
      const child = FS.resolvePath('nested/project/src', root)
      await FS.mkdir(child)
      await FS.writeJson(FS.resolvePath('tsconfig.json', root), {})
      Expect(await findProjectRoot(FS.resolvePath('App.tao', child))).toBeUndefined()

      const project = FS.resolvePath('nested/project', root)
      await FS.mkdir(FS.resolvePath('.tao', project))
      Expect(await findProjectRoot(FS.resolvePath('App.tao', child))).toBe(project)
    } finally {
      await FS.remove(root)
    }
  })

  Test('creates the overlay once and leaves developer config edits intact', async () => {
    const root = await mkTestDir('tao-project-config-write-')
    try {
      await FS.mkdir(FS.resolvePath('.tao', root))
      const first = await ensureProjectTypeScriptConfig(root)
      Expect(first.diagnostics).toEqual([])
      Expect(first.changedOutputPaths).toEqual([first.baseConfigPath, first.rootConfigPath])
      Expect(await FS.readJson(first.rootConfigPath)).toEqual({ extends: './.tao/cache/typescript/tsconfig.json' })
      const base = await FS.readJson<{ compilerOptions: { rootDirs: string[]; noEmit: boolean }; include: string[] }>(
        first.baseConfigPath,
      )
      Expect(base.compilerOptions.rootDirs).toEqual(['../../..', '../../../.tao-ts'])
      Expect(base.compilerOptions.noEmit).toBe(true)
      Expect(base.include).toContain('../../../**/*.tsx')
      Expect(base.include).toContain('../../../.tao-ts/**/*.ts')

      const edited =
        '{\n  // developer-owned config\n  "extends": "./.tao/cache/typescript/tsconfig.json",\n  "compilerOptions": { "strict": false }\n}\n'
      await FS.writeText(first.rootConfigPath, edited)
      const second = await ensureProjectTypeScriptConfig(root)
      Expect(second.changedOutputPaths).toEqual([])
      Expect(await FS.readText(first.rootConfigPath)).toBe(edited)
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not turn a tsconfig-only directory into a Tao project', async () => {
    const root = await mkTestDir('tao-project-config-unmarked-')
    try {
      const rootConfig = FS.resolvePath('tsconfig.json', root)
      await FS.writeText(rootConfig, '{ "compilerOptions": { "strict": false } }\n')
      const result = await ensureProjectTypeScriptConfig(root)
      Expect(result.changedOutputPaths).toEqual([])
      Expect(result.diagnostics[0]?.message).toContain('No Tao project marker')
      Expect(await FS.readText(rootConfig)).toBe('{ "compilerOptions": { "strict": false } }\n')
      Expect(await FS.exists(result.baseConfigPath)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('native TypeScript resolves installed host exports while project and authored paths win', async () => {
    const fixture = await mkTestDir('tao-project-native-config-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const firstRoot = FS.resolvePath('first/node_modules', fixture)
      const secondRoot = FS.resolvePath('second/node_modules', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        "import { value } from 'tao-test-peer/extra'\nexport const output: number = value\n",
      )
      await FS.writeText(FS.resolvePath('unused/package.json', firstRoot), '{"name":"unused"}\n')
      await FS.writeText(
        FS.resolvePath('tao-test-peer/package.json', secondRoot),
        '{"name":"tao-test-peer","exports":{".":{"types":"./index.d.ts"},"./extra":{"types":"./lib/extra.d.ts"}}}\n',
      )
      await FS.writeText(FS.resolvePath('tao-test-peer/index.d.ts', secondRoot), 'export declare const value: number\n')
      await FS.writeText(
        FS.resolvePath('tao-test-peer/lib/extra.d.ts', secondRoot),
        'export declare const value: number\n',
      )
      const options = { hostModuleRoots: [firstRoot, secondRoot] }
      await ensureProjectTypeScriptConfig(root, options)
      Expect(nativeDiagnostics(root)).toEqual([])

      const projectPeer = FS.resolvePath('node_modules/tao-test-peer', root)
      await FS.writeText(
        FS.resolvePath('package.json', projectPeer),
        '{"name":"tao-test-peer","exports":{"./extra":{"types":"./extra.d.ts"}}}\n',
      )
      await FS.writeText(FS.resolvePath('extra.d.ts', projectPeer), 'export declare const value: string\n')
      await ensureProjectTypeScriptConfig(root, options)
      Expect(nativeDiagnostics(root).some(diagnostic => diagnostic.code === 2322)).toBe(true)

      await FS.writeText(FS.resolvePath('Override.ts', root), 'export const value: number = 1\n')
      await FS.writeText(
        FS.resolvePath('tsconfig.json', root),
        '{"extends":"./.tao/cache/typescript/tsconfig.json","compilerOptions":{"paths":{"tao-test-peer/extra":["./Override.ts"]}}}\n',
      )
      Expect(nativeDiagnostics(root)).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('host export resolution shares one refresh cache and observes later manifest changes', async () => {
    const fixture = await mkTestDir('tao-project-host-resolution-cache-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const firstRoot = FS.resolvePath('first/node_modules', fixture)
      const secondRoot = FS.resolvePath('second/node_modules', fixture)
      const firstPackage = FS.resolvePath('tao-cache-peer', firstRoot)
      const secondPackage = FS.resolvePath('tao-cache-peer', secondRoot)
      const options = { hostModuleRoots: [firstRoot, secondRoot] }
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeJson(FS.resolvePath('package.json', firstPackage), {
        name: 'tao-cache-peer',
        exports: {
          '.': { types: './types/index.d.ts' },
          './alpha': { types: './types/alpha.d.ts' },
          './stale': { types: './types/stale.d.ts' },
        },
      })
      await FS.writeText(FS.resolvePath('types/index.d.ts', firstPackage), 'export declare const value: number\n')
      await FS.writeText(FS.resolvePath('types/alpha.d.ts', firstPackage), 'export declare const value: number\n')
      await FS.writeJson(FS.resolvePath('package.json', secondPackage), {
        name: 'tao-cache-peer',
        exports: { './alpha': { types: './other.d.ts' } },
      })
      await FS.writeText(FS.resolvePath('other.d.ts', secondPackage), 'export declare const value: string\n')

      const packageManifest = FS.resolvePath('package.json', firstPackage)
      let manifestReads = 0
      const originalReadFile = ts.sys.readFile
      const restoreReadFile = systemReadFileSlot.install((path, encoding) => {
        if (FS.resolvePath(path) === packageManifest) {
          manifestReads += 1
        }
        return originalReadFile(path, encoding)
      })
      let initial: Record<string, string[]>
      try {
        initial = await hostModulePaths(root, options)
      } finally {
        restoreReadFile()
      }
      Expect(manifestReads).toBe(1)
      Expect(initial['tao-cache-peer']).toEqual([FS.resolvePath('types/index.d.ts', firstPackage)])
      Expect(initial['tao-cache-peer/alpha']).toEqual([FS.resolvePath('types/alpha.d.ts', firstPackage)])
      Expect(initial['tao-cache-peer/stale']).toBeUndefined()
      expectUncachedParity(initial, firstRoot, ['tao-cache-peer', 'tao-cache-peer/alpha', 'tao-cache-peer/stale'])

      await FS.writeJson(FS.resolvePath('package.json', firstPackage), {
        name: 'tao-cache-peer',
        exports: {
          './beta': { types: './types/beta-v2.d.ts' },
          './stale': { types: './types/stale.d.ts' },
          './new': { types: './types/new.d.ts' },
        },
      })
      await FS.writeText(FS.resolvePath('types/beta-v2.d.ts', firstPackage), 'export declare const value: number\n')
      await FS.writeText(FS.resolvePath('types/stale.d.ts', firstPackage), 'export declare const value: number\n')
      await FS.writeText(FS.resolvePath('types/new.d.ts', firstPackage), 'export declare const value: number\n')

      const changed = await hostModulePaths(root, options)
      Expect(changed['tao-cache-peer']).toBeUndefined()
      Expect(changed['tao-cache-peer/alpha']).toBeUndefined()
      Expect(changed['tao-cache-peer/beta']).toEqual([FS.resolvePath('types/beta-v2.d.ts', firstPackage)])
      Expect(changed['tao-cache-peer/stale']).toEqual([FS.resolvePath('types/stale.d.ts', firstPackage)])
      Expect(changed['tao-cache-peer/new']).toEqual([FS.resolvePath('types/new.d.ts', firstPackage)])
      expectUncachedParity(changed, firstRoot, [
        'tao-cache-peer',
        'tao-cache-peer/alpha',
        'tao-cache-peer/beta',
        'tao-cache-peer/stale',
        'tao-cache-peer/new',
      ])

      const projectPackage = FS.resolvePath('node_modules/tao-cache-peer', root)
      await FS.writeText(FS.resolvePath('package.json', projectPackage), '{"name":"tao-cache-peer"}\n')
      const withProjectInstall = await hostModulePaths(root, options)
      Expect(withProjectInstall['tao-cache-peer/beta']).toBeUndefined()
      await FS.remove(projectPackage)
      const withoutProjectInstall = await hostModulePaths(root, options, new Set(['tao-cache-peer']))
      Expect(withoutProjectInstall['tao-cache-peer/beta']).toBeUndefined()
      const withoutExclusion = await hostModulePaths(root, options, new Set())
      Expect(withoutExclusion['tao-cache-peer/beta']).toEqual([FS.resolvePath('types/beta-v2.d.ts', firstPackage)])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('retained host mappings audit distinct filesystem inputs and isolate returned aliases', async () => {
    const fixture = await mkTestDir('tao-project-watched-host-work-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const hostModulesRoot = FS.resolvePath('host/node_modules', fixture)
      const peer = FS.resolvePath('tao-watch-peer', hostModulesRoot)
      await FS.writeJson(FS.resolvePath('package.json', peer), {
        name: 'tao-watch-peer',
        exports: { '.': { types: './index.d.ts' }, './extra': { types: './extra.d.ts' } },
      })
      await FS.writeText(FS.resolvePath('index.d.ts', peer), 'export declare const value: number\n')
      await FS.writeText(FS.resolvePath('extra.d.ts', peer), 'export declare const value: number\n')
      const session = new ProjectHostModuleSession()
      const options = { hostModulesRoot }
      const calls: string[] = []
      const original = ts.sys.fileExists
      const restore = systemFileExistsSlot.install(path => {
        if (FS.pathIsWithin(path, fixture)) {
          calls.push(path)
        }
        return original(path)
      })
      try {
        const cold = await hostModulePaths(root, options, new Set(), session)
        const coldCalls = [...calls]
        Expect(cold['tao-watch-peer/extra']).toEqual([FS.resolvePath('extra.d.ts', peer)])
        Expect(coldCalls.length).toBeGreaterThan(new Set(coldCalls).size)
        cold['tao-watch-peer/extra']!.push('caller mutation')
        calls.length = 0
        const reused = await hostModulePaths(root, options, new Set(), session)
        Expect(reused['tao-watch-peer/extra']).toEqual([FS.resolvePath('extra.d.ts', peer)])
        Expect(calls.length).toBe(new Set(coldCalls).size)
        Expect(new Set(calls)).toEqual(new Set(coldCalls))
        reused['tao-watch-peer/extra']![0] = 'second caller mutation'
        Expect((await hostModulePaths(root, options, new Set(), session))['tao-watch-peer/extra'])
          .toEqual([FS.resolvePath('extra.d.ts', peer)])
        calls.length = 0
        session.clear()
        Expect(await hostModulePaths(root, options, new Set(), session)).toEqual(await hostModulePaths(root, options))
        Expect(calls.length).toBeGreaterThan(coldCalls.length)
      } finally {
        restore()
      }
    } finally {
      await FS.remove(fixture)
    }
  })

  Test(
    'watched host mappings invalidate absent targets, manifests, installs, exclusions, precedence, and symlinks',
    async () => {
      const fixture = await mkTestDir('tao-project-watched-host-inputs-', { location: 'host' })
      try {
        const root = FS.resolvePath('project', fixture)
        const firstRoot = FS.resolvePath('first/node_modules', fixture)
        const secondRoot = FS.resolvePath('second/node_modules', fixture)
        const first = FS.resolvePath('tao-watch-peer', firstRoot)
        const second = FS.resolvePath('tao-watch-peer', secondRoot)
        const session = new ProjectHostModuleSession()
        const options = { hostModuleRoots: [firstRoot, secondRoot] }
        const manifest = FS.resolvePath('package.json', first)
        await FS.writeJson(manifest, { name: 'tao-watch-peer', exports: { '.': { types: './absent.d.ts' } } })
        await FS.writeJson(FS.resolvePath('package.json', second), {
          name: 'tao-watch-peer',
          exports: { '.': { types: './second.d.ts' } },
        })
        await FS.writeText(FS.resolvePath('second.d.ts', second), 'export declare const value: string\n')
        const mapping = async (selected = options, excluded: ReadonlySet<string> = new Set()) => {
          const current = await hostModulePaths(root, selected, excluded, session)
          Expect(current).toEqual(await hostModulePaths(root, selected, excluded))
          return current
        }
        Expect((await mapping())['tao-watch-peer']).toBeUndefined()
        await FS.writeText(FS.resolvePath('absent.d.ts', first), 'export declare const value: number\n')
        Expect((await mapping())['tao-watch-peer']).toEqual([FS.resolvePath('absent.d.ts', first)])
        await FS.writeJson(manifest, {
          name: 'tao-watch-peer',
          exports: { '.': { types: './changed.d.ts' }, './new': { types: './new.d.ts' } },
        })
        await FS.writeText(FS.resolvePath('changed.d.ts', first), 'export declare const value: number\n')
        await FS.writeText(FS.resolvePath('new.d.ts', first), 'export declare const value: number\n')
        Expect((await mapping())['tao-watch-peer']).toEqual([FS.resolvePath('changed.d.ts', first)])
        Expect((await mapping())['tao-watch-peer/new']).toEqual([FS.resolvePath('new.d.ts', first)])
        const projectInstall = FS.resolvePath('node_modules/tao-watch-peer', root)
        await FS.mkdir(projectInstall)
        Expect((await mapping())['tao-watch-peer']).toBeUndefined()
        await FS.remove(projectInstall)
        Expect((await mapping(options, new Set(['tao-watch-peer'])))['tao-watch-peer']).toBeUndefined()
        Expect((await mapping())['tao-watch-peer']).toEqual([FS.resolvePath('changed.d.ts', first)])
        Expect((await mapping({ hostModuleRoots: [secondRoot, firstRoot] }))['tao-watch-peer'])
          .toEqual([FS.resolvePath('second.d.ts', second)])
        await FS.writeText(FS.resolvePath('aaa-new-peer/package.json', firstRoot), '{"name":"aaa-new-peer"}\n')
        Expect((await mapping())['tao-watch-peer']).toEqual([FS.resolvePath('changed.d.ts', first)])
        await FS.remove(manifest)
        Expect((await mapping())['tao-watch-peer']).toEqual([FS.resolvePath('second.d.ts', second)])

        const targetA = FS.resolvePath('linked-a', fixture)
        const targetB = FS.resolvePath('linked-b', fixture)
        const linked = FS.resolvePath('tao-linked-peer', firstRoot)
        for (const target of [targetA, targetB]) {
          await FS.writeJson(FS.resolvePath('package.json', target), {
            name: 'tao-linked-peer',
            exports: { '.': { types: './index.d.ts' } },
          })
          await FS.writeText(FS.resolvePath('index.d.ts', target), 'export declare const value: number\n')
        }
        await FS.symlink(targetA, linked)
        Expect((await mapping())['tao-linked-peer']).toEqual([FS.resolvePath('index.d.ts', targetA)])
        await FS.replaceSymlink(targetB, linked)
        Expect((await mapping())['tao-linked-peer']).toEqual([FS.resolvePath('index.d.ts', targetB)])
      } finally {
        await FS.remove(fixture)
      }
    },
  )

  Test('unstable host observations and failed audits fall back to authoritative resolution', async () => {
    const fixture = await mkTestDir('tao-project-watched-host-unstable-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const hostModulesRoot = FS.resolvePath('host/node_modules', fixture)
      const peer = FS.resolvePath('tao-watch-peer', hostModulesRoot)
      const manifest = FS.resolvePath('package.json', peer)
      await FS.writeJson(manifest, { name: 'tao-watch-peer', types: './index.d.ts' })
      await FS.writeText(FS.resolvePath('index.d.ts', peer), 'export declare const value: number\n')
      const options = { hostModulesRoot }
      const session = new ProjectHostModuleSession()
      const original = ts.sys.fileExists
      let calls = 0
      const restore = systemFileExistsSlot.install(path => {
        if (path === manifest) {
          calls += 1
          if (calls > 1) {
            return false
          }
        }
        return original(path)
      })
      try {
        const unstable = await hostModulePaths(root, options, new Set(), session)
        Expect(unstable['tao-watch-peer']).toEqual([FS.resolvePath('index.d.ts', peer)])
        Expect(calls).toBeGreaterThan(1)
        // A guard would now match the last (false) value. The inconsistent construction
        // must never have been retained: cold enumeration skips the missing manifest.
        Expect((await hostModulePaths(root, options, new Set(), session))['tao-watch-peer']).toBeUndefined()
      } finally {
        restore()
      }
      const stable = await hostModulePaths(root, options, new Set(), session)
      const restoreFailingGuard = systemFileExistsSlot.install(path => {
        if (path === manifest) {
          throw new TypeError('fixture host unavailable')
        }
        return original(path)
      })
      try {
        await Expect(hostModulePaths(root, options, new Set(), session)).rejects.toThrow('fixture host unavailable')
      } finally {
        restoreFailingGuard()
      }
      Expect(await hostModulePaths(root, options, new Set(), session)).toEqual(stable)
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('native generated config resolves checkout React Native and runtime imports like the checker', async () => {
    const fixture = await mkTestDir('tao-project-native-runtime-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const checkout = FS.resolvePath('../../../..', import.meta.dir)
      const runtimeRoot = FS.resolvePath('packages/apps/runtime', checkout)
      const hostRoot = FS.resolvePath('packages/apps/expo-host/node_modules', checkout)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(
        FS.resolvePath('Main.ts', root),
        "import TR from '@tao/runtime'\nimport type { ViewProps } from 'react-native'\nexport const runtime = TR\nexport type Props = ViewProps\n",
      )
      const options = { runtimeRoot, hostModuleRoots: [hostRoot] }
      await ensureProjectTypeScriptConfig(root, options)
      const native = nativeDiagnostics(root)
      const checked = await checkProjectTypeScript(root, [], [], [], options)
      Expect(native.filter(diagnostic => diagnostic.code === 2307 || diagnostic.code === 7016)).toEqual([])
      Expect(checked.filter(diagnostic => diagnostic.code === 'TS2307' || diagnostic.code === 'TS7016')).toEqual([])
    } finally {
      await FS.remove(fixture)
    }
  })

  Test('omits host aliases reserved for a selected dependency’s private install', async () => {
    const fixture = await mkTestDir('tao-project-private-paths-', { location: 'host' })
    try {
      const root = FS.resolvePath('project', fixture)
      const hostModulesRoot = FS.resolvePath('host/node_modules', fixture)
      await FS.mkdir(FS.resolvePath('.tao', root))
      await FS.writeText(FS.resolvePath('util/package.json', hostModulesRoot), '{"name":"util","types":"index.d.ts"}\n')
      await FS.writeText(FS.resolvePath('util/index.d.ts', hostModulesRoot), 'export declare const value: number\n')
      await FS.writeText(
        FS.resolvePath('other/package.json', hostModulesRoot),
        '{"name":"other","types":"index.d.ts"}\n',
      )
      await FS.writeText(FS.resolvePath('other/index.d.ts', hostModulesRoot), 'export declare const value: number\n')

      const result = await writeProjectTypeScriptConfigUnderLock(
        root,
        { hostModuleRoots: [hostModulesRoot] },
        new Set(['util']),
      )
      const base = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(result.baseConfigPath)
      Expect(base.compilerOptions.paths['util']).toBeUndefined()
      Expect(base.compilerOptions.paths['other']).toEqual([FS.resolvePath('other/index.d.ts', hostModulesRoot)])
    } finally {
      await FS.remove(fixture)
    }
  })
})

function nativeDiagnostics(root: string): readonly ts.Diagnostic[] {
  const configPath = FS.resolvePath('tsconfig.json', root)
  const read = ts.readConfigFile(configPath, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root, undefined, configPath)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
}

function expectUncachedParity(
  paths: Record<string, string[]>,
  nodeModulesRoot: string,
  specifiers: readonly string[],
): void {
  const containingFile = FS.resolvePath('__tao_host_resolution__.ts', FS.dirname(nodeModulesRoot))
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }
  for (const specifier of specifiers) {
    const resolved = ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule?.resolvedFileName
    Expect(paths[specifier]).toEqual(resolved === undefined ? undefined : [resolved])
  }
}
