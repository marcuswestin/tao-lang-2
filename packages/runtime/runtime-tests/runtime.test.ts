import Runtime from '@runtime'
import { FS, Platform, Repo } from '@shared'
import { afterEach, describe, expect, test } from 'bun:test'

const repoRoot = await Repo.getRoot()
const kitchenSinkDir = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink')
const runtimeRoots: string[] = []

afterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await FS.remove(root)
  }
})

describe('Tao runtime app generation', () => {
  test('generates app paths relative to the source base directory', async () => {
    const runtimePackageRoot = await FS.mkTmpDir(FS.resolvePath(FS.tmpdir(), 'tao-runtime-test-'))
    runtimeRoots.push(runtimePackageRoot)

    const generated = await Runtime.generateApp('Kitchen Sink.tao', {
      runtimePackageRoot,
      sourceBaseDir: kitchenSinkDir,
    })

    expect(generated.sourcePath).toBe(FS.resolvePath(kitchenSinkDir, 'Kitchen Sink.tao'))
    expect(generated.outputPath).toBe(FS.resolvePath(runtimePackageRoot, '_gen_tao-app/App.tsx'))
    expect(await FS.readText(generated.outputPath)).toBe(generated.code)

    const firstWrite = await FS.modifiedTimeMs(generated.outputPath)
    const generatedAgain = await Runtime.generateApp('Kitchen Sink.tao', {
      runtimePackageRoot,
      sourceBaseDir: kitchenSinkDir,
    })

    expect(generatedAgain.outputPath).toBe(generated.outputPath)
    expect(await FS.modifiedTimeMs(generated.outputPath)).toBe(firstWrite)
  })

  test('uses supplied paths without resolving the repo root', async () => {
    const outsideRoot = await FS.mkTmpDir(FS.resolvePath(FS.tmpdir(), 'tao-runtime-test-'))
    runtimeRoots.push(outsideRoot)

    const cwd = Platform.runtimeProcess.cwd()
    const runtimePackageRoot = FS.joinPath(outsideRoot, 'runtime')

    try {
      Platform.runtimeProcess.chdir(outsideRoot)
      const generated = await Runtime.generateApp('Kitchen Sink.tao', {
        runtimePackageRoot,
        sourceBaseDir: kitchenSinkDir,
      })

      expect(generated.outputPath).toBe(FS.resolvePath(runtimePackageRoot, '_gen_tao-app/App.tsx'))
      expect(await FS.readText(generated.outputPath)).toBe(generated.code)
    } finally {
      Platform.runtimeProcess.chdir(cwd)
    }
  })
})
