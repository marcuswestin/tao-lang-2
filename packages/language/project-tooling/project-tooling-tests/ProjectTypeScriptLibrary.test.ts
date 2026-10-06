import { FS, Platform, TaoResources } from '@shared'
import { Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import * as ts from 'typescript'
import { installedTypeScriptLibraryDirectory } from '../project-tooling-src/ProjectTypeScriptLibrary'
import { createProjectTypeScriptProgram } from '../project-tooling-src/ProjectTypeScriptProgram'

const resourceRootSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]
    } else {
      Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV] = value
    }
  },
})

// The installed binary's bundled compiler names the build machine's checkout as its library
// location; installed resources must supply the default declarations instead.
Test('an installed resource root supplies the default TypeScript library declarations', async () => {
  const root = await mkTestDir('tao-typescript-library-')
  const library = FS.resolvePath(`${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib`, root)
  const restore = resourceRootSlot.install(root)
  try {
    Expect(installedTypeScriptLibraryDirectory()).toBeUndefined()

    const compilerLibrary = FS.dirname(ts.getDefaultLibFilePath({}))
    for (const name of await FS.listDir(compilerLibrary)) {
      if (/^lib\..*d\.ts$/u.test(name)) {
        await FS.copyFile(FS.resolvePath(name, compilerLibrary), FS.resolvePath(name, library))
      }
    }
    Expect(installedTypeScriptLibraryDirectory()).toBe(library)

    const source = FS.resolvePath('Probe.ts', root)
    await FS.writeText(source, 'export const words: string[] = ["a"].map(word => word.toUpperCase())\n')
    const program = createProjectTypeScriptProgram([source], {
      lib: ['lib.es2023.d.ts'],
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: [],
    })
    Expect(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')))
      .toEqual([])
    const libraries = program.getSourceFiles().filter(file => file.fileName.includes('/lib.es'))
    Expect(libraries.length).toBeGreaterThan(0)
    Expect(libraries.every(file => FS.pathIsWithin(FS.resolvePath(file.fileName), library))).toBe(true)
  } finally {
    restore()
  }
})
