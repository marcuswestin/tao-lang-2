import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import ts from 'typescript'
import { PROJECT_TSCONFIG, TaoAppModules } from '../cli-src/app-modules'

const PINNED_PROJECT_TSCONFIG = `{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx",
    "lib": [
      "DOM",
      "ES2023"
    ],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "paths": {
      "@tao/*": [
        "./node_modules/@tao/*"
      ],
      "@tao/runtime": [
        "./node_modules/@tao/runtime/TaoRuntime-src/TR.ts"
      ]
    },
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": [
    "**/*.ts",
    "**/*.tsx"
  ]
}
`

Describe('Tao app TypeScript modules', () => {
  Test('bundles @tao/runtime as a live link to the runtime package', async () => {
    Expect(await FS.realPath(TaoAppModules.runtimeRoot())).toBe(Repo.resolvePath('packages/apps/runtime'))
    Expect(await FS.isFile(FS.resolvePath('TaoRuntime-src/TR.ts', TaoAppModules.runtimeRoot()))).toBe(true)
  })

  Test('packages a real runtime into a relocated CLI artifact, and says so when it carries none', async () => {
    const root = await mkTestDir('tao-cli-relocated-')
    try {
      // A CLI tree with no sibling `packages/apps/runtime`: everything in-repo resolves through that
      // sibling, so this is the only way the packaged path is exercised at all.
      const cliRoot = FS.resolvePath('tao-cli', root)
      await FS.writeText(FS.resolvePath('cli-src/tao-cli.ts', cliRoot), '')

      Expect(() => TaoAppModules.runtimeRoot(cliRoot)).toThrow('has no @tao/runtime module')

      const runtimeSource = Repo.resolvePath('packages/apps/runtime')
      const carried = await TaoAppModules.packageRuntime(cliRoot, runtimeSource)
      Expect(TaoAppModules.runtimeRoot(cliRoot)).toBe(carried)
      Expect(await FS.readText(FS.resolvePath('TaoRuntime-src/TR.ts', carried))).toBe(
        await FS.readText(FS.resolvePath('TaoRuntime-src/TR.ts', runtimeSource)),
      )
      Expect(await FS.isFile(FS.resolvePath('TaoRuntime-src/TR-data.ts', carried))).toBe(true)

      const project = FS.resolvePath('created', root)
      await FS.writeText(FS.resolvePath('tsconfig.json', project), PROJECT_TSCONFIG)
      await TaoAppModules.ensureProject(project, cliRoot)
      Expect(await FS.realPath(FS.resolvePath('node_modules/@tao/runtime', project))).toBe(await FS.realPath(carried))
      const resolved = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['-e', 'await Bun.write(Bun.stdout, import.meta.resolve("@tao/runtime"))'],
        cwd: project,
      })
      Assert(resolved.exitCode === 0, 'the relocated consumer resolves its carried runtime', resolved)
      Expect(resolved.stdout).toContain('/modules/@tao/runtime/TaoRuntime-src/TR.ts')
    } finally {
      await FS.remove(root)
    }
  })

  Test('writes the pinned project tsconfig that maps @tao/* through node_modules', () => {
    Expect(PROJECT_TSCONFIG).toBe(PINNED_PROJECT_TSCONFIG)
  })

  Test('typechecks in-repo app sidecars that import @tao/runtime', async () => {
    const result = await CLI.run(Repo.resolvePath('node_modules/.bin/tsc'), {
      args: ['--project', Repo.resolvePath('Apps/tsconfig.json')],
    })
    Assert(result.exitCode === 0, 'in-repo app sidecars that import @tao/runtime type-check', {
      stderr: result.stderr,
      stdout: result.stdout,
    })
  })

  Test('resolves native app imports from the owning host without root-hoisted dependencies', async () => {
    const root = await mkTestDir('tao-app-native-resolution-')
    try {
      const configPath = FS.resolvePath('Apps/tsconfig.json', root)
      await FS.writeText(configPath, await FS.readText(Repo.resolvePath('Apps/tsconfig.json')))
      const sidecar = FS.resolvePath('Apps/Test Apps/Native Bridge/Generated/Bindings.ts', root)
      await FS.writeText(sidecar, '')
      const config = ts.readConfigFile(configPath, ts.sys.readFile)
      Expect(config.error).toBeUndefined()
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, FS.dirname(configPath))
      Expect(parsed.errors).toEqual([])
      for (const name of ['expo-clipboard', 'expo-haptics', 'react-native']) {
        const declaration = FS.resolvePath(`packages/apps/expo-host/node_modules/${name}/index.d.ts`, root)
        await FS.writeText(declaration, 'export declare const hostOnly: unique symbol;')
        await FS.writeJson(FS.resolvePath(`packages/apps/expo-host/node_modules/${name}/package.json`, root), {
          name,
          types: 'index.d.ts',
        })
        const resolved = ts.resolveModuleName(name, sidecar, parsed.options, ts.sys).resolvedModule
        Expect(resolved?.resolvedFileName).toBe(declaration)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('links a created project to the bundled runtime and skips a project without tsconfig', async () => {
    const root = await mkTestDir('tao-app-modules-')
    try {
      const created = FS.resolvePath('notes', root)
      await FS.writeText(FS.resolvePath('tsconfig.json', created), PROJECT_TSCONFIG)
      await TaoAppModules.ensureProject(created)
      const linkedRuntime = FS.resolvePath('node_modules/@tao/runtime', created)
      Expect(await FS.realPath(linkedRuntime)).toBe(Repo.resolvePath('packages/apps/runtime'))
      Expect(await FS.isFile(FS.resolvePath('TaoRuntime-src/TR.ts', linkedRuntime))).toBe(true)

      const untouched = FS.resolvePath('bare', root)
      await FS.writeText(FS.resolvePath('App.tao', untouched), 'app Bare { view Main }\n')
      await TaoAppModules.ensureProject(untouched)
      Expect(await FS.exists(FS.resolvePath('node_modules/@tao/runtime', untouched))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})
