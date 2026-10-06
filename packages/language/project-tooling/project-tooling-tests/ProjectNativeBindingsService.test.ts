import { Workspace } from '@compiler/workspace'
import { FS, Platform, TaoStdlib } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { inspectMaintainedNativeBindings } from 'tao-native-bindings'
import { ProjectTooling } from '../project-tooling-src/ProjectToolingService'

const declaredStdlib = testOverrideSlot({
  read: () => Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoStdlib.DECLARED_ROOT_ENV] = value
    }
  },
})

Describe('project tooling selected native bindings', () => {
  Test('preserves real maintained File and Directory families in ordinary authored consumers', async () => {
    // File and Directory are native handle families with action contracts. Publish their bridge
    // signatures as foreign actions so this test checks consumer types without promising purity.
    await withTaoFiles('tao-tooling-native-facade-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao':
        'use File, Directory from @tao/device/files\npublic action PreserveFile(Value File) returns File from ./Consumer.ts\npublic action PreserveDirectory(Value Directory) returns Directory from ./Consumer.ts\n',
      'Project/Consumer.ts':
        'import type { PreserveFile as FileContract, PreserveDirectory as DirectoryContract } from "./Main.tao"\ntype FileValue = Parameters<FileContract>[0]\ntype DirectoryValue = Parameters<DirectoryContract>[0]\ndeclare const file: FileValue\ndeclare const directory: DirectoryValue\nexport const acceptedFile: FileValue = file\nexport const acceptedDirectory: DirectoryValue = directory\nexport function PreserveFile(value: FileValue): FileValue { return value }\nexport function PreserveDirectory(value: DirectoryValue): DirectoryValue { return value }\n',
      'selected-stdlib/.tao/.gitkeep': '',
      'selected-stdlib/Package.tao': 'package { version 0.1.0 includes @tao }',
    }, async (paths, fixture) => {
      const originalRoot = TaoStdlib.declaredRoot() ?? FS.resolvePath('../../../apps/stdlib', import.meta.dir)
      const original = await inspectMaintainedNativeBindings({ stdlibRoot: originalRoot })
      Expect(original.status).toBe('fresh')
      const selectedRoot = FS.resolvePath('selected-stdlib', fixture)
      for (const path of original.outputPaths) {
        await FS.copyFile(path, FS.resolvePath(FS.relativePath(originalRoot, path), selectedRoot))
      }
      const nativeBindings = { stdlibRoot: selectedRoot, sourceRoots: [] }
      const projectRoot = FS.resolvePath('Project', fixture)
      const good = await ProjectTooling.refresh(projectRoot, { nativeBindings })
      Expect(good.diagnostics).toEqual([])
      Expect(good.status).toBe('fresh')
      const consumer = paths['Project/Consumer.ts']
      const valid = await FS.readText(consumer)
      await FS.writeText(
        consumer,
        `${valid}export const wrongFamily: FileValue = directory\nexport const forged: FileValue = {}\n`,
      )
      const invalid = await ProjectTooling.refresh(projectRoot, { nativeBindings })
      Expect(invalid.status).toBe('stale')
      const errors = invalid.diagnostics.filter(diagnostic =>
        diagnostic.filePath === consumer && (diagnostic.code === 'TS2322' || diagnostic.code === 'TS2739')
      )
      Expect(errors).toHaveLength(2)
      Expect(errors.some(diagnostic => diagnostic.code === 'TS2322' && diagnostic.message.includes('Directory'))).toBe(
        true,
      )
      Expect(errors.some(diagnostic => diagnostic.code === 'TS2739' && diagnostic.message.includes('{}'))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao-ts/@tao/device/files/Bindings.tao.ts', selectedRoot))).toBe(false)
    }, { verbatim: true })
  })

  Test('validates selected fresh native bindings when unrelated default bindings are stale', async () => {
    await withTaoFiles('tao-tooling-native-selected-', {
      'Project/.tao/.gitkeep': '',
      'Project/Main.tao':
        'use DirectoryCreateOptions from @tao/device/files\npublic function CreateOptions() returns DirectoryCreateOptions { return CreateOptions() from ./CreateOptions.ts }\n',
      'Project/CreateOptions.ts': 'export function CreateOptions() { return { Intermediates: true } }\n',
      'selected-stdlib/.tao/.gitkeep': '',
      'selected-stdlib/Package.tao': 'package { version 0.1.0 includes @tao }',
      'default-stdlib/.gitkeep': '',
    }, async (_paths, fixture) => {
      const originalRoot = TaoStdlib.declaredRoot()
        ?? FS.resolvePath('../../../apps/stdlib', import.meta.dir)
      const original = await inspectMaintainedNativeBindings({ stdlibRoot: originalRoot })
      Expect(original.status).toBe('fresh')
      const selectedRoot = FS.resolvePath('selected-stdlib', fixture)
      for (const path of original.outputPaths) {
        await FS.copyFile(path, FS.resolvePath(FS.relativePath(originalRoot, path), selectedRoot))
      }
      const nativeBindings = { stdlibRoot: selectedRoot, sourceRoots: [] }
      Expect((await inspectMaintainedNativeBindings(nativeBindings)).status).toBe('fresh')
      const restore = declaredStdlib.install(FS.resolvePath('default-stdlib', fixture))
      try {
        Expect((await inspectMaintainedNativeBindings()).status).toBe('stale')
        const refreshed = await ProjectTooling.refresh(FS.resolvePath('Project', fixture), { nativeBindings })
        Expect(refreshed.diagnostics).toEqual([])
        Expect(refreshed.status).toBe('fresh')
        Expect(refreshed.contractPaths).toContain(FS.resolvePath('Project/.tao-ts/Main.tao.ts', fixture))
        const contract = await FS.readText(FS.resolvePath('Project/.tao-ts/Main.tao.ts', fixture))
        Expect(contract).toContain('Intermediates')
        Expect(contract).toContain('Idempotent')
        const workspace = await Workspace.open(FS.resolvePath('Project', fixture), { nativeBindings })
        const validated = await workspace.validateFiles([FS.resolvePath('Project/Main.tao', fixture)])
        Expect(validated.diagnostics).toEqual([])
        Expect(validated.files.map(file => file.path)).toContain(
          FS.resolvePath('@tao/device/files/Bindings.tao', selectedRoot),
        )
        Expect(refreshed.nativeBindingOutputPaths).toContain(
          FS.resolvePath('.tao-ts/native-bindings/files/maintained.json', selectedRoot),
        )
      } finally {
        restore()
      }
    }, { verbatim: true })
  })
})
