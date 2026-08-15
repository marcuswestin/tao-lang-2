import Runtime from '@runtime-toolchain'
import TR from '@runtime/TR'
import { Assert, CLI, FS, Repo } from '@shared'
import { AfterEach, Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'

const wordFlowerDir = Repo.resolvePath('Apps/WordFlower/1 - Current')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeRoots: string[] = []

async function createRuntimePackageRoot(): Promise<string> {
  const runtimePackageRoot = await mkTestDir('tao-runtime-test-')
  runtimeRoots.push(runtimePackageRoot)
  return runtimePackageRoot
}

function generatedAppPath(runtimePackageRoot: string): string {
  return FS.resolvePath('_gen_tao-app/App.tsx', runtimePackageRoot)
}

AfterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})

Describe('Tao runtime app generation', () => {
  Test('generates app paths from the supplied app path', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const appPath = FS.resolvePath('WordFlower.tao', wordFlowerDir)

    const generated = await Runtime.generateApp(appPath, {
      appName: 'WordFlower',
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(appPath)
    Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp(appPath, {
      appName: 'WordFlower',
      runtimePackageRoot,
    })

    Expect(generatedAgain.outputPath).toBe(generated.outputPath)
    Expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  Test('resolves relative app paths from an explicit working directory', async () => {
    const outsideRoot = await createRuntimePackageRoot()
    const runtimePackageRoot = FS.resolvePath('runtime', outsideRoot)

    const generated = await Runtime.generateApp('WordFlower.tao', {
      appName: 'WordFlower',
      cwd: wordFlowerDir,
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(FS.resolvePath('WordFlower.tao', wordFlowerDir))
    Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
  })

  Test('removes stale generated module files and empty directories when imports change', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()

    await Runtime.generateApp(runtimeStdlibTestsPath, { runtimePackageRoot })
    const stdlibModulePath = await findGeneratedModule(runtimePackageRoot, 'Views.tao.tsx')
    const stdlibModuleDir = FS.dirname(stdlibModulePath)

    Expect(await FS.exists(stdlibModulePath)).toBe(true)
    Expect(await FS.exists(stdlibModuleDir)).toBe(true)

    const generated = await Runtime.generateApp(typeSystemTestsPath, { runtimePackageRoot })

    Expect(await FS.exists(stdlibModulePath)).toBe(false)
    // Type System Tests now imports @tao/nav, so the shared generated stdlib directory remains.
    Expect(await FS.exists(stdlibModuleDir)).toBe(true)
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
  })

  Test('generates, type-checks, and conforms a sidecar navigation implementation', async () => {
    const executableRoot = Repo.resolvePath('packages/runtime-toolchain/.artifacts/sidecar-tests')
    await FS.mkdir(executableRoot)
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('runtime-', executableRoot))
    runtimeRoots.push(runtimePackageRoot)
    await withTaoFiles(
      'tao-runtime-sidecar-',
      {
        'Main.tao': `
          use SidecarStack from ./Constructs.tao
          app SidecarApp {
            Name "Sidecar App"
            Navigator SidecarStack { Initial Home }
          }
          ui Home { render inject \`\`\`ts return null \`\`\` }
        `,
        'Constructs.tao': `
          public nav SidecarStack {
            Initial ui
            implement inject nav "./SidecarStack.ts"
          }
        `,
        'SidecarStack.ts': `
          import TR from '@runtime/TR'
          import type { SidecarStackConfig } from './Constructs.tao'

          let factoryCalls = 0
          export default function createSidecarStack(): TR.NavKind<'stack', SidecarStackConfig> {
            factoryCalls++
            if (factoryCalls !== 1) throw new Error('sidecar factory must be evaluated exactly once')
            return TR.NavKind.Stack()
          }
        `,
      },
      async paths => {
        await Runtime.generateApp(paths['Main.tao'], { runtimePackageRoot })
        const modulePath = await findGeneratedModule(runtimePackageRoot, 'Constructs.tao.tsx')
        const declarationsPath = await findGeneratedModule(runtimePackageRoot, 'Constructs.tao.d.ts')
        const sidecarPath = await findGeneratedModule(runtimePackageRoot, 'SidecarStack.ts')
        const moduleCode = await FS.readText(modulePath)

        Expect(await FS.exists(declarationsPath)).toBe(true)
        Expect(await FS.exists(sidecarPath)).toBe(true)
        Expect(moduleCode).toContain(
          "import __tao_configuration_implementation_SidecarStack__ from './SidecarStack'",
        )
        Expect(moduleCode).toContain('__tao_configuration_implementation_SidecarStack__')

        const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
        const typecheckConfig = FS.resolvePath('tsconfig.json', runtimePackageRoot)
        await FS.writeJson(typecheckConfig, {
          extends: Repo.resolvePath('packages/tsconfig.base.json'),
          compilerOptions: {
            allowImportingTsExtensions: true,
            composite: false,
            declaration: false,
            incremental: false,
            jsx: 'react',
            lib: ['ES2023', 'DOM'],
            noEmit: true,
            rootDir: '/',
            typeRoots: [Repo.resolvePath('node_modules/@types')],
            types: ['bun', 'node'],
          },
          include: [`${generatedRoot}/**/*.ts`, `${generatedRoot}/**/*.tsx`],
        })
        const typecheck = await CLI.run(Repo.resolvePath('node_modules/.bin/tsc'), {
          args: ['--project', typecheckConfig],
        })
        Assert(typecheck.exitCode === 0, 'generated sidecar configuration contract type-checks', {
          stderr: typecheck.stderr,
          stdout: typecheck.stdout,
        })

        const generatedModule = await import(modulePath) as {
          SidecarStack: {
            kind: TR.NavKind<'stack', TR.StackNavConfiguration>
          }
        }
        Expect(generatedModule.SidecarStack.kind.profile).toBe('stack')
        TR.testNavKind(generatedModule.SidecarStack.kind, 'stack')
      },
    )
  })
})

async function findGeneratedModule(runtimePackageRoot: string, fileName: string): Promise<string> {
  const generatedRoot = FS.resolvePath('_gen_tao-app', runtimePackageRoot)
  let foundPath: string | undefined
  for await (const path of FS.walk(generatedRoot)) {
    if (FS.basename(path) === fileName) {
      foundPath = path
      break
    }
  }
  Assert.defined(foundPath, 'generated module exists', { fileName })
  return foundPath
}
