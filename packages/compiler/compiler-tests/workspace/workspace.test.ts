import { Packages } from '@ast-utils'
import { AST, Langium } from '@parser'
import { type Diagnostic, Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test, until, withTaoFiles } from '@shared/test'
import { BridgeMetadata } from '../../compiler-src/bridge-metadata'
import { LSPWorkspace, Workspace } from '../../compiler-src/workspace/index'
import { createWorkspaceLspServices } from '../../compiler-src/workspace/langium-services'

const tsFence = '```ts'
const fence = '```'

Describe('directory-rooted Tao workspace pipeline', () => {
  Test('resolves the reserved root package, nested generated folders, project-relative data, and stdlib', async () => {
    await withTaoFiles(
      'tao-workspace-generated-root-',
      {
        'Main.tao': `
          use RootView from @
          use GeneratedView from @/studio
          use NestedView from @/studio/nested

          app GeneratedApp { id "com.tao.test.generatedapp" version "1.0.0" name "GeneratedApp"  view MainView }
          view MainView() { render GeneratedView() }
        `,
        'Data.tao': 'project let SharedTitle = "Generated title"',
        '@/Root.tao': `project view RootView() { render inject ${tsFence} return null ${fence} }`,
        '@/studio/View.tao': `
          use SharedTitle from ../../Data
          use Text from @tao/ui
          public view GeneratedView() { render Text(SharedTitle) }
        `,
        '@/studio/nested/Nested.tao': `
          project view NestedView() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parseResult = await workspace.parse(paths['Main.tao']!)
        const compiled = await workspace.compile(paths['Main.tao']!)
        const imports = parseResult.entry.ast.statements.filter(AST.isUseStatement)

        Expect(imports.map(statement => statement.importedDeclarations[0]?.target.ref?.name)).toEqual([
          'RootView',
          'GeneratedView',
          'NestedView',
        ])
        Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['@/studio/View.tao'])
        Expect(compiled.files.map(file => file.sourcePath)).toContain(paths['Data.tao'])
        Expect(compiled.files.map(file => file.sourcePath)).toContain(
          Repo.resolvePath('packages/apps/stdlib/@tao/Prelude.tao'),
        )
        Expect(compiled.files.map(file => file.sourcePath)).toContain(
          Repo.resolvePath('packages/apps/stdlib/@tao/data/ReadContext.tao'),
        )
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
          project view WorkspaceVisible() { }
          public view Published() { }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const parsed = await workspace.parse(paths['Main.tao']!)
        const imported = parsed.entry.ast.statements.find(AST.isUseStatement)?.importedDeclarations ?? []

        Expect(imported.map(reference => reference.target.ref?.name)).toEqual([
          undefined,
          undefined,
          'WorkspaceVisible',
          'Published',
        ])
        Expect(Diagnostics.errorMessages(parsed.diagnostics).join('\n')).toContain(
          "No declaration named 'Hidden'",
        )
        Expect(Diagnostics.errorMessages(parsed.diagnostics).join('\n')).toContain(
          "No declaration named 'PackageOnly'",
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
        '@/studio/First.tao': 'project view Duplicate() { }',
        '@/studio/Second.tao': 'project view Duplicate() { }',
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
          app DuplicatePackageApp { id "com.tao.test.duplicatepackageapp" version "1.0.0" name "DuplicatePackageApp"  view MainView }
          use MainView from @bar
        `,
        'one/@bar/Main.tao': `
          project view MainView() {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
        'two/@bar/Main.tao': `
          project view MainView() {
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

  Test('opens one root concurrently with independent contexts that settle', async () => {
    await withTaoFiles(
      'tao-workspace-duplicate-open-',
      {
        'Main.tao': 'view MainView() { }\n',
      },
      async (paths, rootDir) => {
        const [first, second] = await until(
          async () =>
            await Promise.all([
              Workspace.open(rootDir),
              Workspace.open(FS.resolvePath('.', rootDir)),
            ]),
          // The budget is for a busy host, not for a slow open: both opens finish in well under a
          // second alone, and two seconds lost twice in one day to lanes sharing the machine.
          { description: 'two independent workspaces for the same root', timeoutMs: 10_000 },
        )

        Expect(first).not.toBe(second)
        Expect((await first.parse(paths['Main.tao']!)).diagnostics).toEqual([])
        Expect((await second.parse(paths['Main.tao']!)).diagnostics).toEqual([])
      },
    )
  })

  Test('validates multiple app files as independent entry graphs', async () => {
    await withTaoFiles(
      'tao-workspace-multiple-entries-',
      {
        'First.tao': `
          app First { id "com.tao.test.first" version "1.0.0" name "First"  view FirstView }
          view FirstView() { render inject ${tsFence} return null ${fence} }
        `,
        'Second.tao': `
          app Second { id "com.tao.test.second" version "1.0.0" name "Second"  view SecondView }
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

  Test('reads project identity across the batch so an unimported generated entry still has one', async () => {
    await withTaoFiles(
      'tao-workspace-generated-entry-identity-',
      {
        'Main.tao': `
          package { version "1.0.0" license AGPL-3.0-only }
          app Sketching { id "com.tao.test.sketching" version "1.0.0" name "Sketching"  view MainView }
          view MainView() { render inject ${tsFence} return null ${fence} }
        `,
        // Drawn in Studio and not imported by the app. Project metadata is still visible, because
        // a validate reads the workspace rather than only the file's own entry graph.
        '@/studio/View1.tao': `
          use Text from @tao/ui
          public view View1() { render Text("View1") }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const alone = await workspace.validate(paths['@/studio/View1.tao']!)
        const batched = await workspace.validateFiles([paths['Main.tao'], paths['@/studio/View1.tao']])

        Expect(errorMessages(alone)).toEqual([])
        Expect(errorMessages(batched)).toEqual([])
        Expect(batched.entry.path).toBe(paths['Main.tao'])
        Expect(batched.files.map(file => file.path)).toEqual(
          Expect['arrayContaining']([paths['Main.tao'], paths['@/studio/View1.tao']]),
        )
      },
    )
  })

  // The app selects the design. A package file that imports no app still sees that selection,
  // because validation reads the workspace rather than only the file's own entry graph.
  // REMOVAL CANDIDATE: Region membership coverage also reads the app-selected design across the batch; this simpler case adds style-bundle resolution.
  Test('reads the selected design across the batch so an unimported package file keeps its tags', async () => {
    await withTaoFiles(
      'tao-workspace-batch-design-',
      {
        'Main.tao': `
          package { version "1.0.0" license AGPL-3.0-only }
          app Shell { id "com.tao.test.shell" version "1.0.0" name "Shell"  view PanelView Design ShellDesign }
          use PanelView from @ui
          design ShellDesign { styles { panel [gap 4] } }
        `,
        '@ui/Panel.tao': `
          use Col from @tao/ui
          public view PanelView() { render Col() [panel] { } }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const alone = await workspace.validate(paths['@ui/Panel.tao']!)
        const batched = await workspace.validateFiles([paths['Main.tao'], paths['@ui/Panel.tao']])

        Expect(errorMessages(alone)).toEqual([])
        Expect(errorMessages(batched)).toEqual([])
      },
    )
  })

  // Region membership is decided by whichever file renders the view, which is routinely a sibling
  // the view's own file does not import. The batch parses each entry into its own AST, so the
  // member check has to identify a declaration by file and name rather than by node identity.
  Test('reads interaction region members across the batch, matching declarations across entry graphs', async () => {
    await withTaoFiles(
      'tao-workspace-batch-regions-',
      {
        'Main.tao': `
          package { version "1.0.0" license AGPL-3.0-only }
          use BarView from @ui
          use Col from @tao/ui
          use StackNav from @tao/nav
          design ShellDesign { colors { accent #123456 } }
          nav ShellNav = StackNav { Initial HomeView }
          view HomeView() { render inject ${tsFence} return null ${fence} }
          scene ShellView(Navigator nav) {
             render Col() {
                Navigator()
                BarView()
             }
          }
          app Shell { id "com.tao.test.shell" version "1.0.0"
             name "Shell"
             Design ShellDesign
             view ShellView(ShellNav)
          }
        `,
        // The bar states its own focus condition. The shell that renders it into a region is a
        // sibling this file does not import, and validation still sees that shell.
        '@ui/Bar.tao': `
          use Row from @tao/ui
          public view BarView() { render Row() [border accent when BarView is active] { } }
        `,
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)
        const alone = await workspace.validate(paths['@ui/Bar.tao']!)
        const batched = await workspace.validateFiles([paths['Main.tao'], paths['@ui/Bar.tao']])

        Expect(errorMessages(alone)).toEqual([])
        Expect(errorMessages(batched)).toEqual([])
      },
    )
  })

  Test('skips hidden future-source directories while preloading LSP documents', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-sketches-',
      {
        'Main.tao': 'view MainView() { }\n',
        'Apps/WordFlower/.tao-archive/Future.tao':
          'project app FutureMVP { id "com.tao.test.futuremvp" version "1.0.0" name "FutureMVP" ',
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
          FS.resolvePath('Roadmap/Feature/Syntax Sketches/Valid.tao', rootDir),
        ])
      },
    )
  })

  Test('keeps same-named packages local to sibling projects in one LSP workspace', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-project-packages-',
      {
        'First/.tao/.gitkeep': '',
        'Second/.tao/.gitkeep': '',
        'First/Main.tao': `
          use Label from @data
          use Text from @tao/ui
          package { version "1.0.0" license AGPL-3.0-only }
          app FirstApp { id "com.tao.test.firstapp" version "1.0.0" name "FirstApp"  view FirstView }
          action Run() { }
          command FirstCommand() { Title "First" Key "g" do Run() }
          view FirstView() { render Text(Label) }
        `,
        'First/@data/Data.tao': 'project let Label = "First label"',
        'Second/Main.tao': `
          use Label from @data
          use Text from @tao/ui
          package { version "1.0.0" license AGPL-3.0-only }
          app SecondApp { id "com.tao.test.secondapp" version "1.0.0" name "SecondApp"  view SecondView }
          action Run() { }
          command SecondCommand() { Title "Second" Key "g" do Run() }
          view SecondView() { render Text(Label) }
        `,
        'Second/@data/Data.tao': 'project let Label = "Second label"',
      },
      async (paths, rootDir) => {
        const workspace = await LSPWorkspace.open(rootDir)
        const documents = workspace.services.shared.workspace.LangiumDocuments
        const first = documents.getDocument(Langium.URI.file(paths['First/Main.tao']!))!
        const second = documents.getDocument(Langium.URI.file(paths['Second/Main.tao']!))!
        await workspace.services.shared.workspace.DocumentBuilder.build([first, second], {
          eagerLinking: true,
          validation: true,
        })

        Expect(lspErrorMessages(first.diagnostics ?? [])).toEqual([])
        Expect(lspErrorMessages(second.diagnostics ?? [])).toEqual([])
        const firstFile = first.parseResult.value
        const secondFile = second.parseResult.value
        Expect.Is(firstFile, AST.isTaoFile)
        Expect.Is(secondFile, AST.isTaoFile)
        const firstImported = firstFile.statements.filter(AST.isUseStatement).find(use => use.importPath === '@data')
          ?.importedDeclarations[0]?.target.ref
        const secondImported = secondFile.statements.filter(AST.isUseStatement).find(use => use.importPath === '@data')
          ?.importedDeclarations[0]?.target.ref
        Expect(firstImported && AST.getDocument(firstImported).uri.path).toBe(paths['First/@data/Data.tao'])
        Expect(secondImported && AST.getDocument(secondImported).uri.path).toBe(paths['Second/@data/Data.tao'])
        for (const file of [firstFile, secondFile]) {
          const text = file.statements.filter(AST.isUseStatement).find(use => use.importPath === '@tao/ui')
            ?.importedDeclarations[0]?.target.ref
          Expect(text).toBeDefined()
        }
      },
    )
  })

  Test('keeps an in-workspace stdlib visible while validating a nested project', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-contained-stdlib-',
      {
        'App/.tao/.gitkeep': '',
        'App/Main.tao': `
          package { version "1.0.0" license AGPL-3.0-only }
          use StdLabel from @tao/ui
          project let Selected = StdLabel
        `,
        'stdlib/@tao/ui/Labels.tao': 'public let StdLabel = "Stdlib"',
      },
      async (paths, rootDir) => {
        const packagesContext = await Packages.createContext(rootDir, {
          stdlibRoot: FS.resolvePath('stdlib', rootDir),
        })
        const services = createWorkspaceLspServices(packagesContext)
        const documents = services.shared.workspace.LangiumDocuments
        const factory = services.shared.workspace.LangiumDocumentFactory
        const app = await factory.fromUri(Langium.URI.file(paths['App/Main.tao']!))
        const label = await factory.fromUri(Langium.URI.file(paths['stdlib/@tao/ui/Labels.tao']!))
        documents.addDocument(app)
        documents.addDocument(label)
        await services.shared.workspace.DocumentBuilder.build([app, label], {
          eagerLinking: true,
          validation: true,
        })

        Expect(lspErrorMessages(app.diagnostics ?? [])).toEqual([])
        const file = app.parseResult.value
        Expect.Is(file, AST.isTaoFile)
        const imported = file.statements.find(AST.isUseStatement)?.importedDeclarations[0]?.target.ref
        Expect(imported && AST.getDocument(imported).uri.path).toBe(paths['stdlib/@tao/ui/Labels.tao'])
      },
    )
  })

  Test('opens a nested editor folder at its inline-declared project root', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-containing-project-',
      {
        'App/Main.tao': 'package { version "1.0.0" license AGPL-3.0-only }',
        'App/@data/Data.tao': 'project let Label = "Local"',
        'App/screens/View.tao': 'use Label from @data\nproject let Selected = Label',
      },
      async (paths, rootDir) => {
        const projectRoot = FS.resolvePath('App', rootDir)
        const workspace = await LSPWorkspace.open(FS.resolvePath('screens', projectRoot))
        const document = workspace.services.shared.workspace.LangiumDocuments
          .getDocument(Langium.URI.file(paths['App/screens/View.tao']!))!
        await workspace.services.shared.workspace.DocumentBuilder.build([document], { eagerLinking: true })
        const file = document.parseResult.value
        Expect.Is(file, AST.isTaoFile)
        const imported = file.statements.find(AST.isUseStatement)?.importedDeclarations[0]?.target.ref

        Expect(workspace.root).toBe(FS.resolvePath('screens', projectRoot))
        Expect(imported && AST.getDocument(imported).uri.path).toBe(paths['App/@data/Data.tao'])
      },
    )
  })

  // The editor reports linking errors through Langium's document validator, not through the CLI's
  // diagnostics pass, so the bridge exemption has to hold on that path too. It once held only on the
  // CLI side, and every `Name from ./File.ts` read as a missing Tao declaration in the editor.
  Test('does not report a bridged TypeScript export as an unresolved reference in the editor', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-bridge-',
      {
        'Main.tao': `
          use Http from @tao/data/providers/http
          type StubSource is Http with {
            Adapter item is StubAdapter from ./StubAdapter.ts
          }
          let Broken = Missing
        `,
        'StubAdapter.ts': 'export const StubAdapter = {}\n',
      },
      async (paths, rootDir) => {
        const workspace = await LSPWorkspace.open(rootDir)
        const uri = Langium.URI.file(paths['Main.tao']!)
        const documents = workspace.services.shared.workspace.LangiumDocuments
        const document = documents.getDocument(uri) ?? await documents.getOrCreateDocument(uri)
        await workspace.services.shared.workspace.DocumentBuilder.build([document], { validation: true })
        const messages = (document.diagnostics ?? []).map(diagnostic => diagnostic.message)

        Expect(messages.join('\n')).not.toContain("named 'StubAdapter'")
        // An ordinary unresolved name on the same path is still reported.
        Expect(messages.join('\n')).toContain("named 'Missing'")
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
          app Demo { id "com.tao.test.demo" version "1.0.0" name "Demo"  view MainView }
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

  // `tao check` records the loaded workspace before it builds, and folder visibility reads that
  // record. The editor used to build without recording it, so a `folder` type in a sibling file
  // was an unknown type there while the checker accepted it.
  Test('resolves a folder-visible sibling type in the editor the same way the checker does', async () => {
    await withTaoFiles(
      'tao-workspace-lsp-folder-type-',
      {
        'Types.tao': `
          folder
          type SharedPanel is { Status text }
          type SecretPanel is { Status text }
        `,
        'Main.tao': `
          view Open(Shared SharedPanel, Secret SecretPanel) {
            render Text(Shared.Status)
          }
          view Text(Value text) {
            render inject ${tsFence}
              return null
            ${fence}
          }
        `,
      },
      async (paths, rootDir) => {
        const entryPath = paths['Main.tao']!
        const standalone = (await (await Workspace.open(rootDir)).validate(entryPath)).diagnostics
          .filter(diagnostic => diagnostic.filePath === entryPath)
          .map(diagnostic => diagnostic.message)

        Expect(standalone).toEqual(["Unknown type 'SecretPanel'."])
        Expect(await lspDiagnosticMessages(rootDir, entryPath)).toEqual(standalone)
      },
    )
  })

  // The invalid source here is deliberately one the compiler can still lower: step order is a
  // semantic rule, not a shape the plan compiler asserts on, so skipping validation yields a real
  // plan rather than trading one refusal for another.
  Test('can compile test plans without rerunning semantic validation', async () => {
    await withTaoFiles(
      'tao-workspace-test-plan-skip-validation-',
      {
        'Main.test.tao':
          'test "Suite" {\n   test "out of order" {\n      expect text "Hello"\n      run MyApp\n   }\n}\n'
          + 'app MyApp { id "com.tao.test.myapp" version "1.0.0" name "MyApp"  view MainView }\nview MainView() { }\n',
      },
      async (paths, rootDir) => {
        const workspace = await Workspace.open(rootDir)

        await Expect(workspace.compileTestPlan(paths['Main.test.tao']!)).rejects.toThrow(
          'Test steps must come after the run step.',
        )
        const plan = await workspace.compileTestPlan(paths['Main.test.tao']!, { skipValidation: true })

        Expect(plan.suites[0]?.name).toBe('Suite')
        Expect(plan.suites[0]?.checks.map(check => check.name)).toEqual(['out of order'])
      },
    )
  })

  // Contract planning uses the containing project root even when the workspace opened in a subfolder.
  // Compilation leaves publication of that hidden contract to the caller.
  Test('plans an imported bridge contract under its containing project root without publishing it', async () => {
    await withTaoFiles(
      'tao-workspace-bridge-project-root-',
      {
        'App/.tao/.gitkeep': '',
        'App/@data/Data.tao': 'project action Read() returns text from ./Bindings.ts',
        'App/@data/Bindings.ts': 'export const Read = () => "read"\n',
        'App/screens/Main.tao': `
          use Read from @data
          app BridgeRoot { id "com.tao.test.bridge-root" version "1.0.0" name "Bridge Root" view MainView }
          view MainView() {
            action Load() { let Value = do Read() }
            render Empty()
          }
          view Empty() { render inject ${tsFence} return null ${fence} }
        `,
      },
      async (paths, rootDir) => {
        const projectRoot = FS.resolvePath('App', rootDir)
        const workspace = await Workspace.open(FS.resolvePath('App/screens', rootDir))

        for (let compile = 0; compile < 2; compile += 1) {
          const compiled = await workspace.compile(paths['App/screens/Main.tao']!)
          Expect(errorMessages(compiled.validation)).toEqual([])
          const contract = BridgeMetadata.collect(compiled.validation.files, projectRoot).find(module =>
            module.sourcePath === paths['App/@data/Data.tao']
          )
          Expect(contract?.path).toBe(FS.resolvePath('.tao-ts/@data/Data.tao.ts', projectRoot))
          Expect(contract?.code).toContain('Sidecar.Read')
        }

        Expect(await FS.isFile(FS.resolvePath('.tao-ts/@data/Data.tao.ts', projectRoot))).toBe(false)
        Expect(await FS.isFile(Repo.resolvePath('packages/apps/stdlib/@tao/Prelude.tao.ts'))).toBe(false)
      },
    )
  })

  Test('rejects entry files outside the workspace root', async () => {
    await withTaoFiles(
      'tao-workspace-root-',
      {
        'Main.tao': `
          app RootApp { id "com.tao.test.rootapp" version "1.0.0" name "RootApp"  view MainView }
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

function lspErrorMessages(
  diagnostics: readonly { message: string | { value: string }; severity?: number }[],
): string[] {
  return diagnostics
    .filter(diagnostic => diagnostic.severity === 1)
    .map(diagnostic => typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value)
}
