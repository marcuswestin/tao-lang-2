import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Runtime } from '../runtime-src/runtime'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const kitchenSinkDir = resolve(repoRoot, 'Apps/Kitchen Sink')
const runtimeRoots: string[] = []

afterEach(async () => {
  for (const root of runtimeRoots.splice(0)) {
    await rm(root, { force: true, recursive: true })
  }
})

describe('Tao runtime compiler', () => {
  test('compiles app paths relative to the source base directory', async () => {
    const runtimePackageRoot = await mkdtemp(resolve(tmpdir(), 'tao-runtime-test-'))
    runtimeRoots.push(runtimePackageRoot)

    const generated = await Runtime.compileApp('Kitchen Sink.tao', {
      runtimePackageRoot,
      sourceBaseDir: kitchenSinkDir,
    })

    expect(generated.sourcePath).toBe(resolve(kitchenSinkDir, 'Kitchen Sink.tao'))
    expect(generated.outputPath).toBe(resolve(runtimePackageRoot, '_gen_tao-app/App.tsx'))
    expect(generated.code).toContain('Hello, World!')
    expect(await readFile(generated.outputPath, 'utf8')).toBe(generated.code)

    const firstWrite = (await stat(generated.outputPath)).mtimeMs
    const generatedAgain = await Runtime.compileApp('Kitchen Sink.tao', {
      runtimePackageRoot,
      sourceBaseDir: kitchenSinkDir,
    })

    expect(generatedAgain.outputPath).toBe(generated.outputPath)
    expect((await stat(generated.outputPath)).mtimeMs).toBe(firstWrite)
  })
})
