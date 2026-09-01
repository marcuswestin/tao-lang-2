import { Describe, Expect, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { navigationValidationMessages } from '../validator-src/validators/navigation-validator'
import { StateValidator } from '../validator-src/validators/StateValidator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  accepts,
  acceptsFiles,
  fence,
  rejects,
  stubContainer,
  stubView,
  testValidateCode,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

Describe('validator: apps and views', () => {
  Test('accepts a bound configured root with app-owned persisted state and update action', async () => {
    const result = await testValidateCode(`
      use StackNav from @tao/nav
      app Workspace {
        Name "Workspace"
        state Expanded is list of text = [] (persist)
        action ChangeExpanded(Value list of text) { set Expanded = Value }
        Navigator StackNav {
          Initial Root(Expanded: Expanded, ChangeExpanded: ChangeExpanded)
        }
      }
      view Root(Expanded list of text, ChangeExpanded action(list of text)) {
        Title "Root"
        render Empty()
      }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates configured root view arguments with ordinary invocation rules', async () => {
    const result = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app Workspace {
        Name "Workspace"
        Navigator StackNav { Initial Root() }
      }
      view Root(Value text) { Title "Root" render Empty() }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toContain(
      navigationValidationMessages.missingArgument('Root', 'Value'),
    )
  })

  Test(
    'allows direct recursive view references without new syntax',
    accepts(`
    app RecursiveApp { view Recursive }
    view Recursive() { render Recursive() }
  `),
  )
  Test('accepts an app persisted number state as a SplitNav Width binding', async () => {
    const result = await testValidateCode(`
      use SplitNav from @tao/nav
      app Workspace {
        Name "Workspace"
        state PaneWidth is number = 320 (persist)
        Navigator SplitNav {
          @pane { Content Pane Width PaneWidth Resizable true }
        }
      }
      view Pane() { render Empty() }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('accepts an app persisted case-set state', async () => {
    const result = await testValidateCode(`
      use StackNav from @tao/nav
      type Theme is one of Light, Dark
      app Workspace {
        Name "Workspace"
        state CurrentTheme is Theme = Light (persist)
        Navigator StackNav { Initial Main }
      }
      view Main() { Title "Main" render Empty() }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('requires app state to be typed and persisted', async () => {
    const result = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app Workspace {
        Name "Workspace"
        state PaneWidth = 320
        Navigator StackNav { Initial Pane }
      }
      view Pane() { Title "Pane" render Empty() }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toEqual([
      StateValidator.messages.appStateMustPersist('PaneWidth'),
      StateValidator.messages.persistedTypeRequired('PaneWidth'),
    ])
  })

  Test('rejects persisted state whose declared runtime shape cannot be encoded', async () => {
    const result = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app Workspace {
        Name "Workspace"
        state OnSave is action() = action { } (persist)
        Navigator StackNav { Initial Pane }
      }
      view Pane() { Title "Pane" render Empty() }
      ${stubView('Empty')}
    `)
    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.persistedTypeUnsupported('OnSave', 'action()'),
    )
  })

  Test('rejects self-referential persisted items without recursing forever', async () => {
    const result = await testValidateCodeWithErrors(`
      type Person is { Friend Person }
      app Cyclic {
        state Current is Person = "invalid" (persist)
        view Main
      }
      view Main() { render Empty() }
      ${stubView('Empty')}
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.persistedTypeUnsupported('Current', 'Person'),
    )
  })

  Test('rejects persisted item aliases whose runtime shape is unresolved', async () => {
    const result = await testValidateCodeWithErrors(`
      type Bag is item
      app Shapeless {
        state Current is Bag = "invalid" (persist)
        view Main
      }
      view Main() { render Empty() }
      ${stubView('Empty')}
    `)

    Expect(validationErrorMessages(result)).toContain(
      StateValidator.messages.persistedTypeUnsupported('Current', 'Bag'),
    )
  })

  Test(
    'accepts cross-file derived primitive types for persisted app state',
    acceptsFiles({
      'Main.tao': `
        use PaneWidth from ./Types.tao
        use StackNav from @tao/nav
        app Workspace {
          Name "Workspace"
          state Width is PaneWidth = PaneWidth 320 (persist)
          Navigator StackNav { Initial Pane }
        }
        view Pane() { Title "Pane" render Empty() }
        ${stubView('Empty')}
      `,
      'Types.tao': 'workspace type PaneWidth is number',
    }),
  )
  Test(
    'rejects unsupported top-level statements',
    rejects(
      `
      app MyApp { view MainView }
      render MainView()
      view MainView() { }
    `,
      AppValidator.messages.topLevel,
    ),
  )

  Test(
    'rejects file-level state declarations',
    rejects(
      `
      app MyApp { view MainView }
      state Count = 0
      view MainView() { }
    `,
      AppValidator.messages.topLevel,
    ),
  )

  Test('requires exactly one root view in app blocks', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { }
      view MainView() { }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app MyApp {
        view MainView
        view OtherView
      }
      view MainView() { }
      view OtherView() { }
    `)

    Expect(validationErrorMessages(missing)).toContain(AppValidator.messages.appRootCount('MyApp', 0))
    Expect(validationErrorMessages(duplicate)).toContain(AppValidator.messages.appRootCount('MyApp', 2))
  })

  Test(
    'accepts a root view as the Navigator and Name sugar of one ordinary app',
    accepts(`
      app MyApp { view MainView }
      ${stubView('MainView')}
    `),
  )

  Test(
    'accepts a root view beside the app configuration it does not supply',
    accepts(`
      design Theme { canvas #fff }
      app MyApp {
        Name "Root View App"
        Design Theme
        view MainView
        Restore fresh
      }
      ${stubView('MainView')}
    `),
  )

  Test(
    'rejects a root view supplied beside an explicit Navigator',
    rejects(
      `
      use StackNav from @tao/nav
      app MyApp {
        Name "Ambiguous"
        Navigator StackNav { Initial MainView }
        view MainView
      }
      view MainView() { Title "Main" render Empty() }
      ${stubView('Empty')}
    `,
      AppValidator.messages.propertyDuplicate('MyApp', 'Navigator'),
    ),
  )

  Test('rejects unknown, duplicated, and mistyped supplied app slots', async () => {
    const result = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app MyApp {
        Name "Demo"
        Name "Demo again"
        Navigator "not a nav"
        Theme "unknown slot"
      }
      ${stubView('MainView')}
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.propertyDuplicate('MyApp', 'Name'))
    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.variantProperty('MyApp', 'Theme'))
    Expect(validationErrorMessages(result)).toContain(
      AppValidator.messages.propertyType('MyApp', 'Navigator', 'Navigator', 'text'),
    )
  })

  Test('rejects an app head that is not an app value', async () => {
    const result = await testValidateCodeWithErrors(`
      let NotAnApp = "text"
      app MyApp = NotAnApp
      ${stubView('MainView')}
    `)

    Expect(validationErrorMessages(result)).toContain(AppValidator.messages.headType('MyApp', 'text'))
  })

  Test('accepts restoration deviations and rejects unknown or incoherent exclusions', async () => {
    Expect(validationErrorMessages(
      await testValidateCode(`
      use StackNav from @tao/nav
      app Base {
        Name "Base"
        Navigator StackNav { Initial MainView }
        Restore automatic { Exclude sheets, menus, toasts }
      }
      app Fresh = Base with { Restore fresh }
      view MainView() { Title "Main" render Empty() }
      ${stubView('Empty')}
    `),
    )).toEqual([])

    const invalid = validationErrorMessages(
      await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app Invalid {
        Name "Invalid"
        Navigator StackNav { Initial MainView }
        Restore fresh { Exclude overlays, sheets, sheets }
      }
      view MainView() { Title "Main" render Empty() }
      ${stubView('Empty')}
    `),
    )
    Expect(invalid).toContain(AppValidator.messages.restorationFreshExclusions())
    Expect(invalid).toContain(AppValidator.messages.restorationExclusion('overlays'))
    Expect(invalid).toContain(AppValidator.messages.restorationExclusionDuplicate('sheets'))
  })

  Test('attaches app variant patch diagnostics to the offending entry, not the file start', async () => {
    const result = await testValidateCodeWithErrors(`
      use StackNav from @tao/nav
      app Base {
        Name "Base"
        Navigator StackNav { Initial MainView }
      }
      app Variant = Base with {
        Theme "unknown slot"
      }
      ${stubView('MainView')}
    `)
    const diagnostic = result.diagnostics.find(({ message }) =>
      message === AppValidator.messages.variantProperty('Variant', 'Theme')
    )

    Expect(diagnostic?.range).toBeDefined()
    Expect(diagnostic?.range?.start.line).toBeGreaterThan(0)
  })

  Test(
    'rejects app root view declarations with parameters',
    rejects(
      `
      app MyApp { view MainView }
      view MainView(Label text) {
        render Text(Label)
      }
      ${stubView('Text', 'Value text')}
    `,
      AppValidator.messages.rootViewParameters('MyApp', 'MainView'),
    ),
  )

  Test(
    'rejects non-root-view statements in app blocks',
    rejects(
      `
      app MyApp {
        let Greeting = "Hello"
        view MainView
      }
      view MainView() { }
    `,
      AppValidator.messages.appBlock('MyApp'),
    ),
  )

  Test(
    'rejects unsupported view body statements',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        view Nested() { }
      }
    `,
      ViewsValidator.messages.viewBody,
    ),
  )

  Test(
    'accepts state, query, and action declarations in a content-accepting view body',
    accepts(`
      data Workspaces / Workspace { Name text }
      app MyApp { view MainView }
      view MainView() {
        render Stack() {
          Text("hi")
        }
      }
      view Stack() {
        state Count = 0
        query Workspaces { }
        action AddOne() { set Count += 1 }
        render Col() {
          @@content
        }
      }
      ${stubContainer('Col')}
      ${stubView('Text', 'Value text')}
    `),
  )

  Test('rejects state and action declarations in render child blocks', async () => {
    const renderBlockResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      ${stubView('Text', 'Value text')}
      view MainView() {
        render Text("hi") {
          action AddOne() { }
        }
      }
    `)

    Expect(validationErrorMessages(renderBlockResult)).toContain(ViewsValidator.messages.renderBlock)
  })

  Test(
    'rejects bare child invocations directly in view bodies',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        Text("Hello")
      }
      ${stubView('Text', 'Value text')}
    `,
      ViewsValidator.messages.viewBody,
    ),
  )

  Test('rejects duplicate view parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Text }
      view Text(Value text, Value number) { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(AliasesValidator.messages.duplicateName('Value'))
  })

  Test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view ChildrenView }
      view ChildrenView(children text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view KeyView(key text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view RefView(ref text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TaoPropView(__tao text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('children'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('key'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('ref'))
    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.reservedParameter('__tao'))
  })

  Test('requires exactly one render statement in view bodies', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView() {
        let Greeting = "Hello"
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView() {
        render Text("Hello")
        render Text("Again")
      }
      ${stubView('Text', 'Value text')}
    `)

    Expect(validationErrorMessages(missing)).toContain(ViewsValidator.messages.renderCount('MainView'))
    Expect(validationErrorMessages(extra)).toContain(ViewsValidator.messages.renderCount('MainView'))
  })

  Test(
    'requires render to be the last view body statement',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        render Text("Hello")
        let Greeting = "Again"
      }
      ${stubView('Text', 'Value text')}
    `,
      ViewsValidator.messages.renderLast,
    ),
  )

  Test('rejects render inject mixed with view body statements', async () => {
    const withRender = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView() {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView()
      }
    `)
    const withAlias = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView() {
        let Greeting = "Hello"
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(withRender)).toContain(ViewsValidator.messages.renderInjectPlacement)
    Expect(validationErrorMessages(withAlias)).toContain(ViewsValidator.messages.renderInjectPlacement)
  })

  Test(
    'rejects render inject inside render child blocks',
    rejects(
      `
      app MyApp { view MainView }
      view MainView() {
        render Container(){
          render inject ${tsFence}
            return null
          ${fence}
        }
      }
      view Container() { }
    `,
      ViewsValidator.messages.renderInjectPlacement,
    ),
  )

  Test(
    'requires render block aliases before child view invocations',
    rejects(
      `
      app MyApp { view MainView }
      ${stubContainer('Stack')}
      ${stubView('Text', 'Value text')}
      view MainView() {
        render Stack(){
          Text("First")
          let Later = "Second"
          Text(Later)
        }
      }
    `,
      ViewsValidator.messages.renderBlockAliasPlacement,
    ),
  )

  Test(
    'rejects duplicate aliases in the same render child block',
    rejects(
      `
      app MyApp { view MainView }
      ${stubContainer('Stack')}
      ${stubView('Text', 'Value text')}
      view MainView() {
        render Stack(){
          let Local = "First"
          let Local = "Second"
          Text(Local)
        }
      }
    `,
      AliasesValidator.messages.duplicateName('Local'),
    ),
  )

  Test(
    'rejects duplicate aliases in nested child invocation blocks',
    rejects(
      `
      app MyApp { view MainView }
      ${stubContainer('Stack')}
      ${stubView('Text', 'Value text')}
      view MainView() {
        render Stack(){
          Stack(){
            let Local = "First"
            let Local = "Second"
            Text(Local)
          }
        }
      }
    `,
      AliasesValidator.messages.duplicateName('Local'),
    ),
  )

  Test(
    'rejects nested child invocation aliases that shadow visible declarations',
    rejects(
      `
      app MyApp { view MainView }
      ${stubContainer('Stack')}
      ${stubView('Text', 'Value text')}
      view MainView() {
        render Stack(){
          Stack(){
            let Text = "shadow"
          }
        }
      }
    `,
      AliasesValidator.messages.duplicateName('Text'),
    ),
  )

  Test(
    'rejects duplicate tags in the same lexical block',
    rejects(
      `
      app TagApp { view Main }
      view Main() {
        render Col() {
          #same
          Text("one")
          #same
          Text("two")
        }
      }
      view Col() { render inject Content @@content ${tsFence} return Content ${fence} }
      view Text(Value text) { render inject ${tsFence} return null ${fence} }
    `,
      ViewsValidator.messages.duplicateTag('#same'),
    ),
  )
})
