import { AST, Parser } from '@parser'
import { FS } from '@shared'
import { describe, expect, test } from 'bun:test'
import { aliasValidationMessages } from '../validator-src/aliases-validator'
import { appValidationMessages } from '../validator-src/app-validator'
import { inferExpressionType } from '../validator-src/expressions-validator'
import { invocationValidationMessages } from '../validator-src/invocations-validator'
import { parseCodeForValidation } from '../validator-src/langium-services'
import Validator from '../validator-src/validator'
import { viewValidationMessages } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const kitchenSinkPath = FS.repoPath('Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.repoPath('Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.repoPath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const tsFence = '```ts'
const fence = '```'

describe('Tao validator structural diagnostics', () => {
  test('validates the current Kitchen Sink app', async () => {
    const result = await Validator.validateFile(kitchenSinkPath)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('validates the target Kitchen Sink app', async () => {
    const result = await Validator.validateFile(targetKitchenSinkPath)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('validates the Type System Tests app', async () => {
    const result = await Validator.validateFile(typeSystemTestsPath)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('validates an existing parser result', async () => {
    const parsed = await Parser.parseCode(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const result = await Validator.validateParsed(parsed)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await Validator.validateCode('ui Broken { render }')

    expect(result.diagnostics.some(diagnostic => diagnostic.source === 'parser')).toBe(true)
    expect(result.validatorDiagnostics).toEqual([])
  })

  test('exposes Typir services for primitive expression inference', async () => {
    const parsed = await parseCodeForValidation(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Count = 3
      ui MainView { }
    `)
    const aliases = parsed.ast.statements.filter(AST.isAliasDeclaration)

    expect(inferExpressionType(aliases[0]!.value, parsed.typir)).toBe('text')
    expect(inferExpressionType(aliases[1]!.value, parsed.typir)).toBe('number')
  })

  test('rejects unsupported top-level statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      render MainView
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(appValidationMessages.topLevel)
  })

  test('requires exactly one app declaration', async () => {
    const missing = await testValidateCodeWithErrors('ui MainView { }')
    const duplicate = await testValidateCodeWithErrors(`
      app First { ui MainView }
      app Second { ui MainView }
      ui MainView { }
    `)

    expect(validationErrorMessages(missing)).toContain(appValidationMessages.appCount(0))
    expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appCount(2))
  })

  test('requires exactly one root ui in app blocks', async () => {
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

    expect(validationErrorMessages(missing)).toContain(appValidationMessages.appRootCount('MyApp', 0))
    expect(validationErrorMessages(duplicate)).toContain(appValidationMessages.appRootCount('MyApp', 2))
  })

  test('rejects app root ui declarations with parameters', async () => {
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

    expect(validationErrorMessages(result)).toContain(appValidationMessages.rootUiParameters('MyApp', 'MainView'))
  })

  test('rejects non-root-ui statements in app blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp {
        alias Greeting = "Hello"
        ui MainView
      }
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(appValidationMessages.appBlock('MyApp'))
  })

  test('rejects unsupported ui body statements', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        ui Nested { }
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.viewBody)
  })

  test('rejects bare child invocations directly in view bodies', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        Text "Hello"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.viewBody)
  })

  test('rejects duplicate ui parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui Text }
      ui Text Value text, Value text { }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.duplicateParameter('Value'))
    expect(validationErrorMessages(result)).not.toContain(aliasValidationMessages.duplicateName('Value'))
  })

  test('rejects generated view prop names as parameter names', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui ChildrenView }
      ui ChildrenView children text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui KeyView key text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui RefView ref text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('children'))
    expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('key'))
    expect(validationErrorMessages(result)).toContain(viewValidationMessages.reservedParameter('ref'))
  })

  test('requires exactly one render statement in ui bodies', async () => {
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

    expect(validationErrorMessages(missing)).toContain(viewValidationMessages.renderCount('MainView'))
    expect(validationErrorMessages(extra)).toContain(viewValidationMessages.renderCount('MainView'))
  })

  test('requires render to be the last ui body statement', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Hello"
        alias Greeting = "Again"
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderLast)
  })

  test('allows render inject as the only ui body statement', async () => {
    await testValidateCode(`
      app MyApp { ui Native }
      ui Native {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  test('rejects render inject mixed with ui body statements', async () => {
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

    expect(validationErrorMessages(withRender)).toContain(viewValidationMessages.renderInjectPlacement)
    expect(validationErrorMessages(withAlias)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  test('rejects render inject inside render child blocks', async () => {
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

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderInjectPlacement)
  })

  test('validates aliases and parameter references as render arguments', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      layout Stack {
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
          Text Greeting
          ParameterEcho Local
        }
      }
    `)
  })

  test('allows block-local aliases inside render child blocks', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        alias Local = "Outer"
        render Stack {
          alias Local = "First"
          Text Local
          Stack {
            alias Local = "Nested"
            Text Local
          }
        }
      }
    `)
  })

  test('requires render block aliases before child view invocations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Text "First"
          alias Later = "Second"
          Text Later
        }
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderBlockAliasPlacement)
  })

  test('allows the same alias name in separate render child blocks', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Stack {
            alias Local = "First"
            Text Local
          }
          Stack {
            alias Local = "Second"
            Text Local
          }
        }
      }
    `)
  })

  test('rejects duplicate aliases in the same render child block', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          alias Local = "First"
          alias Local = "Second"
          Text Local
        }
      }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Local'))
  })

  test('rejects duplicate aliases in nested child invocation blocks', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Stack {
            alias Local = "First"
            alias Local = "Second"
            Text Local
          }
        }
      }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Local'))
  })

  test('rejects nested child invocation aliases that shadow visible declarations', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Stack {
            alias Text = "shadow"
          }
        }
      }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Text'))
  })

  test('rejects alias references to later values', async () => {
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

    expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  test('rejects local alias references to later values', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Greeting = Later
        alias Later = Label
      }
    `)

    expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('Greeting', 'Later'),
    )
  })

  test('rejects local render arguments that reference later aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
      ui MainView {
        render Stack {
          Text Local
          alias Local = "Hello"
        }
      }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.usedBeforeDeclaration('Local'))
  })

  test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Greeting = "Again"
      ui MainView { }
    `)
    const diagnostic = result.diagnostics.find(diagnostic =>
      diagnostic.message === aliasValidationMessages.duplicateName('Greeting')
    )

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateName('Greeting'))
    expect(diagnostic?.nodeType).toBe(AST.AliasDeclaration.$type)
    expect(diagnostic?.range).toBeDefined()
  })

  test('rejects duplicate file-level declaration names', async () => {
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

    expect(validationErrorMessages(aliasBeforeView)).toContain(aliasValidationMessages.duplicateName('Text'))
    expect(validationErrorMessages(aliasAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
    expect(validationErrorMessages(viewAfterApp)).toContain(aliasValidationMessages.duplicateName('MyApp'))
  })

  test('rejects local aliases that shadow view declarations', async () => {
    const aliasShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        alias Text = "Hello"
        render Text Text
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Text text {
        render Text Text
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    expect(validationErrorMessages(aliasShadow)).toContain(aliasValidationMessages.duplicateName('Text'))
    expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateName('Text'))
  })

  test('allows local aliases that shadow file-level aliases', async () => {
    await testValidateCode(`
      app MyApp { ui MainView }
      alias Greeting = "Outer"
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui MainView {
        alias OuterGreeting = Greeting
        render Stack {
          alias Greeting = "Inner"
          Text Greeting
          Text OuterGreeting
        }
      }
      ui Text Value text {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)
  })

  test('rejects local aliases that shadow visible values', async () => {
    const parameterShadow = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView Label text {
        alias Label = "shadow"
      }
    `)

    expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateName('Label'))
  })

  test('rejects alias self references as undeclared-before references', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = First
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'First'),
    )
  })

  test('rejects mutually recursive aliases through declaration order', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  test('returns alias declaration-order diagnostics when invalid aliases are used as render arguments', async () => {
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

    expect(validationErrorMessages(result)).toContain(
      aliasValidationMessages.aliasUsedBeforeDeclaration('First', 'Second'),
    )
  })

  test('rejects render invocation arity errors', async () => {
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

    expect(validationErrorMessages(missing)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    expect(
      missing.diagnostics.find(diagnostic =>
        diagnostic.message === invocationValidationMessages.missingArgument('Tile', 'Count')
      )?.nodeType,
    ).toBe(AST.RenderStatement.$type)
    expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.extraArguments('Text', 1, 2))
  })

  test('rejects child view invocation arity and type errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      layout Stack {
        render inject ${tsFence}
          return <>{_ViewProps.children}</>
        ${fence}
      }
      ui MainView {
        render Stack {
          Tile 42
        }
      }
      ui Tile Title text, Count number {
        render inject ${tsFence}
          return null
        ${fence}
      }
    `)

    expect(validationErrorMessages(result)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    expect(validationErrorMessages(result)).toContain("Argument for parameter 'Title' expects text, got number.")
  })

  test('rejects text and number argument mismatches through Typir', async () => {
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

    expect(validationErrorMessages(result)).toContain("Argument for parameter 'Count' expects number, got text.")
  })

  test('reports type diagnostics alongside structural invocation errors', async () => {
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

    expect(validationErrorMessages(result)).toContain(invocationValidationMessages.extraArguments('Tile', 1, 2))
    expect(validationErrorMessages(result)).toContain("Argument for parameter 'Title' expects text, got number.")
  })

  test('keeps cross-view values out of scope through parser diagnostics', async () => {
    const result = await Validator.validateCode(`
      app MyApp { ui Target }
      ui Text Value text { }
      ui Source Secret text { }
      ui Target {
        render Text Secret
      }
    `)

    expect(result.diagnostics.some(diagnostic => diagnostic.source === 'parser')).toBe(true)
    expect(result.validatorDiagnostics).toEqual([])
  })
})
