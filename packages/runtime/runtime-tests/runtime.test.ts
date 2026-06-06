import Runtime from '@runtime'
import { FS, Platform } from '@shared'
import { afterEach, describe, expect, test } from 'bun:test'

const kitchenSinkDir = FS.repoPath('Apps/Kitchen Sink')
const runtimeRoots: string[] = []

afterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})

describe('Tao runtime app generation', () => {
  test('generates app paths from the supplied app path', async () => {
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-test-', { cwd: FS.tmpdir() }))
    runtimeRoots.push(runtimePackageRoot)
    const appPath = FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir })

    const generated = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    expect(generated.sourcePath).toBe(appPath)
    expect(generated.outputPath).toBe(FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot }))
    expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp(appPath, {
      runtimePackageRoot,
    })

    expect(generatedAgain.outputPath).toBe(generated.outputPath)
    expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  test('resolves relative app paths from the current working directory by default', async () => {
    const outsideRoot = await FS.mkTmpDir(FS.resolvePath('tao-runtime-test-', { cwd: FS.tmpdir() }))
    runtimeRoots.push(outsideRoot)

    const cwd = Platform.runtimeProcess.cwd()
    const runtimePackageRoot = FS.resolvePath('runtime', { cwd: outsideRoot })

    try {
      Platform.runtimeProcess.chdir(kitchenSinkDir)
      const generated = await Runtime.generateApp('Kitchen Sink.tao', {
        runtimePackageRoot,
      })

      expect(generated.sourcePath).toBe(FS.resolvePath('Kitchen Sink.tao', { cwd: kitchenSinkDir }))
      expect(generated.outputPath).toBe(FS.resolvePath('_gen_tao-app/App.tsx', { cwd: runtimePackageRoot }))
      expect(await FS.readText(generated.outputPath)).toBe(generated.code)
    } finally {
      Platform.runtimeProcess.chdir(cwd)
    }
  })
})
