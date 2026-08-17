import { Describe, Expect, Test } from '@shared/test'
import { AliasesValidator } from '../validator-src/validators/aliases-validator'
import { AppValidator } from '../validator-src/validators/app-validator'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import {
  fence,
  rejects,
  stubLayout,
  stubView,
  testValidateCodeWithErrors,
  tsFence,
  validationErrorMessages,
} from './test-validate'

Describe('validator: apps and views', () => {
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
      view MainView(Label is text) {
        render Text(Label)
      }
      ${stubView('Text', 'Value is text')}
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

  Test('rejects state and action declarations in layouts and render blocks', async () => {
    const layoutResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      view MainView() {
        render Stack()
      }
      layout Stack() {
        state Count = 0
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const renderBlockResult = await testValidateCodeWithErrors(`
      app MyApp { view MainView }
      ${stubView('Text', 'Value is text')}
      view MainView() {
        render Text("hi") {
          action AddOne() { }
        }
      }
    `)

    Expect(validationErrorMessages(layoutResult)).toContain(ViewsValidator.messages.layoutBody)
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
      ${stubView('Text', 'Value is text')}
    `,
      ViewsValidator.messages.viewBody,
    ),
  )

  Test('rejects duplicate view parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view Text }
      view Text(Value is text, Value is number) { }
    `)

    Expect(validationErrorMessages(result)).toContain(ViewsValidator.messages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(AliasesValidator.messages.duplicateName('Value'))
  })

  Test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { view ChildrenView }
      view ChildrenView(children is text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view KeyView(key is text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view RefView(ref is text) {
        render inject ${tsFence}
          return null
        ${fence}
      }
      view TaoPropView(__tao is text) {
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
      ${stubView('Text', 'Value is text')}
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
      ${stubView('Text', 'Value is text')}
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
      ${stubLayout('Stack')}
      ${stubView('Text', 'Value is text')}
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
      ${stubLayout('Stack')}
      ${stubView('Text', 'Value is text')}
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
      ${stubLayout('Stack')}
      ${stubView('Text', 'Value is text')}
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
      ${stubLayout('Stack')}
      ${stubView('Text', 'Value is text')}
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
      layout Col() { render inject ${tsFence} return null ${fence} }
      view Text(Value is text) { render inject ${tsFence} return null ${fence} }
    `,
      ViewsValidator.messages.duplicateTag('#same'),
    ),
  )
})
