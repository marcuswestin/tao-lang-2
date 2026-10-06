import { Assert, FS, Platform, Repo, TaoStdlib } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  forgetInspectionMemos,
  inspectMaintainedNativeBindings,
  memoisedInspectionPasses,
} from '../native-bindings-src/maintained-native-bindings'

/** Copy the verified installation payload into a stdlib the test owns; the declaration inputs stay the repository's. */
async function copyInstalledPayload(stdlibRoot: string): Promise<void> {
  const installedRoot = TaoStdlib.declaredRoot() ?? Repo.resolvePath('packages/apps/stdlib')
  const inspection = await inspectMaintainedNativeBindings()
  Assert.input(inspection.status === 'fresh', inspection.diagnostics.map(item => item.message).join('\n'))
  for (const path of inspection.outputPaths) {
    await FS.writeText(FS.resolvePath(FS.relativePath(installedRoot, path), stdlibRoot), await FS.readText(path))
  }
}

async function withDeclaredStdlib<T>(stdlibRoot: string, run: () => Promise<T>): Promise<T> {
  const env = Platform.runtimeProcess.env
  const previous = env['TAO_STDLIB_ROOT']
  env['TAO_STDLIB_ROOT'] = stdlibRoot
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete env['TAO_STDLIB_ROOT']
    } else {
      env['TAO_STDLIB_ROOT'] = previous
    }
  }
}

Describe('maintained native binding inspection memo', () => {
  Test('answers an unchanged installation from the memo and rehashes after every visible change', async () => {
    const root = await mkTestDir('maintained-memo-')
    const stdlibRoot = FS.resolvePath('stdlib', root)
    await copyInstalledPayload(stdlibRoot)
    forgetInspectionMemos()
    await withDeclaredStdlib(stdlibRoot, async () => {
      const cold = await inspectMaintainedNativeBindings()
      Expect(cold.status).toBe('fresh')
      const passes = memoisedInspectionPasses()
      let observed = 0
      const warm = await inspectMaintainedNativeBindings({}, { afterInspection: async () => void (observed += 1) })
      Expect(warm.status).toBe('fresh')
      Expect(warm.identity).toBe(cold.identity)
      Expect(warm.outputPaths).toEqual(cold.outputPaths)
      Expect(memoisedInspectionPasses()).toBe(passes + 1)
      Expect(observed).toBe(1)

      // An appended output is seen by its size, and its restoration takes a cold pass again.
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
      const original = await FS.readText(output)
      await FS.writeText(output, `${original}\n// drift\n`)
      Expect((await inspectMaintainedNativeBindings()).status).toBe('stale')
      Expect(memoisedInspectionPasses()).toBe(passes + 1)
      await FS.writeText(output, original)
      Expect((await inspectMaintainedNativeBindings()).status).toBe('fresh')
      Expect(memoisedInspectionPasses()).toBe(passes + 1)
      Expect((await inspectMaintainedNativeBindings()).identity).toBe(cold.identity)
      Expect(memoisedInspectionPasses()).toBe(passes + 2)

      // A file added to a watched output directory moves the directory's timestamp.
      const stray = FS.resolvePath('.tao-ts/native-bindings/files/stray.ts', stdlibRoot)
      await FS.writeText(stray, 'export {}\n')
      Expect((await inspectMaintainedNativeBindings()).status).toBe('stale')
      await FS.remove(stray)
      Expect((await inspectMaintainedNativeBindings()).status).toBe('fresh')
      Expect(memoisedInspectionPasses()).toBe(passes + 2)

      // Explicit roots name the cold path, whatever the memo holds.
      await inspectMaintainedNativeBindings({ stdlibRoot })
      await inspectMaintainedNativeBindings({ stdlibRoot })
      Expect(memoisedInspectionPasses()).toBe(passes + 2)
    })
  })
})
