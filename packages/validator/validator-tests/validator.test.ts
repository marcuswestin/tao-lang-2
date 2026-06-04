import { Parser } from '@parser'
import { FS, Repo } from '@shared'
import { describe, expect, test } from 'bun:test'
import { appValidationMessages } from '../validator-src/app-validator'
import Validator from '../validator-src/validator'
import { viewValidationMessages } from '../validator-src/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const repoRoot = await Repo.getRoot()
const kitchenSinkPath = FS.resolvePath(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')
const tsFence = '```ts'
const fence = '```'

describe('Tao validator structural diagnostics', () => {
  test('validates the current Kitchen Sink app', async () => {
    const result = await Validator.validateFile(kitchenSinkPath)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('validates an existing parser result', async () => {
    const parsed = await Parser.parseCode(`
      app MyApp { ui MainView }
      ui MainView { }
    `)
    const result = Validator.validateParsed(parsed)

    expect(validationErrorMessages(result)).toEqual([])
  })

  test('returns parser diagnostics without running structural checks on syntax errors', async () => {
    const result = await Validator.validateCode('view Legacy { }')

    expect(result.diagnostics.some(diagnostic => diagnostic.source === 'parser')).toBe(true)
    expect(result.validatorDiagnostics).toEqual([])
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
})
