import Runtime from '@runtime'
import { FS, Platform } from '@shared'
import { AfterEach, Describe, Expect, Test } from '@shared/test'

const kitchenSinkDir = FS.repoPath('Apps/Kitchen Sink')
const runtimeStdlibTestsPath = FS.repoPath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeRoots: string[] = []

async function createRuntimePackageRoot(): Promise<string> {
  const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-test-', { cwd: FS.tmpdir() }))
  runtimeRoots.push(runtimePackageRoot)
  return runtimePackageRoot
}

function generatedAppPath(runtimePackageRoot: string): string {
  return FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot })
}

AfterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})

Describe('Tao runtime app generation', () => {
  Test('generates app paths from the supplied app path', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const appPath = FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir })

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

  Test('resolves relative app paths from the current working directory by default', async () => {
    const outsideRoot = await createRuntimePackageRoot()

    const cwd = Platform.runtimeProcess.cwd()
    const runtimePackageRoot = FS.resolvePath('runtime', { cwd: outsideRoot })

    try {
      Platform.runtimeProcess.chdir(kitchenSinkDir)
      const generated = await Runtime.generateApp('Kitchen Sink.tao', {
        runtimePackageRoot,
      })

      Expect(generated.sourcePath).toBe(FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir }))
      Expect(generated.outputPath).toBe(generatedAppPath(runtimePackageRoot))
      Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
    } finally {
      Platform.runtimeProcess.chdir(cwd)
    }
  })

  Test('removes stale generated module files when imports change', async () => {
    const runtimePackageRoot = await createRuntimePackageRoot()
    const stdlibModulePath = FS.resolvePath(
      '_gen_tao-app/modules/packages/runtime/tao-stdlib/tao/ui/Views.tao.tsx',
      { cwd: runtimePackageRoot },
    )

    await Runtime.generateApp(runtimeStdlibTestsPath, { runtimePackageRoot })
    Expect(await FS.exists(stdlibModulePath)).toBe(true)

    const generated = await Runtime.generateApp(typeSystemTestsPath, { runtimePackageRoot })

    Expect(await FS.exists(stdlibModulePath)).toBe(false)
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
  })
})
