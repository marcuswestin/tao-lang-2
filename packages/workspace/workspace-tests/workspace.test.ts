import { AST } from '@parser'
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
            id "workspace-package-test"
            name "Workspace Package Test"
            remote none
            license MIT
          }
          app PackageAccess { view MainView }
          use MainView from @cards/screens
        `,
        'Packages/@cards/Title.tao': `
          package let Title = "Package title"
        `,
        'Packages/@cards/screens/Main.tao': `
          use Title
          workspace scene MainView() {
            render Text(Title)
          }
          view Text(Value text) {
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

        Expect(parseResult.files.map(file => file.ast.$type)).toHaveLength(5)
        Expect(parseResult.files.some(file => file.path.endsWith('/@tao/Prelude.tao'))).toBe(true)
        Expect(errorMessages(validation)).toEqual([])
        Expect([...new Set(compiled.files.map(file => file.sourcePath))].sort()).toEqual([
          paths['Main.tao']!,
          paths['Packages/@cards/Title.tao']!,
          paths['Packages/@cards/screens/Main.tao']!,
        ].sort())
      },
    )
  })

  Test('resolves the reserved root package, nested generated folders, project-relative data, and stdlib', async () => {
    await withTaoFiles(
      'tao-workspace-generated-root-',
      {
        'Main.tao': `
          use RootView from @
          use GeneratedView from @/studio
          use NestedView from @/studio/nested

          app GeneratedApp { view MainView }
          view MainView() { render GeneratedView() }
        `,
        'Data.tao': 'workspace let SharedTitle = "Generated title"',
        '@/Root.tao': `workspace view RootView() { render inject ${tsFence} return null ${fence} }`,
        '@/studio/View.tao': `
          use SharedTitle from ../../Data
          use Text from @tao/ui
          public view GeneratedView() { render Text(SharedTitle) }
        `,
        '@/studio/nested/Nested.tao': `
          workspace view NestedView() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parseResult = await workspace.parse(paths['Main.tao']!)
        const validation = await workspace.validate(paths['Main.tao']!)
        const compiled = await workspace.compile(paths['Main.tao']!)
        const imports = parseResult.entry.ast.statements.filter(AST.isUseStatement)

        Expect(imports.map(statement => statement.importPath)).toEqual(['@', '@/studio', '@/studio/nested'])
        Expect(imports.map(statement => statement.importedDeclarations[0]?.ref?.name)).toEqual([
          'RootView',
          'GeneratedView',
          'NestedView',
        ])
        Expect(errorMessages(validation)).toEqual([])
        Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['@/studio/View.tao'])
        Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['Data.tao'])
      },
    )
  })

  Test('applies workspace visibility across the root generated-package boundary', async () => {
    await withTaoFiles(
      'tao-workspace-generated-visibility-',
      {
        'Main.tao': `
          use Hidden, PackageOnly, WorkspaceVisible, Published from @/studio
          view MainView() { render WorkspaceVisible() }
        `,
        '@/studio/Views.tao': `
          view Hidden() { }
          package view PackageOnly() { }
          workspace view WorkspaceVisible() { }
          public view Published() { }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parsed = await workspace.parse(paths['Main.tao']!)
        const imported = parsed.entry.ast.statements.find(AST.isUseStatement)?.importedDeclarations ?? []

        Expect(imported.map(reference => reference.ref?.name)).toEqual([
          undefined,
          undefined,
          'WorkspaceVisible',
          'Published',
        ])
        Expect(Diagnostics.errorMessages(parsed.diagnostics).join('\n')).toContain(
          "Could not resolve reference to Declaration named 'Hidden'",
        )
        Expect(Diagnostics.errorMessages(parsed.diagnostics).join('\n')).toContain(
          "Could not resolve reference to Declaration named 'PackageOnly'",
        )
      },
    )
  })

  Test('reports duplicate visible names in one generated subfolder', async () => {
    await withTaoFiles(
      'tao-workspace-generated-duplicates-',
      {
        'Main.tao': `
          use Duplicate from @/studio
          view MainView() { render Duplicate() }
        `,
        '@/studio/First.tao': 'workspace view Duplicate() { }',
        '@/studio/Second.tao': 'workspace view Duplicate() { }',
      },
      async (paths, rootDir) => {
        const validation = await (await Workspace.open(rootDir)).validate(paths['Main.tao']!)

        Expect(errorMessages(validation)).toContain(
          "'Duplicate' matches multiple visible declarations in '@/studio'.",
        )
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
          workspace view MainView() {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
        'two/@bar/Main.tao': `
          workspace view MainView() {
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
        'Main.tao': 'view MainView() { }\n',
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

  Test('validates multiple app files as independent entry graphs', async () => {
    await withTaoFiles(
      'tao-workspace-multiple-entries-',
      {
        'First.tao': `
          app First { view FirstView }
          view FirstView() { render inject ${tsFence} return null ${fence} }
        `,
        'Second.tao': `
          app Second { view SecondView }
          view SecondView() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async (paths, rootDir) => {
        const validation = await (await Workspace.open(rootDir)).validateFiles([
          paths['First.tao'],
          paths['Second.tao'],
        ])

        Expect(errorMessages(validation)).toEqual([])
        Expect(validation.entry.path).toBe(paths['First.tao'])
        Expect(validation.files.map(file => file.path)).toEqual(
          Expect['arrayContaining']([paths['First.tao'], paths['Second.tao']]),
        )
      },
    )
  })

  Test('skips hidden future-source directories while preloading LSP documents', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-sketches-',
      {
        'Main.tao': 'view MainView() { }\n',
        'Apps/WordFlower/.tao-archive/Future.tao': 'project app FutureMVP {',
        'Apps/WordFlower/1 - Current/Valid.tao': 'view ValidCurrentMVP() { }\n',
        'Roadmap/Feature/Syntax Sketches/Valid.tao': 'view ValidSyntaxSketch() { }\n',
      },
      async (_paths, rootDir) => {
        const workspace = await LSPWorkspace.open(rootDir)
        const loadedPaths = Array.from(workspace.services.shared.workspace.LangiumDocuments.all)
          .map(document => document.uri.fsPath)

        Expect(loadedPaths.filter(path => path.startsWith(rootDir))).toEqual([
          FS.resolvePath('Apps/WordFlower/1 - Current/Valid.tao', rootDir),
          FS.resolvePath('Main.tao', rootDir),
          FS.resolvePath('Project.tao', rootDir),
          FS.resolvePath('Roadmap/Feature/Syntax Sketches/Valid.tao', rootDir),
        ])
      },
    )
  })

  // The IDE links references only against loaded documents, so a stdlib the workspace root does not
  // happen to contain leaves every `@tao/…` import unresolved. Developing on Tao itself hides this,
  // because there the stdlib sits inside the open repository; a packaged extension carries it in the
  // extension directory instead.
  Test('preloads stdlib documents from outside the workspace root', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-stdlib-',
      { 'Main.tao': 'view MainView() { }\n' },
      async (_paths, rootDir) => {
        const workspace = await LSPWorkspace.open(rootDir)
        const loadedPaths = Array.from(workspace.services.shared.workspace.LangiumDocuments.all)
          .map(document => document.uri.fsPath)
        const stdlibPath = loadedPaths.find(path => path.endsWith('@tao/nav/Navigation.tao'))

        Expect(stdlibPath).toBeDefined()
        Expect(stdlibPath!.startsWith(rootDir)).toBe(false)
      },
    )
  })

  // The editor and `tao check` must agree. Langium registration once ran only the structural pass,
  // so inferred-type diagnostics — invalid `do` targets, `set` type mismatches — were accepted in
  // the editor and rejected on the command line.
  Test('reports identical structural and inferred-type diagnostics through LSP and standalone validation', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-parity-',
      {
        'Main.tao': `
          app Demo { view MainView }
          view MainView() {
            state Count = 0
            let Greeting = "Hello"
            action Run() {
              do Greeting()
              set Count = "text"
            }
            action Run() { }
            render Text("Ready")
          }
          view Text(Value text) {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
      },
      async (paths, rootDir) => {
        const entryPath = paths['Main.tao']
        const standalone = (await (await Workspace.open(rootDir)).validate(entryPath)).diagnostics
          .filter(diagnostic => diagnostic.filePath === entryPath)
          .map(diagnostic => diagnostic.message)

        // Structural diagnostics precede inferred-type diagnostics for a file on both paths.
        Expect(standalone).toEqual([
          "Duplicate name 'Run'.",
          'do expects an action, got text.',
          "State 'Count' expects number, got text.",
        ])
        Expect(await lspDiagnosticMessages(rootDir, entryPath)).toEqual(standalone)
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
          "Test 'Empty' must start exactly one app with run.",
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
          view MainView() { }
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

/** lspDiagnosticMessages returns the Langium validation messages for one workspace file. */
async function lspDiagnosticMessages(rootDir: string, entryPath: string): Promise<string[]> {
  const workspace = await LSPWorkspace.open(rootDir)
  const documents = workspace.services.shared.workspace.LangiumDocuments
  const document = Array.from(documents.all).find(document => document.uri.path === entryPath)

  Expect(document).toBeDefined()
  await workspace.services.shared.workspace.DocumentBuilder.build([document!], {
    eagerLinking: true,
    validation: true,
  })
  // LSP 3.18 allows MarkupContent diagnostic messages; these assertions compare plain text.
  return (document!.diagnostics ?? []).map(diagnostic =>
    typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value
  )
}

function errorMessages(result: { diagnostics: readonly Diagnostic[] }): string[] {
  return Diagnostics.errorMessages(result.diagnostics)
}
