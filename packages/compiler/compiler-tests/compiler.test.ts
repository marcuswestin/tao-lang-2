import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import Compiler from '../compiler-src/compiler'

const tsFence = '```ts'
const fence = '```'

Describe('Tao compiler', () => {
  Test('compiles state and action declarations', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view Button Title is text, Action is action {
        render inject Title ${tsFence}
          return null
        ${fence}
      }
      view Number Value is number {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
      view MainView {
        state Count = 0
        let DisplayCount = Count
        action AddOne {
          set Count += 1
        }
        render Button("Add", AddOne) {
          Number(DisplayCount)
        }
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles the top-level data catalog, inferred relations, defaults, and explicit Local key', async () => {
    const compiled = await Compiler.compileCode(`
      use Local from @tao/data
      use StackNav from @tao/nav
      data Workspaces / Workspace {
        Name text
        CreatedAt time (default now)
        Pinned yes / no
        Documents (relation Documents, auto-delete)
        index CreatedAt
        order by CreatedAt desc
      }
      data Documents / Document {
        Title text
        Final yes / no Draft
        Public yes / no Private (default Public)
        Workspace
        Paragraphs (auto-delete)
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
      ui Main {
        query Workspaces { }
        action Add { create Workspace { Name: "Home" } }
        render Text("Main")
      }
      ui Detail Workspace {
        action AddDocument { create Document { Title: "Draft", Workspace } }
        render Col() {
          Text("Detail")
          query Drafts from Workspace.Documents { where is Draft }
          Text("Drafts: { Drafts.Count }")
          loop Drafts / Draft { Text(Draft.Title) }
        }
      }
      ui Editor Document {
        action Finish { update Document { Final } }
        action Reopen { update Document { Draft } }
        render Text("Editor")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
      layout Col { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain("name: 'Data'")
    Expect(compiled.code).toContain('collection: "Workspaces"')
    Expect(compiled.code).toContain('defaultOrder: { field: "CreatedAt", direction: "desc" }')
    Expect(compiled.code).toContain('inverseField: "Workspace"')
    Expect(compiled.code).toContain('defaultValue: false')
    Expect(compiled.code).toContain('defaultValue: true')
    Expect(compiled.code.match(/onDelete: 'cascade'/g)).toHaveLength(2)
    Expect(compiled.code).toContain('inverseField: "Document"')
    Expect(compiled.code).toContain('TR.Data.Configure(_Scope.Local, {')
    Expect(compiled.code).toContain('"StorageKey": TR.Value("WordFlowerData")')
    Expect(compiled.code).toContain('_Scope._TaoDataCatalog')
    Expect(compiled.code).toContain('["Final"]: TR.Value(true)')
    Expect(compiled.code).toContain('["Final"]: TR.Value(false)')
    Expect(compiled.code).toContain('TR.Data.Query')
    Expect(compiled.code).toContain('field: "Workspace"')
    Expect(compiled.code).toContain("operator: '=='")
    Expect(compiled.code).toContain('TR.ForEach(_Scope.Drafts.evaluate()')
  })

  Test('lowers render and loop tags through Tao props without adding a row wrapper', async () => {
    const compiled = await Compiler.compileCode(`
      use Col, Text from @tao/ui
      app TaggedApp { view Main }
      view Main {
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

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('testTag: "title"')
    Expect(compiled.code).toContain('testTag: "rows choose"')
    Expect(compiled.code).toContain('TR.ForEach')
    Expect(compiled.code).not.toContain('display: "contents"')
  })

  Test('emits prototype-sensitive data names as computed object keys', async () => {
    const compiled = await Compiler.compileCode(`
      use Memory from @tao/data
      use StackNav from @tao/nav
      data Rows / __proto__ { __proto__ text }
      app SafeApp {
        Name "Safe"
        Navigator StackNav { Initial MainView }
        Datasource Memory
      }
      ui MainView {
        action Add { create __proto__ { __proto__: "safe" } }
        render Text("Ready")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code.match(/\["__proto__"\]/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    Expect(compiled.code).not.toContain('"__proto__":')
  })

  Test('compiles configured apps, first-class ui, strict targets, dismiss, and replacement', async () => {
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
      ui Home {
        action Open { present Detail() in NavigationApp@window }
        action OpenOverlay { present Detail() as overlay in NavigationApp@window }
        action Activate { present NavigationApp@workspace }
        render Empty()
      }
      ui Detail {
        action Close { dismiss }
        action Reset { replace ResetNavigator in NavigationApp }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `,
      { appName: 'NavigationVariant' },
    )

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Navigation.App({')
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.StackNav, {')
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.SlotNav, {')
    Expect(compiled.code).toContain('TR.Navigation.Target(')
    Expect(compiled.code).toContain('TR.Navigation.PresentOverlay(')
    Expect(compiled.code).toContain('TR.Navigation.Activate(')
    Expect(compiled.code).toContain('"workspace"')
    Expect(
      /TR\.Navigation\.Target\(\s+_ViewProps\.__tao,\s+_TaoAppDefinition_NavigationApp,/.test(compiled.code),
    ).toBe(true)
    Expect(
      /TR\.Navigation\.Activate\(\s+_ViewProps\.__tao,\s+_TaoAppDefinition_NavigationApp,/.test(compiled.code),
    ).toBe(true)
    Expect(compiled.code).toContain('TR.Navigation.Dismiss(_ViewProps.__tao)')
    Expect(compiled.code).toContain('TR.Navigation.Replace(')
    Expect(
      /TR\.Navigation\.Replace\(\s+_ViewProps\.__tao,\s+_Scope\.ResetNavigator\.evaluate\(\),\s+_TaoAppDefinition_NavigationApp,/
        .test(compiled.code),
    ).toBe(true)
    Expect(compiled.code).toContain('declaration: TR.Navigation.AppDeclaration("NavigationApp")')
    Expect(compiled.code).toContain('declaration: _TaoAppDefinition_NavigationApp.declaration')
    Expect(compiled.code).not.toContain('key: "NavigationApp"')
    Expect(compiled.code).toContain('<TR.Navigation.AppHost')
  })

  Test('compiles dialogue asks and responses through an async-compatible action chain', async () => {
    const compiled = await Compiler.compileCode(`
      enum ConfirmResult { Confirmed }
      app DialogueApp { view Editor }
      view Editor {
        action Close {
          let Result = ask ConfirmClose("Draft")
          if Result is Confirmed { dismiss }
        }
        render Empty()
      }
      dialogue ConfirmClose Title is text responds ConfirmResult {
        action Confirm { respond Confirmed }
        action Cancel { respond }
        render Empty()
      }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Navigation.Dialogue({')
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
      ui Home { render Editor() }
      view Editor {
        action Save { present Saved() as toast (Key: "document-saved", Duration: 3) }
        render Empty()
      }
      ui Saved { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Navigation.PresentToast(')
    Expect(compiled.code).toContain('_ViewProps.__tao')
    Expect(compiled.code).toContain('key: TR.Value("document-saved")')
    Expect(compiled.code).toContain('duration: TR.Value(3)')
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
      ui Home {
        action Activate { present SelectionApp@settings }
        render Empty()
      }
      ui Settings { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Navigation.Configure(_Scope.SelectionNav, {')
    Expect(compiled.code).toContain('"Initial": TR.Value("@home")')
    Expect(compiled.code).toContain('"Display": TR.Value("tabs")')
    Expect(compiled.code).toContain('"@settings": {')
    Expect(compiled.code).toContain('"Label": TR.Value("Settings")')
    Expect(compiled.code).toContain('"Content": _Scope.SettingsStack.evaluate()')
    Expect(compiled.code).toContain('TR.Navigation.Activate(')
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
      ui Home { render Empty() }
      ui Other { render Empty() }
      view Empty { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Navigation.Patch(_Scope.MainNavBase.evaluate(), {')
    Expect(compiled.code).toContain('"@other": {')
    Expect(compiled.code).toContain('"Label": TR.Value("Other")')
    Expect(compiled.code).toContain('"Content": TR.Navigation.UI({')
  })

  Test('compiles typed dynamic action arguments in source order', async () => {
    const compiled = await Compiler.compileCode(`
      app MyApp { view MainView }
      view MainView {
        action Receive Label is text, Count is number { }
        render Wrapper(Receive)
      }
      view Wrapper Callback is action(text, number) {
        action CallCallback {
          do Callback("first", 2)
        }
        render Text("Done")
      }
      view Text Value is text {
        render inject Value ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
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
      view MainView {
        let Save = action { }
        action Run { do Save() }
        render Text("Ready")
      }
      view Text Value is text { render inject ${tsFence} return null ${fence} }
    `)

    Expect(compiled.validation.diagnostics).toEqual([])
    Expect(compiled.code).toContain('TR.Alias(() => TR.Action')
    Expect(compiled.code).toContain('TR.Do(_Scope.Save.evaluate())')
  })

  Test('compiles layout clauses into a generated app file', async () => {
    const compiled = await Compiler.compileCode(`
      use Col, Row from @tao/ui
      app LayoutApp { view MainView }
      layout Screen {
        render Col()[gap 4] {
          Text("Wrapped")
        }
      }
      view Text Value is text {
        render inject Value ${tsFence}
          return TR.Views.Text({ __tao: _ViewProps.__tao, children: [Value] })
        ${fence}
      }
      view MainView {
        render Col()[fill, content top stretch, gap 12, pad 16] {
          Row()[content spread-inset center, gap 8] {
            Text("Layout") [claim 2]
          }
          Screen()[content center]
        }
      }
    `)

    Expect(compiled.files.map(file => file.relativePath)).toContain('App.tsx')
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles custom types, and is list item constructors, casts, and member access', async () => {
    const compiled = await Compiler.compileCode(`
      app TypeApp { view MainView }
      type Name is text
      type Tags is list
      type Job is {
        Title is text
      }
      type Person is {
        Name
        Tags
        Job
      }
      type InlineJob is {
        Role is text
      }
      type CurrentJob is InlineJob
      let DisplayName = Name "Ada"
      let DemoPerson = Person {
        Name: DisplayName,
        Tags: Tags ["compiler", "runtime"],
        Job: Job { Title: "Engineer" }
      }
      let EmptyItem = item {}
      let DemoCurrentJob = CurrentJob { Role: "Engineer" }
      view MainView {
        render Stack(){
          TextValue(DemoPerson.Name)
          ListValue(DemoPerson.Tags)
          ItemValue(item {})
        }
      }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      view TextValue Value is text {
        render inject Value ${tsFence}
          return <RN.Text>{Value}</RN.Text>
        ${fence}
      }
      view ListValue Values is list {
        render inject Values ${tsFence}
          return <RN.Text>{Values.join(", ")}</RN.Text>
        ${fence}
      }
      view ItemValue Value is item {
        render inject Value ${tsFence}
          return <RN.Text>{Object.keys(Value).length}</RN.Text>
        ${fence}
      }
    `)

    Expect(compiled.files).toHaveLength(1)
    Expect(compiled.validation.diagnostics).toEqual([])
  })

  Test('compiles v0 Tao test-plan IR', async () => {
    await withTaoFiles(
      'tao-test-plan-',
      {
        'Main.test.tao': `
        use MyApp from ./

        test "Smoke" {
          check "renders" {
            run MyApp
            expect text "Hello"
            press text "Add"
            enter "Draft" into label "Title"
            submit placeholder "Title"
            expect input placeholder "Title" value "Draft"
            back
            data loading
            expect missing text "Loading"
          }
        }
      `,
        'Main.tao': `
        app MyApp { view MainView }
        view MainView {
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
            ...(step.kind === 'dataStatus'
              ? { status: step.status, message: step.message }
              : {}),
          })),
        ).toEqual([
          { kind: 'expect', selector: 'text', text: 'Hello' },
          { kind: 'press', selector: 'text', text: 'Add' },
          { kind: 'enter', selector: 'label', target: 'Title', value: 'Draft' },
          { kind: 'submit', selector: 'placeholder', target: 'Title' },
          { kind: 'expectInputValue', selector: 'placeholder', target: 'Title', value: 'Draft' },
          { kind: 'back' },
          { kind: 'dataStatus', status: 'loading', message: '' },
          { kind: 'expect', selector: 'text', text: 'Loading' },
        ])
        Expect(plan.suites[0]?.source.range).toBeDefined()
        Expect(plan.suites[0]?.checks[0]?.run.source.range).toBeDefined()
      },
    )
  })

  Test(
    'compiles tag selectors, grouped expectations, selected rows, and bare data status to structured IR',
    async () => {
      await withTaoFiles(
        'tao-structured-test-plan-',
        {
          'Main.test.tao': `
        use MyApp from ./

        test "Structured" {
          check "scopes interactions" {
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
            data loading
          }
        }
      `,
          'Main.tao': `
        app MyApp { view MainView }
        view MainView { render inject ${tsFence} return null ${fence} }
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
          Expect(steps[5]).toEqual(Expect['objectContaining']({ kind: 'dataStatus', status: 'loading', message: '' }))
          Expect('dataName' in steps[5]!).toBe(false)
        },
      )
    },
  )
})
