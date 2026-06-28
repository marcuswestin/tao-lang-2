import { type Diagnostic, Diagnostics, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import { LSPWorkspace, Workspace } from '@workspace'

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
          app PackageAccess { view MainView }
          use MainView from @cards/screens
        `,
        'Packages/@cards/Title.tao': `
          package alias Title = "Package title"
        `,
        'Packages/@cards/screens/Main.tao': `
          use Title
          project view MainView {
            render Text Title
          }
          view Text Value is text {
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
          app DuplicatePackageApp { view MainView }
          use MainView from @bar
        `,
        'one/@bar/Main.tao': `
          project view MainView {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
        'two/@bar/Main.tao': `
          project view MainView {
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

  Test('can reuse a process-shared workspace by resolved root', async () => {
    await withTaoFiles(
      'tao-workspace-shared-',
      {
        'Main.tao': 'view MainView { }\n',
      },
      async (_paths, rootDir) => {
        const fresh = await Workspace.open(rootDir)
        const shared = await Workspace.shared(rootDir)
        const sameShared = await Workspace.shared(FS.resolvePath('.', rootDir))

        Expect(fresh).not.toBe(shared)
        Expect(shared).toBe(sameShared)
      },
    )
  })

  Test('skips future Tao sketch directories while preloading LSP documents', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-sketches-',
      {
        'Main.tao': 'view MainView { }\n',
        'Apps/MVP-triage/Future.tao': 'project app FutureMVP {',
        'Roadmap/Feature/Syntax Sketches/Future.tao': 'render Screen [futureCombinedToken] {',
      },
      async (_paths, rootDir) => {
        const workspace = await LSPWorkspace.open(rootDir)
        const loadedPaths = Array.from(workspace.services.shared.workspace.LangiumDocuments.all)
          .map(document => document.uri.fsPath)

        Expect(loadedPaths).toEqual([FS.resolvePath('Main.tao', rootDir)])
      },
    )
  })

  Test('can compile test plans without rerunning semantic validation', async () => {
    await withTaoFiles(
      'tao-workspace-test-plan-skip-validation-',
      {
        'Main.test.tao': 'test "Empty" { }\n',
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)

        await Expect(workspace.compileTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          "Test 'Empty' must declare at least one check.",
        )
        const plan = await workspace.compileTestPlan(paths['Main.test.tao']!, { skipValidation: true })

        Expect(plan.suites[0]?.name).toBe('Empty')
        Expect(plan.suites[0]?.checks).toEqual([])
      },
    )
  })

  Test('rejects entry files outside the workspace root', async () => {
    await withTaoFiles(
      'tao-workspace-root-',
      {
        'Main.tao': `
          app RootApp { view MainView }
          view MainView { }
        `,
      },
      async (paths) => {
        const outsideRoot = await mkTestDir('tao-workspace-outside-')
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
