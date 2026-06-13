import { type Diagnostic, Diagnostics, FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'

const tsFence = '```ts'
const fence = '```'

Describe('directory-rooted Tao workspace pipeline', () => {
  Test('parses, validates, and compiles an entry file with nested package imports', async () => {
    await withTaoFiles(
      'tao-workspace-package-',
      {
        'Main.tao': `
          project {
            name "Workspace Package Test"
            remote none
            license MIT
          }
          app PackageAccess { ui MainView }
          use MainView from @cards/screens
        `,
        'Packages/@cards/Title.tao': `
          package alias Title = "Package title"
        `,
        'Packages/@cards/screens/Main.tao': `
          use Title
          project ui MainView {
            render Text Title
          }
          ui Text Value text {
            render inject Value ${tsFence}
              return null
            ${fence}
          }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parseResult = await workspace.parse(paths['Main.tao']!)
        const validation = await workspace.validate(paths['Main.tao']!)
        const compiled = await workspace.compile(paths['Main.tao']!)

        Expect(parseResult.files.map(file => file.ast.$type)).toHaveLength(3)
        Expect(errorMessages(validation)).toEqual([])
        Expect(compiled.files.map(file => file.sourcePath).sort()).toEqual([
          paths['Main.tao']!,
          paths['Packages/@cards/Title.tao']!,
          paths['Packages/@cards/screens/Main.tao']!,
        ].sort())
      },
    )
  })

  Test('reports duplicate package names through the shared package index', async () => {
    await withTaoFiles(
      'tao-workspace-duplicate-package-',
      {
        'Main.tao': `
          app DuplicatePackageApp { ui MainView }
          use MainView from @bar
        `,
        'one/@bar/Main.tao': `
          project ui MainView {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
        'two/@bar/Main.tao': `
          project ui MainView {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const validation = await workspace.validate(paths['Main.tao']!)

        Expect(errorMessages(validation).some(message => message.includes("Package '@bar' is ambiguous"))).toBe(true)
      },
    )
  })

  Test('rejects entry files outside the workspace root', async () => {
    await withTaoFiles(
      'tao-workspace-root-',
      {
        'Main.tao': `
          app RootApp { ui MainView }
          ui MainView { }
        `,
      },
      async (paths) => {
        const outsideRoot = await FS.mkTmpDir(FS.resolvePath('tao-workspace-outside-', { cwd: FS.tmpdir() }))
        try {
          const workspace = await Workspace.open(outsideRoot)
          await Expect(workspace.parse(paths['Main.tao']!)).rejects.toThrow(
            'workspace path is inside the workspace root',
          )
        } finally {
          await FS.remove(outsideRoot)
        }
      },
    )
  })
})

function errorMessages(result: { diagnostics: readonly Diagnostic[] }): string[] {
  return Diagnostics.errorMessages(result.diagnostics)
}
