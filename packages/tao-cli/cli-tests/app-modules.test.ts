import { Assert, CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
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
    Expect(await FS.realPath(TaoAppModules.runtimeRoot())).toBe(Repo.resolvePath('packages/runtime'))
    Expect(await FS.isFile(FS.resolvePath('TaoRuntime-src/TR.ts', TaoAppModules.runtimeRoot()))).toBe(true)
  })

  Test('a relocated CLI uses its own carried module, and says so when it carries none', async () => {
    const root = await mkTestDir('tao-cli-relocated-')
    try {
      // A CLI tree with no sibling `packages/runtime`: everything in-repo resolves through that sibling,
      // so this is the only way the packaged path is exercised at all.
      const cliRoot = FS.resolvePath('tao-cli', root)
      await FS.writeText(FS.resolvePath('cli-src/tao-cli.ts', cliRoot), '')

      await Expect(async () => TaoAppModules.runtimeRoot(cliRoot)).toThrow('has no @tao/runtime module')

      const carried = FS.resolvePath('modules/@tao/runtime', cliRoot)
      await FS.writeText(FS.resolvePath('TaoRuntime-src/TR.ts', carried), 'export default {}\n')
      Expect(TaoAppModules.runtimeRoot(cliRoot)).toBe(carried)
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

  Test('links a created project to the bundled runtime and skips a project without tsconfig', async () => {
    const root = await mkTestDir('tao-app-modules-')
    try {
      const created = FS.resolvePath('notes', root)
      await FS.writeText(FS.resolvePath('tsconfig.json', created), PROJECT_TSCONFIG)
      await TaoAppModules.ensureProject(created)
      const linkedRuntime = FS.resolvePath('node_modules/@tao/runtime', created)
      Expect(await FS.realPath(linkedRuntime)).toBe(Repo.resolvePath('packages/runtime'))
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
