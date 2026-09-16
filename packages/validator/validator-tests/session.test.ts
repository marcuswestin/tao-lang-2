import { AST } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Validation } from '../validator-src/validation'
import Validator, { type ValidationResult } from '../validator-src/validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { validationErrorMessages } from './test-validate'

Describe('validator: reusable sessions', () => {
  Test('shares workspace memoization across per-file contexts in one Langium batch', () => {
    const memoStore = new Map<string, unknown>()
    let computes = 0
    const runContext = {
      entryFilePath: '/Main.tao',
      memoStore,
      packagesContext: {} as Parameters<typeof Validator.createContext>[0],
      workspaceFiles: [] as readonly AST.TaoFile[],
    }
    const accept = () => undefined
    const first = Validation.createContext(accept, runContext)
    const second = Validation.createContext(accept, { ...runContext, entryFilePath: '/Other.tao' })

    Expect(first.memo('workspace.views', () => ++computes)).toBe(1)
    Expect(second.memo('workspace.views', () => ++computes)).toBe(1)
    Expect(computes).toBe(1)
  })

  Test('isolates concurrent results that reuse the standalone source URI', async () => {
    const session = await Validator.createSession()
    const [textResult, numberResult, syntaxResult] = await Promise.all([
      session.validateCode(nominalApp('TextApp', 'text', '"Ada"', 'Text', 'text')),
      session.validateCode(nominalApp('NumberApp', 'number', '1', 'Text', 'text')),
      session.validateCode('view Broken() { render }'),
    ])

    Expect(appName(textResult)).toBe('TextApp')
    Expect(validationErrorMessages(textResult)).toEqual([])

    Expect(appName(numberResult)).toBe('NumberApp')
    Expect(validationErrorMessages(numberResult)).toContain(InvocationsValidator.messages.unmatchedArgument('Text'))
    Expect(validationErrorMessages(numberResult)).toContain(
      InvocationsValidator.messages.missingArgument('Text', 'Value'),
    )

    Expect(Diagnostics.hasSource(syntaxResult.diagnostics, 'parser')).toBe(true)

    const subsequentResult = await session.validateCode(nominalApp('LaterApp', 'text', '"Grace"', 'Text', 'text'))
    Expect(appName(subsequentResult)).toBe('LaterApp')
    Expect(validationErrorMessages(subsequentResult)).toEqual([])
  })
})

function nominalApp(
  appName: string,
  nominalBase: 'boolean' | 'number' | 'text',
  value: string,
  renderedView: string,
  renderedType: 'boolean' | 'number' | 'text',
): string {
  return `
    app ${appName} { view MainView }
    type Name is ${nominalBase}
    view MainView() { render ${renderedView}(Name ${value}) }
    view ${renderedView}(Value ${renderedType}) {
      render inject Value \`\`\`ts
        return null
      \`\`\`
    }
  `
}

function appName(result: ValidationResult): string | undefined {
  return result.entry.ast.statements.find(AST.isAppDeclaration)?.name
}
