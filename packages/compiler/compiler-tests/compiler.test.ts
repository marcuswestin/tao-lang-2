import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { app, Describe, Expect, stubContainer, stubView, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler as Compiler } from './test-compile'

const tsFence = '```ts'
const fence = '```'

Describe('compiler: language lowering', () => {
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
      view Home() { render Empty() }
      view Empty() { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.appNames).toEqual(['Product'])
    Expect(compiled.code).toContain('declaration: TR.Navigation.AppDeclaration("Product")')
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
      Expect(compiled.code).toContain(`TR.Navigation.AppDeclaration("${name}")`)
    }
    Expect(compiled.code).toContain('export default TaoApps["LetWithApp"]')
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
      use Local from @tao/data
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
        Title text
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
      view Main() {
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
    Expect(compiled.code).toContain('limit: 25')
    Expect(compiled.code).toContain('field: "Workspace"')
    Expect(compiled.code).toContain("operator: '=='")
    Expect(compiled.code).toContain('TR.ForEach(_Scope.Drafts.evaluate()')
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
      use Memory from @tao/data
      use StackNav from @tao/nav
      data Rows / __proto__ { __proto__ text }
      app SafeApp {
        Name "Safe"
        Navigator StackNav { Initial MainView }
        Datasource Memory { }
      }
      view MainView() {
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
      view Home() {
        action Open() { present Detail() in NavigationApp@window }
        action OpenOverlay() { present Detail() as overlay in NavigationApp@window }
        action Activate() { present NavigationApp@workspace }
        render Empty()
      }
      view Detail() {
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
    Expect(compiled.code).toContain('declaration: TR.Navigation.AppDeclaration("NavigationApp")')
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
    Expect(compiled.code).toContain('await TR.If(')
    Expect(compiled.code).toContain('...TR.TaoContext(_ViewProps.__tao)')
  })

  Test('compiles keyed toast presentation against inherited app context', async () => {
    const compiled = await Compiler.compileCode(`
      use StackNav from @tao/nav
      app ToastApp { Name "Toast" Navigator StackNav { Initial Home } }
      view Home() { render Editor() }
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
      view Home() {
        action Activate() { present SelectionApp@settings }
        render Empty()
      }
      view Settings() { render Empty() }
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

    Expect(compiled.code.replace(/\s+/g, ' ')).toContain('"Icon": TR.Value(""), }, }))')
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
    Expect(compiled.code).toContain('"Content": TR.Navigation.View({')
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

  Test('compiles v0 Tao test-plan IR', async () => {
    await withTaoFiles(
      'tao-test-plan-',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          test "renders" {
            run MyApp
            expect text "Hello"
            press "Add"
            enter "Draft" into label "Title"
            submit placeholder "Title"
            expect input placeholder "Title" value "Draft"
            back
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
      async paths => {
        const testPath = paths['Main.test.tao']!
        const validation = await Workspace.validate(testPath)
        const plan = Compiler.compileTestPlan(
          validation,
          Compiler.createContext(await Packages.createContext(FS.dirname(testPath)), FS.dirname(testPath)),
        )

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
          })),
        ).toEqual([
          { kind: 'expect', selector: 'text', text: 'Hello' },
          { kind: 'press', selector: 'text', text: 'Add' },
          { kind: 'enter', selector: 'label', target: 'Title', value: 'Draft' },
          { kind: 'submit', selector: 'placeholder', target: 'Title' },
          { kind: 'expectInputValue', selector: 'placeholder', target: 'Title', value: 'Draft' },
          { kind: 'back' },
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
      await withTaoFiles(
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
        async paths => {
          const testPath = paths['Main.test.tao']!
          const validation = await Workspace.validate(testPath)
          const plan = Compiler.compileTestPlan(
            validation,
            Compiler.createContext(await Packages.createContext(FS.dirname(testPath)), FS.dirname(testPath)),
          )
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

function primitiveAppValueSpellings(): string {
  return `
    public type TestStack is nav with {
      Initial view
      nav TestNavImpl from ./TestNavImpl.ts
    }
    workspace type CompleteTestStack is TestStack with { Initial is Home }
    workspace nav HeadNavigation = CompleteTestStack { }
    workspace nav HeadWithNavigation = CompleteTestStack with { }
    workspace let LetNavigation = CompleteTestStack { }
    workspace let LetWithNavigation = CompleteTestStack with { }

    app HeadApp {
      Name "Head"
      Navigator HeadNavigation
    }
    app HeadWithApp = app with {
      Name "Head with"
      Navigator HeadWithNavigation
    }
    workspace let LetApp = app {
      Name "Let"
      Navigator LetNavigation
    }
    workspace let LetWithApp = app with {
      Name "Let with"
      Navigator LetWithNavigation
    }

    view Home() { render Empty() }
    view Empty() { render inject ${tsFence} return null ${fence} }
  `
}
