import { AST, Parser } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { aliasValidationMessages } from '../validator-src/aliases-validator'
import { appValidationMessages } from '../validator-src/app-validator'
import { inferExpressionType } from '../validator-src/expressions-validator'
import { invocationValidationMessages } from '../validator-src/invocations-validator'
import { parseCodeForValidation } from '../validator-src/langium-services'
import Validator from '../validator-src/validator'
import { viewValidationMessages } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const kitchenSinkPath = await FS.resolveRepoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = await FS.resolveRepoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = await FS.resolveRepoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const tsFence = '```ts'
const fence = '```'

Describe('Tao validator structural diagnostics', () => {
  Test('validates the current Kitchen Sink app', async () => {
    const result = await Validator.validateFile(kitchenSinkPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the target Kitchen Sink app', async () => {
    const result = await Validator.validateFile(targetKitchenSinkPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates the Type System Tests app', async () => {
    const result = await Validator.validateFile(typeSystemTestsPath)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('validates an existing parser result', async () => {
    const parsed = await Parser.parseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const result = await Validator.validateParsed(parsed)

    Expect(validationErrorMessages(result)).toEqual([])
  })

  Test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await Validator.validateCode('view Legacy { }')

    Expect(result.diagnostics.some(diagnostic => diagnostic.source === 'parser')).toBe(true)
    Expect(result.validatorDiagnostics).toEqual([])
  })

  Test('exposes Typir services for primitive expression inference', async () => {
    const parsed = await parseCodeForValidation(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Count = 3
      ui MainView { }
    `)
    const aliases = parsed.ast.statements.filter(AST.isAliasDeclaration)

    Expect(inferExpressionType(aliases[0]!.value, parsed.typir)).toBe('text')
    Expect(inferExpressionType(aliases[1]!.value, parsed.typir)).toBe('number')
  })

  Test('rejects unsupported top-level statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      render MainView
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.topLevel)
  })

  Test('requires exactly one app declaration', async () => {
    const missing = await testValidateCodeWithErrors('ui MainView { }')
    const duplicate = await testValidateCodeWithErrors(`
      app First { ui MainView }
      app Second { ui MainView }
      ui MainView { }
    `)

    Expect(validationErrorMessages(missing)).toContain(appValidationMessages.appCount(0))
    Expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appCount(2))
  })

  Test('requires exactly one root ui in app blocks', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { }
      ui MainView { }
    `)
    const duplicate = await testValidateCodeWithErrors(`
      app MyApp {
        ui MainView
        ui OtherView
      }
      ui MainView { }
      ui OtherView { }
    `)

    Expect(validationErrorMessages(missing)).toContain(appValidationMessages.appRootCount('MyApp', 0))
    Expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appRootCount('MyApp', 2))
  })

  Test('rejects app root ui declarations with parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        render Text Label
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.rootUiParameters('MyApp', 'MainView'))
  })

  Test('rejects non-root-ui statements in app blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp {
        alias Greeting = "Hello"
        ui MainView
      }
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(appValidationMessages.appBlock('MyApp'))
  })

  Test('rejects unsupported ui body statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        ui Nested { }
      }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.viewBody)
  })

  Test('rejects duplicate ui parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui Text }
      ui Text Value text, Value text { }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.duplicateParameter('Value'))
    Expect(validationErrorMessages(result)).not.toContain(aliasValidationMessages.duplicateName('Value'))
  })

  Test('requires exactly one render statement in ui bodies', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Greeting = "Hello"
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
        render Text "Again"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(viewValidationMessages.renderCount('MainView'))
    Expect(validationErrorMessages(extra)).toContain(viewValidationMessages.renderCount('MainView'))
  })

  Test('allows render inject as the only ui body statement', async () => {
    await testValidateCode(`
      app MyApp { ui Native }
      ui Native {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  Test('rejects render inject mixed with ui body statements', async () => {
    const withRender = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView
      }
    `)
    const withAlias = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Greeting = "Hello"
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(withRender)).toContain(viewValidationMessages.renderInjectPlacement)
    Expect(validationErrorMessages(withAlias)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  Test('rejects render inject inside render child blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Container {
          render inject ${tsFence}
            return null
          ${fence}
        }
      }
      ui Container { }
    `)

    Expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  Test('validates aliases and parameter references as render arguments', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      ui Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui ParameterEcho Label text {
        render Text Label
      }
      ui MainView {
        alias Local = "Local"
        render Stack {
          render Text Greeting
          render ParameterEcho Local
        }
      }
    `)
  })

  Test('rejects alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = Later
      alias Later = "Hello"
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text Greeting
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Greeting = Later
        alias Later = Label
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  Test('rejects local render arguments that reference later aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text Local
        alias Local = "Hello"
      }
    `)

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.usedBeforeDeclaration('Local'))
  })

  Test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Greeting = "Again"
      ui MainView { }
    `)
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === aliasValidationMessages.duplicateName('Greeting')
    )

    Expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Greeting'))
    Expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    Expect(diagnostic?.range).toBeDefined()
  })

  Test('rejects duplicate file-level declaration names', async () => {
    const aliasBeforeView = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Text = "Hello"
      ui MainView { }
      ui Text Value text { }
    `)
    const aliasAfterApp = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias MyApp = "Hello"
      ui MainView { }
    `)
    const viewAfterApp = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MyApp { }
      ui MainView { }
    `)

    Expect(validationErrorMessages(aliasBeforeView)).toContain(aliasValidationMessages.duplicateName('Text'))
    Expect(validationErrorMessages(aliasAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
    Expect(validationErrorMessages(viewAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
  })

  Test('rejects local aliases that collide with visible declaration names', async () => {
    const localViewName = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Text = "Hello"
      }
      ui Text Value text { }
    `)
    const localAppName = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias MyApp = "Hello"
      }
    `)

    Expect(validationErrorMessages(localViewName)).toContain(aliasValidationMessages.duplicateName('Text'))
    Expect(validationErrorMessages(localAppName)).toContain(aliasValidationMessages.duplicateName('MyApp'))
  })

  Test('rejects local aliases that shadow visible values', async () => {
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Label = "shadow"
      }
    `)
    const fileAliasShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      ui MainView {
        alias Greeting = "shadow"
      }
    `)

    Expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateName('Label'))
    Expect(validationErrorMessages(fileAliasShadow)).toContain(aliasValidationMessages.duplicateName('Greeting'))
  })

  Test('rejects alias self references as undeclared-before references', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = First
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'First'),
    )
  })

  Test('rejects mutually recursive aliases through declaration order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui MainView { }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('returns alias declaration-order diagnostics when invalid aliases are used as render arguments', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Text First
      }
    `)

    Expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  Test('rejects render invocation arity errors', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Open", 1
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(missing)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    Expect(
      missing.diagnostics.find(diagnostic =>
        diagnostic.message === invocationValidationMessages.missingArgument('Tile', 'Count')
      )?.nodeType,
    ).toBe(AST.Render.$type)
    Expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.extraArguments('Text', 1, 2))
  })

  Test('rejects text and number argument mismatches through Typir', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", "not a count"
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain("Argument for parameter 'Count' expects number, got text.")
  })

  Test('reports type diagnostics alongside structural invocation errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile 42, "extra"
      }
      ui Tile Title text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    Expect(validationErrorMessages(result)).toContain(invocationValidationMessages.extraArguments('Tile', 1, 2))
    Expect(validationErrorMessages(result)).toContain("Argument for parameter 'Title' expects text, got number.")
  })

  Test('keeps cross-view values out of scope through parser diagnostics', async () => {
    const result = await Validator.validateCode(`
      app MyApp { ui Target }
      ui Text Value text { }
      ui Source Secret text { }
      ui Target {
        render Text Secret
      }
    `)

    Expect(result.diagnostics.some(diagnostic => diagnostic.source === 'parser')).toBe(true)
    Expect(result.validatorDiagnostics).toEqual([])
  })
})
