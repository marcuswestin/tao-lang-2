import { Workspace } from '@compiler/workspace'
import {
  app,
  Describe,
  Expect,
  primitiveAppValueSpellings,
  stubContainer,
  stubView,
  Test,
  withTaoFiles,
} from '@shared/test'
import { TestCompiler as Compiler, withCompiledTestPlan } from './test-compile'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: language lowering', () => {
  Test('preserves release project metadata in generated source provenance', async () => {
    const compiled = await Compiler.compileCode(`
      project {
        id "release-metadata"
        name "Release metadata"
        version "1.2.3"
        DefaultApp ReleaseApp
      }
      app ReleaseApp { view Home }
      ${stubView('Home')}
    `)

    Expect(compiled.code).toContain(
      '// project { id "release-metadata" name "Release metadata" version "1.2.3" DefaultApp ReleaseApp }',
    )
  })

  Test('lowers app-owned actions and live bound-view arguments into configured navigation', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app BoundApp {
        Name "Bound"
        state Expanded is list of text = [] (persist)
        action ChangeExpanded(Value list of text) { set Expanded = Value }
        Navigator StackNav {
          Initial Root(Expanded: Expanded, ChangeExpanded: ChangeExpanded)
        }
      }
      scene Root(Expanded list of text, ChangeExpanded action(list of text)) {
        Title "Root"
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('_Scope.ChangeExpanded = TR.Action(')
    Expect(compiled.code).toContain('TR.Navigation.BindView(')
    Expect(compiled.code).toContain('["Expanded"]: TR.Alias(() => _Scope.Expanded.evaluate())')
    Expect(compiled.code).toContain('["ChangeExpanded"]: TR.Alias(() => _Scope.ChangeExpanded.evaluate())')
  })

  Test('keeps synchronous actions synchronous and marks ask responses as queue interrupts', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      use Button, Text from @tao/ui
      app Actions { Name "Actions" Navigator StackNav { Initial Main } }
      type Answer is one of Confirmed
      scene Main() {
        Title "Main"
        state Count = 0
        action Increment() { set Count += 1 }
        action AddOne() { do Increment() }
        action AskFirst() { let Result = ask Dialogue() }
        render Button("Increment") { on press AddOne }
      }
      view Dialogue() responds Answer {
        render Button("Confirm") { on press -> { respond Confirmed } }
      }
    `)

    Expect(compiled.code).toContain('_Scope.Increment = TR.Action(() =>')
    Expect(compiled.code).toContain('_Scope.AddOne = TR.Action(() =>')
    Expect(compiled.code).toContain('TR.Do(_Scope.Increment.evaluate())')
    Expect(compiled.code).not.toContain('await TR.Do(_Scope.Increment.evaluate())')
    Expect(compiled.code).toContain('_Scope.AskFirst = TR.Action(async () =>')
    Expect(compiled.code).toContain('{ interrupt: true }')
  })

  Test('lowers app persisted state as a writable SplitNav width binding', async () => {
    const compiled = await Compiler.compileCode(`
      use SplitNav from @tao/nav
      app Workspace {
        Name "Workspace"
        state PaneWidth is number = 320 (persist)
        Navigator SplitNav { @pane { Content Pane Width PaneWidth Resizable true } }
      }
      view Pane() { render inject ${tsFence} return null ${fence} }
    `)
    Expect(compiled.code).toContain('_Scope.PaneWidth = TR.PersistedState(')
    Expect(compiled.code).toContain('{ kind: "primitive", name: "number" }')
    Expect(compiled.code).toContain('"Width": _Scope.PaneWidth')
    Expect(compiled.code).toContain('TR.UsePersistedState(_Scope.PaneWidth)')
  })

  Test('lowers persisted case sets with a stable declaration identity', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      type Theme is one of Light, Dark
      app Workspace {
        Name "Workspace"
        state CurrentTheme is Theme = Light (persist)
        Navigator StackNav { Initial Main }
      }
      scene Main() { Title "Main" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('_Scope.Theme = TR.Enum(TR.Navigation.Identity(')
    Expect(compiled.code).toContain('["tao.declaration",1,')
    Expect(compiled.code).toContain('["Light", "Dark"])')
    Expect(compiled.code).toContain('{ kind: "enum", declaration: TR.Navigation.Identity(')
    Expect(compiled.code).toContain('.canonical, cases: ["Light", "Dark"] }')
  })

  Test('guards every generated recursive view frame at runtime', async () => {
    const compiled = await Compiler.compileCode(`
      app RecursiveApp { view Recursive }
      view Recursive() { render Recursive() }
    `)
    Expect(compiled.code).toContain('TR.AssertViewDepth(_ViewProps.__tao, "Recursive")')
    Expect(compiled.code).toContain('TR.ViewTaoProps(')

    const studio = await Compiler.compileCode(
      `
      app RecursiveApp { view Recursive }
      view Recursive() { render Recursive() }
    `,
      { studio: true },
    )
    Expect(studio.code).toContain('function TaoGeneratedView_Recursive(')
    Expect(studio.code).toContain('_Scope.Recursive = TaoGeneratedView_Recursive')
  })

  Test('propagates view depth through nested render statements without inheriting layout props', async () => {
    const compiled = await Compiler.compileCode(`
      app RecursiveApp { view Recursive }
      view Recursive() {
        render Frame() { if true { render Recursive() } }
      }
      view Frame() { render inject Content @@content \`\`\`ts return Content \`\`\` }
    `)
    Expect(compiled.code).toContain('}, _ViewProps.__tao, false)} />')
  })
  Test('compiles bare app slot blocks through their inferred declaration identities', async () => {
    const compiled = await Compiler.compileCode(`
      public type Navigator is nav with {
        Initial view
        nav TestNavImpl from ./TestNavImpl.ts
      }
      public type Datasource is datasource with {
        StorageKey text
        provider TestProviderImpl from ./TestProviderImpl.ts
      }
      app Demo {
        Name "Demo"
        Navigator { Initial Home }
        Datasource { StorageKey "demo" }
      }
      view Home() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_Navigator, {')
    Expect(compiled.code).toContain('TR.Data.Configure(_Scope.__tao_type_Datasource, {')
    Expect(compiled.code).toContain('"StorageKey": TR.Value("demo")')
  })

  Test('materializes defaulted and filled declaration slots in constructed values', async () => {
    const compiled = await Compiler.compileCode(app(
      'render Text(Draft.Title)',
      `
        type Document is {
          Name text,
          Title text is "Untitled",
          Kind is "document",
        }
        let Draft = Document { Name "Roadmap" }
        ${stubView('Text', 'Value text')}
      `,
    ))

    Expect(compiled.code).toContain('["Name"]: TR.Value("Roadmap").jsValue')
    Expect(compiled.code).toContain('["Title"]: TR.Value("Untitled").jsValue')
    Expect(compiled.code).toContain('["Kind"]: TR.Value("document").jsValue')
  })

  Test('compiles a complete app value constructed from a reusable app type', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      public type ReusableApp is app with {
        Name text is "Reusable"
      }
      let Product = ReusableApp {
        Navigator StackNav { Initial Home }
      }
      scene Home() { Title "Home" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.appNames).toEqual(['Product'])
    Expect(compiled.code).toContain('declaration: TR.Navigation.AppDeclaration("Product", TR.Navigation.Identity(')
    Expect(compiled.code).toContain('name: TR.Value("Reusable").evaluate().jsValue as string')
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_StackNav, {')
    Expect(compiled.code).toContain('<TR.Navigation.AppHost')
    Expect(compiled.code).not.toContain('__tao_type_ReusableApp')
    Expect(compiled.code).not.toContain('TR.Data.Declaration("ReusableApp"')
  })

  Test('compiles every primitive app value spelling with referenced navigation values', async () => {
    const compiled = await Compiler.compileCode(primitiveAppValueSpellings(), { appName: 'LetWithApp' })

    Expect(compiled.appNames).toEqual(['HeadApp', 'HeadWithApp', 'LetApp', 'LetWithApp'])
    for (const name of compiled.appNames) {
      Expect(compiled.code).toContain(`TR.Navigation.AppDeclaration("${name}", TR.Navigation.Identity(`)
    }
    Expect(compiled.code).toContain('export default TaoApps["LetWithApp"]')
  })

  Test('compiles restoration policy and variant-specific storage identity into the app host definition', async () => {
    const compiled = await Compiler.compileCode(
      `
      use StackNav from @tao/nav
      app Base {
        Name "Base"
        Navigator StackNav { Initial Home }
        Restore automatic { Exclude sheets, menus }
      }
      app Preview = Base with { Restore fresh }
      scene Home() { Title "Home" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'Preview' },
    )

    Expect(compiled.code).toContain('exclusions: ["sheets","menus"]')
    Expect(compiled.code).toContain('mode: "automatic"')
    Expect(compiled.code).toContain('mode: "fresh"')
    Expect(compiled.code).toContain('variant: "Preview"')
  })

  Test('compiles derived item slots, inferred bare values, and generic immutable patches', async () => {
    const compiled = await Compiler.compileCode(app(
      'render Text(Renamed.Name)',
      `
        type Person is { Name text, Role text is "member" }
        type Admin is Person with { Role is "admin", Access number is 1 }
        let Admin = { Name "Ro" }
        let Renamed = Admin with { Name "Grace", Access 2 }
        ${stubView('Text', 'Value text')}
      `,
    ))

    Expect(compiled.code).toContain('["Role"]: TR.Value("admin").jsValue')
    Expect(compiled.code).toContain('["Access"]: TR.Value(1).jsValue')
    Expect(compiled.code).toContain('..._Scope.Admin.evaluate().jsValue')
    Expect(compiled.code).toContain('["Name"]: TR.Value("Grace").jsValue')
    Expect(compiled.code).toContain('["Access"]: TR.Value(2).jsValue')
  })

  Test('compiles the top-level data catalog, inferred relations, defaults, and explicit Local key', async () => {
    const compiled = await Compiler.compileCode(`
      use Local from @tao/data/providers/local
      use StackNav from @tao/nav
      data Workspaces / Workspace {
        Name text (unique)
        CreatedAt time (default now)
        Pinned yes / no
        Documents (owned)
        index CreatedAt
        order by CreatedAt desc
      }
      data Documents / Document {
        Title text (title)
        Final yes / Draft no
        Public yes / Private no (default Public)
        Workspace
        Paragraphs (owned)
      }
      data Paragraphs / Paragraph {
        Text text
        Ordering number
        Document
        order by Ordering
      }
      app Notes {
        Name "Notes"
        Navigator StackNav { Initial Main }
        Datasource Local { StorageKey "WordFlowerData" }
      }
      scene Main() {
        Title "Main"
        query Workspaces { limit 25 }
        action Add() { create Workspace { Name: "Home" } }
        render Text("Main")
      }
      view Detail(Workspace) {
        action AddDocument() { create Document { Title: "Draft", Workspace } }
        render Col() {
          Text("Detail")
          query Drafts from Workspace.Documents { where is Draft }
          Text("Drafts: { Drafts.Count }")
          loop Drafts / Draft { Text(Draft.Title) }
        }
      }
      view Editor(Document) {
        action Finish() { update Document { Final } }
        action Reopen() { update Document { Draft } }
        render Text("Editor")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
      view Col() { render inject Content @@content ${tsFence} return Content ${fence} }
    `)

    Expect(compiled.code).toContain("name: 'Data'")
    Expect(compiled.code).toContain('collection: "Workspaces"')
    Expect(compiled.code).toContain('indexed: true')
    Expect(compiled.code).toContain('defaultOrder: { field: "CreatedAt", direction: "desc" }')
    Expect(compiled.code).toContain('inverseField: "Workspace"')
    Expect(compiled.code).toContain('defaultValue: false')
    Expect(compiled.code).toContain('defaultValue: true')
    Expect(compiled.code.match(/onDelete: 'cascade'/g)).toHaveLength(2)
    Expect(compiled.code).toContain('inverseField: "Document"')
    Expect(compiled.code).toContain('TR.Data.Configure(_Scope.__tao_type_Local, {')
    Expect(compiled.code).toContain('"StorageKey": TR.Value("WordFlowerData")')
    Expect(compiled.code).toContain('_Scope._TaoDataCatalog')
    Expect(compiled.code).toContain('["Final"]: TR.Value(true)')
    Expect(compiled.code).toContain('["Final"]: TR.Value(false)')
    Expect(compiled.code).toContain('TR.Data.Query')
    Expect(compiled.code).toContain('unique: true')
    Expect(compiled.code).toContain('title: true')
    Expect(compiled.code).toContain('limit: 25')
    Expect(compiled.code).toContain('field: "Workspace"')
    Expect(compiled.code).toContain("operator: '=='")
    Expect(compiled.code).toContain('TR.ForEach(_Scope.Drafts.evaluate()')
  })

  Test('partitions collections into one catalog per datasource an app binds', async () => {
    const compiled = await Compiler.compileCode(`
      use Local from @tao/data/providers/local
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Stories / Story { HnId number (unique) Title text }
      data Bookmarks / Bookmark { Story (reference) Note text (default "") }
      datasource Feed = Memory {
        Data { Stories }
      }
      datasource Personal = Local {
        StorageKey "personal"
        Data { Bookmarks }
      }
      app Reader {
        Name "Reader"
        Navigator StackNav { Initial Main }
        Datasource { Feed, Personal with { StorageKey "personal-prod" } }
      }
      scene Main() {
        Title "Reader"
        query Stories { }
        query Bookmarks { }
        action Save(Story) { create Bookmark { Story, Note: "kept" } }
        render Text("{ Stories.Count }{ Bookmarks.Count }")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    // One schema per store, named after the collections it holds rather than the datasource filling
    // it, and each carrying only its own collections.
    Expect(compiled.code).toContain("_Scope._TaoDataCatalog_Stories = TR.Data.Schema({\n  name: 'Stories',")
    Expect(compiled.code).toContain("_Scope._TaoDataCatalog_Bookmarks = TR.Data.Schema({\n  name: 'Bookmarks',")
    Expect(compiled.code).not.toContain("name: 'Data',")
    // Stores are emitted in name order, so Bookmarks precedes Stories.
    Expect(compiled.code.slice(compiled.code.indexOf("name: 'Bookmarks',"), compiled.code.indexOf("name: 'Stories',")))
      .toContain('collection: "Bookmarks"')
    Expect(compiled.code.slice(compiled.code.indexOf("name: 'Stories',")))
      .toContain('collection: "Stories"')
    // Reads and writes reach the store that holds their collection.
    Expect(compiled.code).toContain('TR.Data.Query(\n      _Scope._TaoDataCatalog_Stories,')
    Expect(compiled.code).toContain('TR.Data.Query(\n      _Scope._TaoDataCatalog_Bookmarks,')
    Expect(compiled.code).toContain('TR.Data.Create(\n              _Scope._TaoDataCatalog_Bookmarks,')
    // The app mounts both, and the patch on the listed name layers an app-local copy over the bound declaration
    // without touching the declaration itself.
    Expect(compiled.code).toContain('TR.Data.UseAppDatasources(_TaoAppDefinition_Reader.definition)')
    // Only the named datasource is patched; the other keeps the declaration's own configuration.
    Expect(compiled.code).toContain(
      'store: _Scope._TaoDataCatalog_Stories,\n            source: _Scope.Feed.evaluate(),',
    )
    Expect(compiled.code).toContain(
      'store: _Scope._TaoDataCatalog_Bookmarks,\n            source: TR.Data.Patch(_Scope.Personal.evaluate(), {',
    )
    Expect(compiled.code).toContain('"StorageKey": TR.Value("personal-prod")')
    // Membership is structural: it partitions the catalog and never crosses the provider boundary.
    Expect(compiled.code).not.toContain('"Data":')
    // A reference stores the target's unique value rather than a row handle in this store.
    Expect(compiled.code).toContain("kind: 'reference'")
    Expect(compiled.code).toContain('store: "Stories"')
    // The project's stores are linked, so a reference resolves among them and nowhere else.
    Expect(compiled.code).toContain(
      'TR.Data.LinkStores([_Scope._TaoDataCatalog_Bookmarks, _Scope._TaoDataCatalog_Stories])',
    )
  })

  Test('gives collection sets with the same underscore join distinct store identities', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data A_B / One { Value text }
      data C / Two { Value text }
      data A / Three { Value text }
      data B_C / Four { Value text }
      datasource First = Memory { Data { A_B, C } }
      datasource Second = Memory { Data { A, B_C } }
      app Distinct {
        Name "Distinct"
        Navigator StackNav { Initial Main }
        Datasource { First, Second }
      }
      ${stubView('Main')}
    `)

    Expect(compiled.code).toContain("name: '$3_A_B1_C'")
    Expect(compiled.code).toContain("name: '$1_A3_B_C'")
    Expect(compiled.code).toContain('_TaoDataCatalog_$3_A_B1_C')
    Expect(compiled.code).toContain('_TaoDataCatalog_$1_A3_B_C')
  })

  Test('patches a folder-visible datasource declared in a sibling file', async () => {
    await withTaoFiles('tao-folder-datasource-', {
      'Main.tao': `
        use StackNav from @tao/nav
        app Reader {
          Name "Reader"
          Navigator StackNav { Initial Main }
          Datasource { Feed, Personal with { StorageKey "prod" } }
        }
        ${stubView('Main')}
      `,
      'Sources.tao': `
        use Local from @tao/data/providers/local
        use Memory from @tao/data/providers/memory
        folder data Stories / Story { Title text }
        folder data Bookmarks / Bookmark { Note text }
        folder datasource Feed = Memory { Data { Stories } }
        folder datasource Personal = Local { StorageKey "personal" Data { Bookmarks } }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao']!)
      const code = result.files.map(file => file.code).join('\n')

      Expect(code).toContain('TR.Data.Patch(_Scope.Personal.evaluate(), {')
      Expect(code).toContain('"StorageKey": TR.Value("prod")')
      Expect(code).toContain('_Scope.Feed.evaluate()')
    })
  })

  Test('keeps one catalog for an app whose datasource claims no collections', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Stories / Story { HnId number (unique) Title text }
      data Bookmarks / Bookmark { Story (relation Story) }
      datasource Everything = Memory { }
      app Reader {
        Name "Reader"
        Navigator StackNav { Initial Main }
        Datasource Everything
      }
      scene Main() {
        Title "Reader"
        query Stories { }
        query Bookmarks { }
        render Text("{ Stories.Count }{ Bookmarks.Count }")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain("_Scope._TaoDataCatalog = TR.Data.Schema({\n  name: 'Data',")
    Expect(compiled.code).not.toContain('_TaoDataCatalog_')
    Expect(compiled.code).toContain('store: _Scope._TaoDataCatalog,\n            source: _Scope.Everything.evaluate(),')
  })

  Test('partitions local only entities into a device-local companion catalog', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Notes / Note { Title text }
      data FocusSessions / FocusSession {
        Label text

        local only
      }
      app Sessions {
        Name "Sessions"
        Navigator StackNav { Initial Main }
        Datasource Memory { }
      }
      scene Main() {
        Title "Sessions"
        query FocusSessions as CurrentSession { limit 1 }
        action Start() { create FocusSession { Label: "Focus" } }
        action Write() { create Note { Title: "Note" } }
        query Notes { }
        render Text("{ CurrentSession.Count }{ Notes.Count }")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain("_Scope._TaoDataCatalog = TR.Data.Schema({\n  name: 'Data',")
    Expect(compiled.code).toContain("_Scope._TaoLocalDataCatalog = TR.Data.Schema({\n  name: 'LocalData',")
    // The synced catalog keeps only the synced entity, and the local catalog only the local one.
    Expect(compiled.code.slice(compiled.code.indexOf("name: 'Data',"), compiled.code.indexOf("name: 'LocalData',")))
      .toContain('collection: "Notes"')
    Expect(compiled.code.slice(compiled.code.indexOf("name: 'LocalData',")))
      .toContain('collection: "FocusSessions"')
    Expect(compiled.code.slice(compiled.code.indexOf("name: 'LocalData',")))
      .not.toContain('collection: "Notes"')
    // The compiler-emitted datasource carries the stdlib Local declaration's own identity, so a
    // restored entity reference still resolves to the provider that wrote it.
    Expect(compiled.code).toContain(
      'TR.Navigation.Identity(["tao.declaration",1,"tao-stdlib","@tao/data","providers/local/Local","datasource","Local"])',
    )
    Expect(compiled.code).toContain("TR.Data.Declaration(\n    'Local',\n    __tao_local_datasource_provider__(),")
    Expect(compiled.code).toContain(
      "import { LocalProvider as __tao_local_datasource_provider__ } from './Local'",
    )
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/providers/local/Local.ts'))).toBe(true)
    // Two bindings at the app root: the authored Datasource, and the companion device-local one.
    Expect(compiled.code).toContain('store: _Scope._TaoDataCatalog,\n            source: TR.Data.Configure(')
    Expect(compiled.code).toContain('TR.Data.UseAppDatasources(_TaoAppDefinition_Sessions.definition)')
    Expect(compiled.code).toContain(
      'TR.Data.UseConfigured(\n            _Scope._TaoLocalDataCatalog,\n            _Scope._TaoLocalDatasource,\n          )',
    )
    // Reads and writes route to the catalog that stores the entity.
    Expect(compiled.code).toContain('_Scope.CurrentSession = TR.Data.Query(\n      _Scope._TaoLocalDataCatalog,')
    Expect(compiled.code).toContain('_Scope.Notes = TR.Data.Query(\n      _Scope._TaoDataCatalog,')
    Expect(compiled.code).toContain('_Scope._TaoLocalDataCatalog,\n              "FocusSession",')
    Expect(compiled.code).toContain('_Scope._TaoDataCatalog,\n              "Note",')
  })

  Test('imports the companion catalog into an app root that configures no datasource', async () => {
    await withTaoFiles('tao-local-only-', {
      'Project.tao': 'project { id "local-only-test" name "Local only test" }',
      'Catalog.tao': `
        workspace
        data FocusSessions / FocusSession {
          Label text

          local only
        }
      `,
      'Board.tao': `
        use FocusSessions from ./Catalog
        workspace
        view Board() {
          query FocusSessions { }
          render Label("{ FocusSessions.Count }")
        }
        view Label(Value text) { render inject ${tsFence} return null ${fence} }
      `,
      'Main.tao': `
        use Board from ./Board
        app Sessions { view Board }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao']!)
      const appModule = result.files.find(file => file.relativePath === 'App.tsx')

      Expect(appModule).toBeDefined()
      // An app binds the companion catalog whether or not it names a Datasource of its own, so the
      // bindings must reach a file that never mentions the catalog.
      Expect(appModule?.code).toContain(
        "import { _TaoLocalDataCatalog, _TaoLocalDatasource } from './modules/Catalog.tao'",
      )
      Expect(appModule?.code).toContain(
        'TR.Data.UseConfigured(\n            _Scope._TaoLocalDataCatalog,\n            _Scope._TaoLocalDatasource,\n          )',
      )
      Expect(appModule?.code).not.toContain('_Scope._TaoDataCatalog')
    })
  })

  Test("inherits, patches, or replaces a base's datasources across a module boundary", async () => {
    await withTaoFiles('tao-cross-module-datasource-', {
      'Project.tao': 'project { id "cross-module-datasource" name "Cross-module datasource" }',
      'Main.tao': `
        use Memory from @tao/data/providers/memory
        use MiddleApp from ./Middle.tao
        app FinalApp = MiddleApp with { Name "Final app" }
        app PatchedApp = MiddleApp with { Datasource with { ApiURI "http://localhost:9999" } }
        app OwnApp = MiddleApp with { Datasource Memory { } }
      `,
      'Middle.tao': `
        use InstantDB from @tao/data/providers/instantdb
        use PackageApp from @feature
        workspace app MiddleApp = PackageApp with {
          Name "Middle app"
          Datasource InstantDB { AppId "local-app" ApiURI "http://localhost:9020" }
        }
      `,
      'packages/@feature/App.tao': `
        use Text from @tao/ui
        data Records / Record { Label text }
        public app PackageApp { Name "Package app" view PackageHome }
        view PackageHome() { query Records { } render Text("{ Records.Count }") }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao']!, {
        appDatasourceConfiguration: { ApiURI: 'https://api.instantdb.com', AppId: 'hosted-app' },
        appName: 'PatchedApp',
      })
      const code = result.files.find(file => file.relativePath === 'App.tsx')?.code ?? ''
      const definitionOf = (name: string) => code.slice(code.indexOf(`const _TaoAppDefinition_${name} =`))

      // The base's InstantDB value is written against an import only Middle.tao has, so no variant
      // here may recompile it.
      Expect(code).not.toContain('__tao_type_InstantDB')
      const final = definitionOf('FinalApp')
      Expect(final.slice(0, final.indexOf('function TaoApp_FinalApp'))).toContain(
        'datasources: () => _Scope.MiddleApp.definition.datasources(),',
      )
      // The variant's own patch, then the release override for the selected app, in that order.
      Expect(definitionOf('PatchedApp')).toContain(
        'datasources: () => TR.Data.PatchBindings(_Scope.MiddleApp.definition.datasources(), [[{\n'
          + '      "ApiURI": TR.Value("http://localhost:9999"),\n'
          + '    }, {\n'
          + '      "ApiURI": TR.Value("https://api.instantdb.com"),\n'
          + '      "AppId": TR.Value("hosted-app"),\n'
          + '    }]]),',
      )
      Expect(definitionOf('OwnApp')).toContain(
        'datasources: () => [{\n            store: _Scope._TaoDataCatalog,\n            source: TR.Data.Configure(_Scope.__tao_type_Memory, {',
      )
    })
  })

  Test('emits no companion local catalog for a project without local only entities', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Notes / Note { Title text }
      app Notebook {
        Name "Notebook"
        Navigator StackNav { Initial Main }
        Datasource Memory { }
      }
      scene Main() {
        Title "Notebook"
        query Notes { }
        render Text("{ Notes.Count }")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain("name: 'Data'")
    Expect(compiled.code).not.toContain('_TaoLocalDataCatalog')
    Expect(compiled.code).not.toContain('_TaoLocalDatasource')
    Expect(compiled.code).not.toContain('__tao_local_datasource_provider__')
  })

  Test('resolves the Dev datasource package and copies its sidecar like any provider', async () => {
    const compiled = await Compiler.compileCode(`
      use Dev from @tao/data/providers/dev
      use StackNav from @tao/nav
      data Notes / Note { Title text }
      app Notebook {
        Name "Notebook"
        Navigator StackNav { Initial Main }
        Datasource Dev { }
      }
      scene Main() {
        Title "Notebook"
        query Notes { }
        render Text("{ Notes.Count }")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    // The app binds the stdlib declaration's own identity with an all-defaulted configuration.
    Expect(compiled.code).toContain("import { __tao_type_Dev } from './modules/external/Dev.tao'")
    Expect(compiled.code).toContain(
      'TR.Data.Configure(_Scope.__tao_type_Dev, {\n                ...{\n                  },',
    )
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/providers/dev/Dev.tao'))).toBe(true)
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/providers/dev/Dev.ts'))).toBe(true)
  })

  Test('resolves the InstantDB datasource package for a selected app variant', async () => {
    const compiled = await Compiler.compileCode(
      `
        use InstantDB from @tao/data/providers/instantdb
        use Local from @tao/data/providers/local
        use StackNav from @tao/nav
        data Notes / Note { Title text }
        app LocalNotes {
          Name "Local Notes"
          Navigator StackNav { Initial Main }
          Datasource Local { StorageKey "Notes" }
        }
        app SyncedNotes = LocalNotes with {
          Name "Synced Notes"
          Datasource InstantDB { AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f" }
        }
        scene Main() {
          Title "Notes"
          render Text("Ready")
        }
        view Text(Value text) { render inject ${tsFence} return null ${fence} }
      `,
      { appName: 'SyncedNotes' },
    )

    Expect(compiled.code).toContain('TR.Data.Configure(_Scope.__tao_type_InstantDB, {')
    Expect(compiled.code).toContain('"AppId": TR.Value("9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f")')
    Expect(compiled.code).toContain('export default TaoApps["SyncedNotes"]')
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/InstantDB.ts'))).toBe(true)
  })

  Test('resolves the ICloud datasource package and its shared configuration reader', async () => {
    const compiled = await Compiler.compileCode(
      `
        use ICloud from @tao/data/providers/icloud
        use Local from @tao/data/providers/local
        use StackNav from @tao/nav
        data Notes / Note { Title text }
        app LocalNotes {
          Name "Local Notes"
          Navigator StackNav { Initial Main }
          Datasource Local { StorageKey "Notes" }
        }
        app CloudNotes = LocalNotes with {
          Name "Cloud Notes"
          Datasource ICloud { Container "iCloud.lang.tao.notes" }
        }
        scene Main() {
          Title "Notes"
          render Text("Ready")
        }
        view Text(Value text) { render inject ${tsFence} return null ${fence} }
      `,
      { appName: 'CloudNotes' },
    )

    Expect(compiled.code).toContain('TR.Data.Configure(_Scope.__tao_type_ICloud, {')
    Expect(compiled.code).toContain('"Container": TR.Value("iCloud.lang.tao.notes")')
    Expect(compiled.code).toContain('export default TaoApps["CloudNotes"]')
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/icloud/ICloud.ts'))).toBe(true)
    Expect(compiled.files.some(file => file.sourcePath.endsWith('/providers/provider-configuration.ts'))).toBe(true)
  })

  Test('patches only the selected app datasource with derived host configuration', async () => {
    const compiled = await Compiler.compileCode(
      `
        use InstantDB from @tao/data/providers/instantdb
        use StackNav from @tao/nav
        data Notes / Note { Title text }
        app LocalNotes {
          Name "Local Notes"
          Navigator StackNav { Initial Main }
          Datasource InstantDB {
            AppId "local-app"
            ApiURI "http://localhost:9020"
          }
        }
        app HostedNotes = LocalNotes with { Name "Hosted Notes" }
        scene Main() { Title "Notes" render Text("Ready") }
        view Text(Value text) { render inject ${tsFence} return null ${fence} }
      `,
      {
        appDatasourceConfiguration: {
          ApiURI: 'https://api.instantdb.com',
          AppId: 'hosted-app',
          WebsocketURI: 'wss://api.instantdb.com/runtime/session',
        },
        appName: 'HostedNotes',
      },
    )

    Expect(compiled.code).toContain('"AppId": TR.Value("local-app")')
    Expect(compiled.code).toContain('"AppId": TR.Value("hosted-app")')
    Expect(compiled.code).toContain('"ApiURI": TR.Value("https://api.instantdb.com")')
    Expect(compiled.code).toContain(
      '"WebsocketURI": TR.Value("wss://api.instantdb.com/runtime/session")',
    )
    // The override lands on the selected variant's binding alone; its base keeps the authored host.
    Expect(compiled.code.match(/"AppId": TR.Value\("hosted-app"\)/gu)).toHaveLength(1)
    Expect(compiled.code.indexOf('hosted-app')).toBeGreaterThan(compiled.code.indexOf('function TaoApp_LocalNotes'))
  })

  Test('reaches only a bound datasource whose contract declares the release override keys', async () => {
    const compiled = await Compiler.compileCode(
      `
        use CloudKit from @tao/data/providers/cloudkit
        use InstantDB from @tao/data/providers/instantdb
        use StackNav from @tao/nav
        data Notes / Note { Title text }
        data Pins / Pin { Label text }
        datasource Shared = InstantDB { AppId "local-app" ApiURI "http://localhost:9020" Data { Notes } }
        datasource Mine = CloudKit { Data { Pins } }
        app Notes2 { Name "Notes" Navigator StackNav { Initial Main } Datasource { Shared, Mine } }
        scene Main() { Title "Notes" render Text("Ready") }
        view Text(Value text) { render inject ${tsFence} return null ${fence} }
      `,
      { appDatasourceConfiguration: { ApiURI: 'https://api.instantdb.com', AppId: 'hosted-app' } },
    )

    const mine = compiled.code.slice(compiled.code.indexOf('store: _Scope._TaoDataCatalog_Pins,\n'))
    Expect(mine).toContain('source: _Scope.Mine.evaluate(),')
    Expect(compiled.code).toContain('"AppId": TR.Value("hosted-app")')
    Expect(mine.slice(0, mine.indexOf('}]'))).not.toContain('hosted-app')
  })

  Test('lists every bound store on the app definition and names each store after its datasource', async () => {
    const compiled = await Compiler.compileCode(
      `
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Stories / Story { HnId number (unique) Title text }
      data Bookmarks / Bookmark { Story (reference) }
      datasource Feed = Memory { Data { Stories } }
      datasource StubFeed = Feed with { }
      datasource Personal = Memory { Data { Bookmarks } }
      app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
      app ReaderStub = Reader with { Datasource { StubFeed, Personal } }
      scene Main() { Title "Reader" render Text("Ready") }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'ReaderStub' },
    )

    // A derived stub is an alternative for its base's store, and keeps a storage key of its own.
    Expect(compiled.code).toContain(
      'store: _Scope._TaoDataCatalog_Stories,\n            source: _Scope.StubFeed.evaluate(),\n            storageName: "StubFeed",',
    )
    Expect(compiled.code).toContain(
      'store: _Scope._TaoDataCatalog_Stories,\n            source: _Scope.Feed.evaluate(),\n            storageName: "Feed",',
    )
    Expect(compiled.code).toContain('TR.Data.UseAppDatasources(_TaoAppDefinition_ReaderStub.definition)')
  })

  Test('hands a Studio fixture every store an app mounts', async () => {
    const compiled = await Compiler.compileCode(
      `
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Stories / Story { HnId number (unique) Title text }
      data Bookmarks / Bookmark { Story (reference) }
      datasource Feed = Memory { Data { Stories } }
      datasource Personal = Memory { Data { Bookmarks } }
      app Reader { Name "Reader" Navigator StackNav { Initial Main } Datasource { Feed, Personal } }
      scene Main() { Title "Reader" render Text("Ready") }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `,
      { studio: true },
    )

    Expect(compiled.code).toContain(
      'useTaoGeneratedStudioFixture([_Scope._TaoDataCatalog_Bookmarks, _Scope._TaoDataCatalog_Stories])',
    )
    Expect(compiled.code).not.toContain('_Scope._TaoDataCatalog)')
  })

  Test('emits a datasource type before a datasource declared above it', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Notes / Note { Title text }
      datasource Store = LaterSource { }
      app Notes2 { Name "Notes" Navigator StackNav { Initial Main } Datasource Store }
      type LaterSource is Memory with { }
      scene Main() { Title "Notes" render Text("Ready") }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    const typeAt = compiled.code.indexOf('_Scope.__tao_type_LaterSource = ')
    Expect(typeAt).toBeGreaterThan(-1)
    Expect(typeAt).toBeLessThan(compiled.code.indexOf('_Scope.Store = '))
  })

  Test('lowers render and loop tags through Tao props without adding a row wrapper', async () => {
    const compiled = await Compiler.compileCode(`
      use Col, Text from @tao/ui
      app TaggedApp { view Main }
      view Main() {
        render Col() {
          #title
          Text("Tagged")
          #rows
          loop ["One"] / Row {
            #choose
            Col() { Text(Row) }
          }
        }
      }
    `)

    Expect(compiled.code).toContain('testTag: "title"')
    Expect(compiled.code).toContain('testTag: "rows choose"')
    Expect(compiled.code).toContain('TR.ForEach')
    Expect(compiled.code).not.toContain('display: "contents"')
  })

  Test('preserves root and child combined clauses through TR.Design.Spec', async () => {
    const compiled = await Compiler.compileCode(
      app(
        `
          render Col() [fill, content top stretch, gap 12, pad horizontal 16] {
            Text("Child") [width fill, margin bottom 4]
          }
        `,
        `${stubContainer('Col')}${stubView('Text', 'Value text')}`,
      ),
    )

    Expect(compiled.code).toContain(
      'TR.Design.Spec([["fill"],["content","top","stretch"],["gap",12],["pad","horizontal",16]])',
    )
    Expect(compiled.code).toContain(
      'TR.Design.Spec([["width","fill"],["margin","bottom",4]])',
    )
  })

  Test('lowers named and literal injection arguments to typed parameters and compiled values', async () => {
    const compiled = await Compiler.compileCode(`
      let UserName = "Ro"
      app InjectionApp { view Native }
      view Native() {
        render inject Name UserName, Count 3, Greeting "Hello" ${tsFence}
          return null
        ${fence}
      }
    `)

    const boundary = compiled.files.find(file => file.relativePath === 'App.injection-1.tsx')
    Expect(boundary?.code).toContain(
      'export default function(Name: string, Count: number, Greeting: string)',
    )
    Expect(compiled.code).toContain(
      '[_Scope.UserName.evaluate().jsValue, TR.Value(3).jsValue, TR.Value("Hello").jsValue]',
    )
  })

  Test('emits prototype-sensitive data names as computed object keys', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data/providers/memory
      use StackNav from @tao/nav
      data Rows / __proto__ { __proto__ text }
      app SafeApp {
        Name "Safe"
        Navigator StackNav { Initial MainView }
        Datasource Memory { }
      }
      scene MainView() {
        Title "Main"
        action Add() { create __proto__ { __proto__: "safe" } }
        render Text("Ready")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code.match(/\["__proto__"\]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    Expect(compiled.code).not.toContain('"__proto__":')
  })

  Test('compiles configured apps, first-class views, strict targets, dismiss, and replacement', async () => {
    const compiled = await Compiler.compileCode(
      `
      use SelectionNav, SlotNav, StackNav from @tao/nav
      let ResetNavigator = StackNav { Initial Home }
      app NavigationApp {
        Name "Navigation"
        Navigator SelectionNav {
          Initial @workspace
          Display "tabs"
          @workspace { Label "Workspace" Content Home }
        }
        @window SlotNav { Initial Detail }
      }
      let NavigationVariant = NavigationApp with { Name "Navigation Variant" }
      scene Home() {
        Title "Home"
        action Open() { present Detail() in NavigationApp@window }
        action OpenOverlay() { present Detail() as overlay in NavigationApp@window }
        action Activate() { present NavigationApp@workspace }
        render Empty()
      }
      scene Detail() {
        Title "Detail"
        action Close() { dismiss }
        action Reset() { replace ResetNavigator in NavigationApp }
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'NavigationVariant' },
    )

    Expect(compiled.code).toContain('TR.Navigation.App({')
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_StackNav, {')
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_SlotNav, {')
    Expect(compiled.code).toContain('TR.Navigation.Target(')
    Expect(compiled.code).toContain('TR.Navigation.PresentOverlay(')
    Expect(compiled.code).toContain('TR.Navigation.Activate(')
    Expect(compiled.code).toContain('"workspace"')
    Expect(
      /TR\.Navigation\.Target\(\s+_ViewProps\.__tao,\s+_Scope\.NavigationApp,/.test(compiled.code),
    ).toBe(true)
    Expect(
      /TR\.Navigation\.Activate\(\s+_ViewProps\.__tao,\s+_Scope\.NavigationApp,/.test(compiled.code),
    ).toBe(true)
    Expect(compiled.code).toContain('TR.Navigation.Dismiss(_ViewProps.__tao)')
    Expect(compiled.code).toContain('TR.Navigation.Replace(')
    Expect(
      /TR\.Navigation\.Replace\(\s+_ViewProps\.__tao,\s+_Scope\.ResetNavigator\.evaluate\(\),\s+_Scope\.NavigationApp,/
        .test(compiled.code),
    ).toBe(true)
    Expect(compiled.code).toContain(
      'declaration: TR.Navigation.AppDeclaration("NavigationApp", TR.Navigation.Identity(',
    )
    Expect(compiled.code).toContain('declaration: _Scope.NavigationApp.declaration')
    Expect(compiled.code).not.toContain('key: "NavigationApp"')
    Expect(compiled.code).toContain('<TR.Navigation.AppHost')
  })

  Test('compiles responds-view asks and responses through an async-compatible action chain', async () => {
    const compiled = await Compiler.compileCode(`
      type ConfirmResult is one of Confirmed
      app DialogueApp { view Editor }
      view Editor() {
        action Close() {
          let Result = ask ConfirmClose("Draft")
          if Result is Confirmed { dismiss }
        }
        render Empty()
      }
      view ConfirmClose(Title text) responds ConfirmResult {
        action Confirm() { respond Confirmed }
        action Cancel() { respond }
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Navigation.View({')
    Expect(compiled.code).toContain('await TR.Navigation.Ask(')
    Expect(compiled.code).toContain('TR.Navigation.Respond(')
    Expect(compiled.code).toContain('TR.Action(async')
    Expect(compiled.code).toContain('const _TaoActionContinuation = TR.ActionContinuation()')
    Expect(compiled.code).toContain('TR.ResumeActionContinuation(_TaoActionContinuation)')
    Expect(compiled.code).toContain('await TR.If(')
    Expect(compiled.code).toContain('...TR.TaoContext(_ViewProps.__tao)')
  })

  Test('compiles keyed toast presentation against inherited app context', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app ToastApp { Name "Toast" Navigator StackNav { Initial Home } }
      scene Home() { Title "Home" render Editor() }
      view Editor() {
        action Save() { present Saved() as toast (Key: "document-saved", Duration: 3.s) }
        render Empty()
      }
      view Saved() { render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Navigation.PresentToast(')
    Expect(compiled.code).toContain('_ViewProps.__tao')
    Expect(compiled.code).toContain('key: TR.Value("document-saved")')
    Expect(compiled.code).toContain('duration: TR.Units.Build(TR.Value(3), 1000000000)')
    Expect(compiled.code).not.toContain('TR.Navigation.Target(')
  })

  Test('compiles keyed SelectionNav configuration and target-only activation', async () => {
    const compiled = await Compiler.compileCode(`
      use SelectionNav, StackNav from @tao/nav
      let HomeStack = StackNav { Initial Home }
      let SettingsStack = StackNav { Initial Settings }
      let MainNavigation = SelectionNav {
        Initial @home
        Display "tabs"
        @home { Label "Home" Content HomeStack }
        @settings { Label "Settings" Content SettingsStack }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      scene Home() {
        Title "Home"
        action Activate() { present SelectionApp@settings }
        render Empty()
      }
      scene Settings() { Title "Settings" render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.__tao_type_SelectionNav, {')
    Expect(compiled.code).toContain('"Initial": TR.Value("@home")')
    Expect(compiled.code).toContain('"Display": TR.Value("tabs")')
    Expect(compiled.code).toContain('"@settings": {')
    Expect(compiled.code).toContain('"Label": TR.Value("Settings")')
    Expect(compiled.code).toContain('"Content": _Scope.SettingsStack.evaluate()')
    Expect(compiled.code).toContain('TR.Navigation.Activate(')
  })

  Test('fills keyed defaults inside each keyed item and never on the enclosing configuration', async () => {
    const compiled = await Compiler.compileCode(`
      use SelectionNav from @tao/nav
      let MainNavigation = SelectionNav {
        Initial @home
        Display "tabs"
        @home { Label "Home" Content Home }
      }
      app SelectionApp { Name "Selection" Navigator MainNavigation }
      view Home() { render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      '"Icon": TR.Value(""), }, }, "__taoHostSlots": { }, }))',
    )
  })

  Test('compiles keyed additions in configured navigation patches', async () => {
    const compiled = await Compiler.compileCode(`
      use SelectionNav from @tao/nav
      let MainNavBase = SelectionNav {
        Initial @home
        Display "tabs"
        @home { Label "Home" Content Home }
      }
      let MainNav = MainNavBase with {
        @other { Label "Other" Content Other }
      }
      app SelectionApp { Name "Selection" Navigator MainNav }
      view Home() { render Empty() }
      view Other() { render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Navigation.Patch(_Scope.MainNavBase.evaluate(), {')
    Expect(compiled.code).toContain('"@other": {')
    Expect(compiled.code).toContain('"Label": TR.Value("Other")')
    Expect(compiled.code).toContain('"Content": TR.Navigation.ViewReference(TR.Navigation.Identity(')
  })

  Test('compiles a root-view app through the one app definition path', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      ${stubView('MainView')}
    `)

    Expect(compiled.code).toContain('const _TaoAppDefinition_MyApp = TR.Navigation.App({')
    Expect(compiled.code).toContain('name: "MyApp"')
    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      'TR.Navigation.Declaration( "MainView", TR.NavKind.Slot(), TR.Navigation.Identity(',
    )
    Expect(compiled.code).toContain('"Initial": TR.Navigation.ViewReference(TR.Navigation.Identity(')
    Expect(compiled.code).toContain('<TR.Navigation.AppHost app={_TaoAppDefinition_MyApp} />')
    Expect(compiled.code).toContain('_Scope.MyApp = _TaoAppDefinition_MyApp')
  })

  /**
   * The synthesized navigator has to carry a canonical identity, or the runtime builds no restorable
   * descriptor for it and a root-view app silently stops restoring where the person was. The tuples
   * below are pinned literals rather than values rebuilt from the compiler: they key persisted
   * navigation state on a real device, so any drift in a slot must fail here rather than orphan it.
   */
  Test('gives the synthesized root-view navigator an identity distinct from the app and the view', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      ${stubView('MainView')}
    `)
    const normalized = compiled.code.replace(/\s+/g, ' ')

    Expect(normalized).toContain(
      'TR.Navigation.Declaration( "MainView", TR.NavKind.Slot(), TR.Navigation.Identity('
        + '["tao.declaration",1,"tao-compiler-test","@workspace","source","app-root-view-nav","MyApp"]), )',
    )
    Expect(normalized).toContain(
      'TR.Navigation.AppDeclaration("MyApp", TR.Navigation.Identity('
        + '["tao.declaration",1,"tao-compiler-test","@workspace","source","app","MyApp"]))',
    )
    Expect(normalized).toContain(
      '"Initial": TR.Navigation.ViewReference(TR.Navigation.Identity('
        + '["tao.declaration",1,"tao-compiler-test","@workspace","source","view","MainView"]))',
    )
  })

  // The identity is the app declaration's, so swapping which view the app opens leaves it where it
  // is. Deriving it from the mounted view would move a person's stored position on a rename.
  Test('keeps the synthesized navigator identity when the root view it mounts changes', async () => {
    const mainView = await Compiler.compileCode(`
      app MyApp { view MainView }
      ${stubView('MainView')}
    `)
    const otherView = await Compiler.compileCode(`
      app MyApp { view OtherView }
      ${stubView('OtherView')}
    `)
    const navigatorIdentity =
      '["tao.declaration",1,"tao-compiler-test","@workspace","source","app-root-view-nav","MyApp"]'

    Expect(mainView.code).toContain(navigatorIdentity)
    Expect(otherView.code).toContain(navigatorIdentity)
    Expect(mainView.code).toContain('"view","MainView"]')
    Expect(otherView.code).toContain('"view","OtherView"]')
  })

  // A derivation refines the same authored navigator, so it keeps the base's identity and separates
  // its stored position by `variant` — the same split a derived app already gets for the app itself.
  Test('shares one synthesized navigator identity between a root-view app and its derivation', async () => {
    const compiled = await Compiler.compileCode(
      `
      app BaseApp { view MainView }
      app PreviewApp = BaseApp with { Restore fresh }
      ${stubView('MainView')}
    `,
      { appName: 'PreviewApp' },
    )
    const navigatorIdentity =
      '["tao.declaration",1,"tao-compiler-test","@workspace","source","app-root-view-nav","BaseApp"]'

    Expect(compiled.code.split(navigatorIdentity).length - 1).toBe(2)
    Expect(compiled.code).toContain('variant: "BaseApp"')
    Expect(compiled.code).toContain('variant: "PreviewApp"')
  })

  Test('compiles a root-view app that also supplies its own app configuration', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp {
        Name "Root View App"
        view MainView
        Restore fresh
      }
      ${stubView('MainView')}
    `)

    Expect(compiled.code).toContain('name: TR.Value("Root View App").evaluate().jsValue as string')
    Expect(compiled.code.replace(/\s+/g, ' ')).toContain(
      'TR.Navigation.Declaration( "MainView", TR.NavKind.Slot(), TR.Navigation.Identity(',
    )
    Expect(compiled.code).toContain('mode: "fresh"')
  })

  Test('compiles typed dynamic action arguments in source order', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view MainView() {
        action Receive(Label text, Count number) { }
        render Wrapper(Receive)
      }
      view Wrapper(Callback action(text, number)) {
        action CallCallback() {
          do Callback("first", 2)
        }
        render Text("Done")
      }
      view Text(Value text) {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `)

    const code = compiled.files[0]?.code ?? ''
    Expect(code).toContain('Callback: TR.Action<[TR.Value<string>, TR.Value<number>]>')
    const first = code.indexOf('TR.Value("first")')
    const second = code.indexOf('TR.Value(2)', first)
    Expect(first).toBeGreaterThan(-1)
    Expect(second).toBeGreaterThan(first)
  })

  Test('compiles action aliases as invokable callback values', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view MainView() {
        let Save = action { }
        action Run() { do Save() }
        render Text("Ready")
      }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.code).toContain('TR.Alias(() => TR.Action')
    Expect(compiled.code).toContain('TR.Do(_Scope.Save.evaluate())')
  })

  Test('compiles direct reactive host slots and occurrence-bound toolbar commands', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app HostApp { Name "Host" Navigator StackNav { Initial Home } }
      scene Home() {
        state CurrentTitle = "Home"
        state CanSave = false
        Title CurrentTitle
        action SaveDocument() { }
        command Save() {
          Title "Save document"
          Icon "checkmark"
          Enabled CanSave
          do SaveDocument()
        }
        Toolbar { Save }
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('TR.Navigation.UseHostSlots(_ViewProps.__taoHost, {')
    Expect(code).toContain('"Title": () => _Scope.CurrentTitle.evaluate()')
    Expect(code).toContain('"Toolbar": () => [ _Scope.Save ]')
    Expect(code).toContain('_Scope.Save = TR.Interaction.Command({ name: "Save", slots: [],')
    Expect(code).toContain(
      'action: _TaoFills => TR.BlockScope(_Scope, _Scope => { return _Scope.SaveDocument.evaluate() })',
    )
    Expect(code).toContain(
      '"Title": _TaoFills => TR.BlockScope(_Scope, _Scope => { return TR.Value("Save document") })',
    )
    Expect(code).toContain('"Icon": _TaoFills => TR.BlockScope(_Scope, _Scope => { return TR.Value("checkmark") })')
    Expect(code).toContain(
      '"Enabled": _TaoFills => TR.BlockScope(_Scope, _Scope => { return _Scope.CanSave.evaluate() })',
    )
    Expect(code).toContain('TR.Interaction.UseCommands({ module: "@workspace/source", commands: [')
    Expect(code).toContain('__taoHost={_NavigationHost}')
    const navRoot = compiled.files.find(file => file.sourcePath.endsWith('/@tao/nav/Navigation.tao'))?.code ?? ''
    Expect(navRoot).toContain('__tao_type_StackNav as __tao_package_native_StackNav')
    Expect(navRoot).toContain("TR.Use(_Scope, '__tao_type_StackNav', () => __tao_package_native_StackNav)")
    Expect(navRoot).not.toContain('TR.Navigation.Declaration(')
  })

  Test('compiles a module command`s slot as the value every member and its invocation read', async () => {
    const compiled = await Compiler.compileCode(`
      app HostApp { view Home }
      data Documents / Document {
        Title text
        Final yes / Draft no
      }
      command Finish(Document) {
        Title "Finish document"
        Summary "Finish { Document.Title }"
        Enabled Document.Final is Draft
        do -> { update Document { Final } }
      }
      view Home() { render Empty() }
      view Row(Document) {
        action Archive() { do Finish(Document) }
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope.Finish = TR.Interaction.Command({ name: "Finish", slots: ["Document"],')
    Expect(code.match(/_Scope.Document = _TaoFills\["Document"\]/g)).toHaveLength(5)
    Expect(code).toContain(
      '"Summary": _TaoFills => TR.BlockScope(_Scope, _Scope => { _Scope.Document = _TaoFills["Document"]',
    )
    Expect(code).toContain('TR.Interaction.RegisterCommands({ module: "@workspace/source", commands: [')
    Expect(code).toContain('name: "Document", type: "Document", entity: true,')
    Expect(code).toContain('TR.Do(_Scope.Finish.evaluate(), _Scope.Document.evaluate())')
  })

  Test('resolves a command action lazily when the action is declared later in its view', async () => {
    const compiled = await Compiler.compileCode(`
      app HostApp { view Home }
      scene Home() {
        command Send() {
          Title "Send"
          do Deliver()
        }
        action Deliver() { }
        Toolbar { Send }
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('action: _TaoFills => TR.BlockScope(_Scope, _Scope => { return _Scope.Deliver.evaluate() })')
    Expect(code.indexOf('_Scope.Send = TR.Interaction.Command')).toBeLessThan(
      code.indexOf('_Scope.Deliver = TR.Action'),
    )
  })

  Test('compiles a configured nav toolbar as the same command values a scene lists', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app HostApp { Name "Host" Navigator Main }
      nav Main = StackNav {
        Initial Home
        Title "Main"
        Toolbar { Save }
      }
      action SaveDocument() { }
      command Save() {
        Title "Save document"
        do SaveDocument()
      }
      scene Home() {
        Title "Home"
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code.match(/"Toolbar": \[/g)).toHaveLength(1)
    Expect(code).toContain('"Toolbar": [TR.Interaction.Deferred(() => _Scope.Save)],')
    Expect(code).not.toContain('TR.Navigation.Command(')
  })

  Test('compiles when and none configuration values directly', async () => {
    const compiled = await Compiler.compileCode(`
      public type TestNav is nav with {
        Initial view
        Title text is none
        nav TestNavImpl from ./TestNavImpl.ts
      }
      app HostApp { Name "Host" Navigator Main }
      let Enabled = true
      nav Main = TestNav {
        Initial Home
        Title when Enabled {
          true -> "Ready"
          otherwise -> none
        }
      }
      scene Home() {
        Title "Home"
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('"Title": TR.WhenCase(')
    Expect(code).not.toContain('TR.Deferred')
  })

  Test('patches configured nav host slots without discarding unpatched host values', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app HostApp { Name "Host" Navigator Main }
      nav Base = StackNav {
        Initial Home
        Title "Base"
        Toolbar { Keep }
      }
      nav Main = Base with {
        Title "Main"
        Toolbar { Save }
      }
      action Run() { }
      command Keep() {
        Title "Keep"
        do Run()
      }
      command Save() {
        Title "Save"
        do Run()
      }
      scene Home() {
        Title "Home"
        render Empty()
      }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    const code = compiled.code.replace(/\s+/g, ' ')
    Expect(code).toContain('TR.Navigation.Patch(_Scope.Base.evaluate(), { "__taoHostSlots": {')
    Expect(code.match(/_Scope.Base.evaluate\(\)/g)).toHaveLength(1)
    Expect(code).toContain('"Toolbar": [TR.Interaction.Deferred(() => _Scope.Save)],')
  })

  Test('compiles v0 Tao test-plan IR', async () => {
    await withCompiledTestPlan(
      'tao-test-plan-',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          test "renders" {
            run MyApp
            expect text "Hello"
            press "Add"
            press down label "Add"
            press up #add
            hover placeholder "Add item"
            focus #add
            enter "Draft" into label "Title"
            submit placeholder "Title"
            expect input placeholder "Title" value "Draft"
            expect navigation title "Home"
            expect toolbar command "Save" disabled
            press toolbar command "Save"
            back
            relaunch
            relaunch fresh
            expect missing text "Loading"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView() {
          render inject ${tsFence}
            return null
          ${fence}
        }
      `,
      },
      (plan, paths) => {
        const testPath = paths['Main.test.tao']

        Expect(plan.sourcePath).toBe(testPath)
        Expect(plan.suites).toHaveLength(1)
        Expect(plan.suites[0]?.name).toBe('Smoke')
        Expect(plan.suites[0]?.checks[0]?.name).toBe('renders')
        Expect(plan.suites[0]?.checks[0]?.run.appName).toBe('MyApp')
        Expect(plan.suites[0]?.checks[0]?.run.appSourcePath).toBe(paths['Main.tao'])
        Expect(
          plan.suites[0]?.checks[0]?.steps.map(step => ({
            kind: step.kind,
            ...('selector' in step ? { selector: step.selector } : {}),
            ...('text' in step ? { text: step.text } : {}),
            ...('target' in step ? { target: step.target } : {}),
            ...('value' in step ? { value: step.value } : {}),
            ...('title' in step ? { title: step.title } : {}),
            ...('label' in step ? { label: step.label } : {}),
            ...('enabled' in step ? { enabled: step.enabled } : {}),
            ...('fresh' in step ? { fresh: step.fresh } : {}),
            ...('tag' in step ? { tag: step.tag } : {}),
          })),
        ).toEqual([
          { kind: 'expect', selector: 'text', text: 'Hello' },
          { kind: 'press', selector: 'text', text: 'Add' },
          { kind: 'pressDown', selector: 'label', target: 'Add' },
          { kind: 'pressUp', selector: 'tag', target: 'add' },
          { kind: 'hover', selector: 'placeholder', target: 'Add item' },
          { kind: 'focus', tag: 'add' },
          { kind: 'enter', selector: 'label', target: 'Title', value: 'Draft' },
          { kind: 'submit', selector: 'placeholder', target: 'Title' },
          { kind: 'expectInputValue', selector: 'placeholder', target: 'Title', value: 'Draft' },
          { kind: 'expectNavigationTitle', title: 'Home' },
          { enabled: false, kind: 'expectToolbarCommand', label: 'Save' },
          { kind: 'pressToolbarCommand', label: 'Save' },
          { kind: 'back' },
          { fresh: false, kind: 'relaunch' },
          { fresh: true, kind: 'relaunch' },
          { kind: 'expect', selector: 'text', text: 'Loading' },
        ])
        Expect(plan.suites[0]?.source.range).toBeDefined()
        Expect(plan.suites[0]?.checks[0]?.run.source.range).toBeDefined()
      },
    )
  })

  Test(
    'compiles tag selectors, grouped expectations, and selected rows to structured IR',
    async () => {
      await withCompiledTestPlan(
        'tao-structured-test-plan-',
        {
          'Main.test.tao': `
        use MyApp from ./

        test "Structured" {
          test "scopes interactions" {
            run MyApp
            expect {
              text "Ready"
              missing label "Unavailable"
            }
            expect #field {
              placeholder "Title"
              input value "Draft"
            }
            enter "Changed" into #field
            submit #field
            select #rows[2] {
              expect text "Second"
              press #open
            }
          }
        }
      `,
          'Main.tao': `
        app MyApp { view MainView }
        view MainView() { render inject ${tsFence} return null ${fence} }
      `,
        },
        plan => {
          const steps = plan.suites[0]?.checks[0]?.steps ?? []

          Expect(steps[0]).toMatchObject({
            kind: 'expectGroup',
            expectations: [
              { kind: 'match', missing: false, selector: 'text', target: 'Ready' },
              { kind: 'match', missing: true, selector: 'label', target: 'Unavailable' },
            ],
          })
          Expect(steps[1]).toMatchObject({
            kind: 'expectGroup',
            scopeTag: 'field',
            expectations: [
              { kind: 'match', missing: false, selector: 'placeholder', target: 'Title' },
              { kind: 'inputValue', value: 'Draft' },
            ],
          })
          Expect(steps[2]).toMatchObject({ kind: 'enter', selector: 'tag', target: 'field', value: 'Changed' })
          Expect(steps[3]).toMatchObject({ kind: 'submit', selector: 'tag', target: 'field' })
          Expect(steps[4]).toMatchObject({
            kind: 'select',
            tag: 'rows',
            index: 2,
            steps: [
              { kind: 'expect', selector: 'text', text: 'Second' },
              { kind: 'press', selector: 'tag', text: 'open' },
            ],
          })
          Expect(steps).toHaveLength(5)
        },
      )
    },
  )
})
