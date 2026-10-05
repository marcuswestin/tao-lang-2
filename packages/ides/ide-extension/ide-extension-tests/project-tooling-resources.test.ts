import { ProjectTooling } from '@project-tooling'
import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { stageProjectToolingResources } from '../ide-extension-src/resources/project-tooling-resources'

Describe('installed editor project resources', () => {
  Test('packages runtime, TypeScript libraries, and transitive peers as self-contained files', async () => {
    const root = await mkTestDir('tao-ide-resources-')
    try {
      const runtime = FS.resolvePath('runtime', root)
      const modules = FS.resolvePath('node_modules', root)
      const store = FS.resolvePath('store/node_modules', root)
      const output = FS.resolvePath('extension/_gen_ide-extension', root)
      const lib = FS.resolvePath('typescript/lib', root)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', runtime), 'export type Runtime = string\n')
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        name: 'tao-runtime',
        peerDependencies: { react: '1.0.0' },
      })
      await packageFixture(store, 'react', { scheduler: '1.0.0', unused: '1.0.0' })
      await packageFixture(store, 'scheduler')
      await packageFixture(store, 'unused')
      await packageFixture(store, '@types/react', { csstype: '1.0.0' })
      await packageFixture(store, '@types/node')
      await packageFixture(store, 'csstype')
      await FS.writeText(
        FS.resolvePath('react/index.d.ts', store),
        "export type react = string\nexport type { scheduler } from 'scheduler'\n",
      )
      await FS.writeText(FS.resolvePath('@types/react/index.d.ts', store), "export type { csstype } from 'csstype'\n")
      for (const name of ['react', 'scheduler', 'unused', '@types/react', '@types/node', 'csstype']) {
        await FS.symlink(FS.resolvePath(name, store), FS.resolvePath(name, modules))
      }
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), '/// <reference lib="es2022" />\n')
      await FS.writeText(FS.resolvePath('lib.es2022.d.ts', lib), 'interface Array<T> {}\n')

      await stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: FS.resolvePath('stdlib', root) },
        typescriptLibRoot: lib,
        outputRoot: output,
      })

      Expect(await FS.readText(FS.resolvePath('runtime/TaoRuntime-src/TR.ts', output)))
        .toBe('export type Runtime = string\n')
      Expect(await FS.isFile(FS.resolvePath('extension/lib.es2022.full.d.ts', output))).toBe(true)
      for (const name of ['react', 'scheduler', '@types/react', '@types/node', 'csstype']) {
        const path = FS.resolvePath(`host/node_modules/${name}/index.d.ts`, output)
        Expect(await FS.isFile(path)).toBe(true)
        Expect(await FS.isSymbolicLink(FS.resolvePath(`host/node_modules/${name}`, output))).toBe(false)
      }
      Expect(await FS.exists(FS.resolvePath('host/node_modules/unused', output))).toBe(false)

      const project = FS.resolvePath('project', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', project), '')
      await FS.writeText(
        FS.resolvePath('Main.ts', project),
        "import type { react } from 'react'\nexport type Value = react\n",
      )
      const refreshed = await ProjectTooling.refresh(project, {
        runtimeRoot: FS.resolvePath('runtime', output),
        hostModulesRoot: FS.resolvePath('host/node_modules', output),
      })
      Expect(refreshed.status).toBe('fresh')
      Expect(refreshed.diagnostics).toEqual([])
      const config = await FS.readJson<{ extends: string }>(FS.resolvePath('tsconfig.json', project))
      Expect(config.extends).toBe('./.tao/cache/typescript/tsconfig.json')
      const base = await FS.readJson<{ compilerOptions: { paths: Record<string, string[]> } }>(
        FS.resolvePath('.tao/cache/typescript/tsconfig.json', project),
      )
      Expect(base.compilerOptions.paths['@tao/runtime'])
        .toEqual([FS.resolvePath('runtime/TaoRuntime-src/TR.ts', output)])
      Expect(base.compilerOptions.paths['react']?.[0]).toContain(FS.resolvePath('host/node_modules/react', output))
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a runtime peer found only in an ancestor install', async () => {
    const root = await mkTestDir('tao-ide-ancestor-peer-')
    try {
      const runtime = FS.resolvePath('app/runtime', root)
      const modules = FS.resolvePath('isolated/node_modules', root)
      const ancestorModules = FS.resolvePath('app/node_modules', root)
      const lib = FS.resolvePath('typescript/lib', root)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', runtime), 'export {}\n')
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        peerDependencies: { react: '1.0.0' },
      })
      await packageFixture(ancestorModules, 'react')
      await packageFixture(modules, '@types/react')
      await packageFixture(modules, '@types/node')
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), 'interface Array<T> {}\n')

      await Expect(stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: FS.resolvePath('stdlib', root) },
        typescriptLibRoot: lib,
        outputRoot: FS.resolvePath('extension/_gen_ide-extension', root),
      })).rejects.toThrow('outside the supplied install roots')
    } finally {
      await FS.remove(root)
    }
  })

  Test('checks sidecars against project npm subpaths before bundled fallbacks', async () => {
    const root = await mkTestDir('tao-ide-resource-check-')
    try {
      const runtime = FS.resolvePath('runtime', root)
      const modules = FS.resolvePath('node_modules', root)
      const lib = FS.resolvePath('typescript/lib', root)
      const output = FS.resolvePath('extension/_gen_ide-extension', root)
      const project = FS.resolvePath('project', root)
      await FS.writeText(
        FS.resolvePath('TaoRuntime-src/TR.ts', runtime),
        "export type HostValue = import('demo/value').Value\n",
      )
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        peerDependencies: { demo: '1.0.0' },
      })
      await packageFixture(modules, 'demo')
      await FS.writeJson(FS.resolvePath('demo/package.json', modules), {
        name: 'demo',
        exports: { '.': { types: './index.d.ts' }, './value': { types: './fallback.d.ts' } },
      })
      await FS.writeText(FS.resolvePath('demo/fallback.d.ts', modules), "export type Value = 'fallback'\n")
      await packageFixture(modules, '@types/react')
      await packageFixture(modules, '@types/node')
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), 'interface Array<T> {}\n')
      await stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: FS.resolvePath('stdlib', root) },
        typescriptLibRoot: lib,
        outputRoot: output,
      })
      Expect(await FS.isFile(FS.resolvePath('host/node_modules/demo/fallback.d.ts', output))).toBe(true)

      await FS.writeText(FS.resolvePath('.tao/.gitkeep', project), '')
      await FS.writeText(
        FS.resolvePath('Main.tao', project),
        `
app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Main }
action Read() returns text from ./Bindings.ts
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      await FS.writeJson(FS.resolvePath('node_modules/demo/package.json', project), {
        name: 'demo',
        exports: { '.': { types: './index.d.ts' }, './value': { types: './local.d.ts' } },
      })
      await FS.writeText(FS.resolvePath('node_modules/demo/index.d.ts', project), 'export {}\n')
      await FS.writeText(
        FS.resolvePath('node_modules/demo/local.d.ts', project),
        "export type Value = 'local'\n",
      )
      const binding = FS.resolvePath('Bindings.ts', project)
      await FS.writeText(binding, "import type { Value } from 'demo/value'\nexport const Read = (): Value => 'local'\n")
      const options = {
        runtimeRoot: FS.resolvePath('runtime', output),
        hostModulesRoot: FS.resolvePath('host/node_modules', output),
      }
      const valid = await ProjectTooling.refresh(project, options)
      Expect(valid.status).toBe('fresh')
      Expect(valid.diagnostics).toEqual([])

      await FS.writeText(binding, "import type { Value } from 'demo/value'\nexport const Read = (): number => 42\n")
      const invalid = await ProjectTooling.refresh(project, options)
      Expect(invalid.status).toBe('stale')
      Expect(invalid.diagnostics.some(diagnostic => diagnostic.message.includes('not assignable'))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects distinct type installs reached through native bindings', async () => {
    const root = await mkTestDir('tao-ide-resource-duplicate-')
    try {
      const runtime = FS.resolvePath('runtime', root)
      const modules = FS.resolvePath('node_modules', root)
      const stdlib = FS.resolvePath('stdlib', root)
      const nativeModules = FS.resolvePath('.tao-ts/native-bindings/photos/inputs/node_modules', stdlib)
      const lib = FS.resolvePath('typescript/lib', root)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', runtime), 'export type Runtime = string\n')
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        peerDependencies: { 'native-fixture': '1.0.0' },
      })
      await packageFixture(modules, '@types/react')
      await packageFixture(modules, '@types/node')
      await packageFixture(nativeModules, 'native-fixture')
      await packageFixture(nativeModules, '@types/react')
      await FS.writeJson(FS.resolvePath('@types/react/package.json', nativeModules), {
        name: '@types/react',
        version: '2.0.0',
        types: 'index.d.ts',
      })
      await FS.writeText(
        FS.resolvePath('native-fixture/index.d.ts', nativeModules),
        "export type Native = import('../@types/react').typesreact\n",
      )
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), 'interface Array<T> {}\n')

      await Expect(stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: stdlib },
        typescriptLibRoot: lib,
        outputRoot: FS.resolvePath('extension/_gen_ide-extension', root),
      })).rejects.toThrow('multiple installs of @types/react')
    } finally {
      await FS.remove(root)
    }
  })

  Test('checks a sidecar with the installed runtime SDK and a project npm override', async () => {
    const root = await mkTestDir('tao-ide-real-sdk-')
    try {
      const packageRoot = FS.resolvePath('..', import.meta.dir)
      const repositoryRoot = FS.resolvePath('../../..', packageRoot)
      const runtimeRoot = FS.resolvePath('packages/apps/runtime', repositoryRoot)
      const output = FS.resolvePath('extension/_gen_ide-extension', root)
      await stageProjectToolingResources({
        runtimeRoot,
        moduleRoots: [
          FS.resolvePath('node_modules', runtimeRoot),
          FS.resolvePath('packages/apps/expo-host/node_modules', repositoryRoot),
          FS.resolvePath('node_modules', repositoryRoot),
        ],
        typescriptLibRoot: FS.resolvePath(
          'packages/language/project-tooling/node_modules/typescript/lib',
          repositoryRoot,
        ),
        outputRoot: output,
      })

      const project = FS.resolvePath('project', root)
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', project), '')
      await FS.writeText(
        FS.resolvePath('Main.tao', project),
        `
app Demo { id "com.tao.demo" version "1.0.0" name "Demo" view Main }
action Read() returns text from ./Bindings.ts
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
      )
      await FS.writeJson(FS.resolvePath('node_modules/@noble/hashes/package.json', project), {
        name: '@noble/hashes',
        version: '99.0.0',
        exports: { './sha2.js': { types: './local.d.ts' } },
      })
      await FS.writeText(
        FS.resolvePath('node_modules/@noble/hashes/local.d.ts', project),
        "export type Value = 'local'\n",
      )
      const binding = FS.resolvePath('Bindings.ts', project)
      await FS.writeText(
        binding,
        "import type { Value } from '@noble/hashes/sha2.js'\nexport const Read = (): Value => 'local'\n",
      )
      const options = {
        runtimeRoot: FS.resolvePath('runtime', output),
        hostModulesRoot: FS.resolvePath('host/node_modules', output),
      }
      const valid = await ProjectTooling.refresh(project, options)
      Expect(valid.status).toBe('fresh')
      Expect(valid.diagnostics).toEqual([])

      await FS.writeText(binding, 'export const Read = (): number => 42\n')
      const invalid = await ProjectTooling.refresh(project, options)
      Expect(invalid.status).toBe('stale')
      Expect(invalid.diagnostics.some(diagnostic => diagnostic.message.includes('not assignable'))).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('finds peers in the requesting package install context', async () => {
    const root = await mkTestDir('tao-ide-resource-peers-')
    try {
      const runtime = FS.resolvePath('runtime', root)
      const modules = FS.resolvePath('node_modules', root)
      const installed = FS.resolvePath('.bun/icons/node_modules', modules)
      const lib = FS.resolvePath('typescript/lib', root)
      const output = FS.resolvePath('extension/_gen_ide-extension', root)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', runtime), 'export {}\n')
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        peerDependencies: { '@expo/vector-icons': '1.0.0' },
      })
      await packageFixture(installed, '@expo/vector-icons')
      await FS.writeJson(FS.resolvePath('@expo/vector-icons/package.json', installed), {
        name: '@expo/vector-icons',
        peerDependencies: { 'expo-font': '1.0.0' },
      })
      await packageFixture(installed, 'expo-font')
      await FS.writeText(FS.resolvePath('expo-font/index.d.ts', installed), 'export type InstalledFont = string\n')
      await FS.writeText(
        FS.resolvePath('@expo/vector-icons/index.d.ts', installed),
        "export type { InstalledFont } from 'expo-font'\n",
      )
      await packageFixture(modules, '@types/react')
      await packageFixture(modules, '@types/node')
      await FS.symlink(
        FS.resolvePath('@expo/vector-icons', installed),
        FS.resolvePath('@expo/vector-icons', modules),
      )
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), 'interface Array<T> {}\n')

      await stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: FS.resolvePath('stdlib', root) },
        typescriptLibRoot: lib,
        outputRoot: output,
      })

      const font = FS.resolvePath('host/node_modules/expo-font', output)
      Expect(await FS.readText(FS.resolvePath('index.d.ts', font))).toBe('export type InstalledFont = string\n')
      Expect(await FS.isSymbolicLink(font)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a package file symlink escaping its installed package', async () => {
    const root = await mkTestDir('tao-ide-resource-escape-')
    try {
      const runtime = FS.resolvePath('runtime', root)
      const modules = FS.resolvePath('node_modules', root)
      const lib = FS.resolvePath('typescript/lib', root)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', runtime), 'export {}\n')
      await FS.writeJson(FS.resolvePath('package.json', runtime), {
        peerDependencies: { react: '1.0.0' },
      })
      for (const name of ['react', '@types/react', '@types/node']) {
        await packageFixture(modules, name)
      }
      await FS.writeText(FS.resolvePath('secret.d.ts', root), 'export type Secret = string\n')
      await FS.symlink(FS.resolvePath('secret.d.ts', root), FS.resolvePath('react/leak.d.ts', modules))
      await FS.writeText(FS.resolvePath('react/index.d.ts', modules), "export type { Secret } from './leak'\n")
      await FS.writeText(FS.resolvePath('lib.es2022.full.d.ts', lib), 'interface Array<T> {}\n')

      await Expect(stageProjectToolingResources({
        runtimeRoot: runtime,
        moduleRoots: [modules],
        nativeBindings: { stdlibRoot: FS.resolvePath('stdlib', root) },
        typescriptLibRoot: lib,
        outputRoot: FS.resolvePath('extension/_gen_ide-extension', root),
      })).rejects.toThrow('resolved an unowned file')
    } finally {
      await FS.remove(root)
    }
  })
})

async function packageFixture(root: string, name: string, dependencies: Record<string, string> = {}): Promise<void> {
  await FS.writeJson(FS.resolvePath(`${name}/package.json`, root), {
    name,
    version: '1.0.0',
    types: 'index.d.ts',
    dependencies,
  })
  await FS.writeText(FS.resolvePath(`${name}/index.d.ts`, root), `export type ${name.replaceAll(/\W/g, '')} = string\n`)
}
