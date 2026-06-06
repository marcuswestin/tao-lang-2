import Runtime from '@runtime'
import { FS, Platform } from '@shared'
import { AfterEach, Describe, Expect, Test } from '@shared/test'

const kitchenSinkDir = FS.repoPath('Apps/Kitchen Sink')
const runtimeRoots: string[] = []

AfterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})

Describe('Tao runtime app generation', () => {
  Test('generates app paths from the supplied app path', async () => {
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-test-', { cwd: FS.tmpdir() }))
    runtimeRoots.push(runtimePackageRoot)
    const appPath = FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir })

    const generated = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    Expect(generated.sourcePath).toBe(appPath)
    Expect(generated.outputPath).toBe(FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot }))
    Expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    Expect(generatedAgain.outputPath).toBe(generated.outputPath)
    Expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  Test('resolves relative app paths from the current working directory by default', async () => {
    const outsideRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-test-', { cwd: FS.tmpdir() }))
    runtimeRoots.push(outsideRoot)

    const cwd = Platform.runtimeProcess.cwd()
    const runtimePackageRoot = FS.resolvePath('runtime', { cwd: outsideRoot })

    try {
      Platform.runtimeProcess.chdir(kitchenSinkDir)
      const generated = await Runtime.generateApp('Kitchen Sink.tao', {
        runtimePackageRoot,
      })

      Expect(generated.sourcePath).toBe(FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir }))
      Expect(generated.outputPath).toBe(FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot }))
      Expect(await FS.readText(generated.outputPath)).toBe(generated.code)
    } finally {
      Platform.runtimeProcess.chdir(cwd)
    }
  })
})
