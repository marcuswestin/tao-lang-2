import { AST, Parser } from '@parser'
import { FS, Repo } from '@shared'
import { describe, expect, test } from 'bun:test'
import { aliasValidationMessages } from '../validator-src/aliases-validator'
import { appValidationMessages } from '../validator-src/app-validator'
import { inferExpressionType } from '../validator-src/expressions-validator'
import { invocationValidationMessages } from '../validator-src/invocations-validator'
import { parseCodeForValidation } from '../validator-src/langium-services'
import Validator from '../validator-src/validator'
import { viewValidationMessages } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const repoRoot = await Repo.getRoot()
const kitchenSinkPath = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')
const targetKitchenSinkPath = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink - Target/Kitchen Sink - Target.tao')
const typeSystemTestsPath = FS.resolvePath(repoRoot, 'Apps/Test Apps/Type System Tests/Type System Tests.tao')
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
      ui MainView { }
    `)
    const result = await Validator.validateParsed(parsed)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await Validator.validateCode('view Legacy { }')

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

  test('rejects duplicate ui parameters', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui Text }
      ui Text Value text, Value text { }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.duplicateParameter('Value'))
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
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render inject ${tsFence}
          return null
        ${fence}
        render MainView
      }
    `)

    expect(validationErrorMessages(result)).toContain(viewValidationMessages.renderInjectPlacement)
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
      ui Text Value text { }
      ui MainView Label text {
        alias Local = Label
        render Text Greeting
        render Text Local
      }
    `)
  })

  test('rejects duplicate file-level aliases', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias Greeting = "Hello"
      alias Greeting = "Again"
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.duplicateVisibleName('Greeting'))
  })

  test('rejects local aliases that shadow visible values', async () => {
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

    expect(validationErrorMessages(parameterShadow)).toContain(aliasValidationMessages.duplicateVisibleName('Label'))
    expect(validationErrorMessages(fileAliasShadow)).toContain(aliasValidationMessages.duplicateVisibleName('Greeting'))
  })

  test('rejects alias cycles', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      alias First = Second
      alias Second = First
      ui MainView { }
    `)

    expect(validationErrorMessages(result)).toContain(aliasValidationMessages.cycle('First'))
  })

  test('rejects render invocation arity errors', async () => {
    const missing = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open"
      }
      ui Tile Title text, Count number { }
    `)
    const extra = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Text "Open", 1
      }
      ui Text Value text { }
    `)

    expect(validationErrorMessages(missing)).toContain(invocationValidationMessages.missingArgument('Tile', 'Count'))
    expect(validationErrorMessages(extra)).toContain(invocationValidationMessages.extraArguments('Text', 1, 2))
  })

  test('rejects text and number argument mismatches through Typir', async () => {
    const result = await testValidateCodeWithErrors(`
      app MyApp { ui MainView }
      ui MainView {
        render Tile "Open", "not a count"
      }
      ui Tile Title text, Count number { }
    `)

    expect(validationErrorMessages(result)).toContain("Argument for parameter 'Count' expects number, got text.")
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
