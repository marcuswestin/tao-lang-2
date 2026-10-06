import { Assert, FS, Platform, Repo, TaoStdlib } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, MockModule, Test, testOverrideSlot, until } from '@shared/test'
import {
  forgetInspectionMemos,
  inspectMaintainedNativeBindings,
  memoisedInspectionPasses,
} from '../native-bindings-src/maintained-native-bindings'

const originalFS = { ...FS }
const entryMetadata = testOverrideSlot({
  read: () => FS.entryMetadata,
  write: value => {
    MockModule(new URL('../../../shared/shared-src/FS.ts', import.meta.url).pathname, () => ({
      ...originalFS,
      entryMetadata: value,
    }))
  },
})

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

  Test('rejects a memo when output changes after either warm or cold inspection', async () => {
    const root = await mkTestDir('maintained-memo-mutation-')
    const stdlibRoot = FS.resolvePath('stdlib', root)
    await copyInstalledPayload(stdlibRoot)
    forgetInspectionMemos()
    await withDeclaredStdlib(stdlibRoot, async () => {
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
      const original = await FS.readText(output)
      const baseline = await inspectMaintainedNativeBindings()
      Expect(baseline.status).toBe('fresh')
      const passes = memoisedInspectionPasses()
      const warm = await inspectMaintainedNativeBindings({}, {
        afterInspection: async () => {
          await FS.writeText(output, `${original}\n// mutation after memo lookup\n`)
        },
      })
      Expect(memoisedInspectionPasses()).toBe(passes + 1)
      Expect(warm.status).toBe('stale')
      Expect(warm.diagnostics.some(item => item.message.includes('output inventory or contents changed'))).toBe(true)
      await FS.writeText(output, original)
      forgetInspectionMemos()
      const cold = await inspectMaintainedNativeBindings({}, {
        afterInspection: async () => {
          await FS.writeText(output, `${original}\n// mutation after cold hashing\n`)
        },
      })
      Expect(cold.status).toBe('stale')
      Expect(memoisedInspectionPasses()).toBe(passes + 1)
      Expect((await inspectMaintainedNativeBindings()).status).toBe('stale')
      await FS.writeText(output, original)
      const restored = await inspectMaintainedNativeBindings()
      Expect(restored.status).toBe('fresh')
      Expect(restored.identity).toBe(baseline.identity)
      Expect((await inspectMaintainedNativeBindings({ stdlibRoot })).identity).toBe(restored.identity)
    })
  })


  Test('crosses the publisher barrier when publication starts during memo acceptance', async () => {
    const root = await mkTestDir('maintained-memo-acceptance-publisher-')
    const stdlibRoot = FS.resolvePath('stdlib', root)
    await copyInstalledPayload(stdlibRoot)
    forgetInspectionMemos()
    await withDeclaredStdlib(stdlibRoot, async () => {
      const output = FS.resolvePath('.tao-ts/native-bindings/files/Bindings.ts', stdlibRoot)
      const first = FS.resolvePath('@tao/device/files', stdlibRoot)
      Expect((await inspectMaintainedNativeBindings()).status).toBe('fresh')
      const writerEntered = Deferred()
      const releaseWriter = Deferred()
      let acceptanceStarted = false
      let intercepted = false
      let barrierRequired = false
      let returned = false
      let writer: Promise<void> | undefined
      const readMetadata = FS.entryMetadata
      const restore = entryMetadata.install(async path => {
        const metadata = await readMetadata(path)
        if (path === output && acceptanceStarted && !intercepted) {
          intercepted = true
          writer = FS.withFileMutationLock(first, FS.dirname(first), async () => {
            writerEntered.resolve()
            await releaseWriter.promise
          })
          await writerEntered.promise
        }
        return metadata
      })
      const reader = inspectMaintainedNativeBindings({}, {
        afterInspection: async () => {
          acceptanceStarted = true
        },
        beforePublicationBarrier: async () => {
          barrierRequired = true
        },
      }).then(result => {
        returned = true
        return result
      })
      try {
        await until(() => barrierRequired || returned, {
          description: 'native memo reader to cross the publisher barrier after acceptance scanning',
        })
        Expect(intercepted).toBe(true)
        Expect(returned).toBe(false)
        Expect(barrierRequired).toBe(true)
        Expect(await FS.exists(`${await FS.realPath(first)}.tao-file-mutation.lock`)).toBe(true)
      } finally {
        releaseWriter.resolve()
        await Promise.allSettled([reader, ...(writer === undefined ? [] : [writer])])
        restore()
      }
      Expect((await reader).status).toBe('fresh')
    })
  })

})
