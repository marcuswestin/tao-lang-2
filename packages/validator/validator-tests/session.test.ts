import { Packages } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test, testOverrideSlot, withTaoFiles } from '@shared/test'
import { Validation } from '../validator-src/validation'
import Validator, { type ValidationResult } from '../validator-src/validator'
import { InteractionValidator } from '../validator-src/validators/interaction-validator'
import { InvocationsValidator } from '../validator-src/validators/invocations-validator'
import { validationErrorMessages } from './test-validate'

const validationContextSlot = testOverrideSlot<typeof Validation.createContext>({
  read: () => Validation.createContext,
  write: createContext => {
    Validation.createContext = createContext
  },
})

Describe('validator: reusable sessions', () => {
  Test('shares production workspace memoization across a multi-document Langium build', async () => {
    await withTaoFiles(
      'tao-validator-batch-',
      {
        'One.tao': `view One() { render One() [rigid when One is active] }`,
        'Two.tao': `view Two() { render Two() [rigid when Two is active] }`,
      },
      async (paths, rootDir) => {
        const packagesContext = await Packages.createContext(rootDir)
        const { services } = Parser.createContext({ packages: Packages.createResolver(packagesContext) })
        Validator.installLangiumChecks(services, packagesContext)
        const originalCreateContext = Validation.createContext
        let regionIndexComputes = 0
        const restore = validationContextSlot.install((accept, runContext) => {
          const context = originalCreateContext(accept, runContext)
          const memo = context.memo
          return {
            ...context,
            memo<T>(key: string, compute: () => T): T {
              return memo(key, () => {
                if (key === 'interaction-validator.regionMembers') {
                  regionIndexComputes += 1
                }
                return compute()
              })
            },
          }
        })
        try {
          const documents = await Promise.all(
            [paths['One.tao'], paths['Two.tao']].map(async path =>
              await services.shared.workspace.LangiumDocumentFactory.fromUri(URI.file(path))
            ),
          )
          documents.forEach(document => services.shared.workspace.LangiumDocuments.addDocument(document))
          await services.shared.workspace.DocumentBuilder.build(documents, {
            eagerLinking: true,
            validation: true,
          })

          Expect(documents.map(document => document.diagnostics?.map(diagnostic => diagnostic.message))).toEqual([
            [InteractionValidator.messages.unknownRegion('One')],
            [InteractionValidator.messages.unknownRegion('Two')],
          ])
          Expect(regionIndexComputes).toBe(1)
        } finally {
          restore()
        }
      },
    )
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
