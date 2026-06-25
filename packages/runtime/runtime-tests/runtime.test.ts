import Runtime from '@runtime'
import { Assert, FS, Repo } from '@shared'
import { AfterEach, Describe, Expect, mkTestDir, Test } from '@shared/test'

const kitchenSinkDir = Repo.resolvePath('Apps/Kitchen Sink')
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
    const appPath = FS.resolvePath('Kitchen Sink.tao', kitchenSinkDir)

    const generated = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(appPath)
    Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    Expect(generatedAgain.outputPath).toBe(generated.outputPath)
    Expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  Test('resolves relative app paths from an explicit working directory', async () => {
    const outsideRoot = await createRuntimePackageRoot()
    const runtimePackageRoot = FS.resolvePath('runtime', outsideRoot)

    const generated = await Runtime.generateApp('Kitchen Sink.tao', {
      cwd: kitchenSinkDir,
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(FS.resolvePath('Kitchen Sink.tao', kitchenSinkDir))
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
    Expect(await FS.exists(stdlibModuleDir)).toBe(false)
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
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
