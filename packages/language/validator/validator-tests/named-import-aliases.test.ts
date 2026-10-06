import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { useValidationCodes } from '../validator-src/diagnostic-codes'
import { useValidationMessages } from '../validator-src/validators/use-validator'
import { validationErrorMessages, withValidatedFiles } from './test-validate'

const library = `
  public type Title is text
  public func Display(Value Title) -> text { return Value }
`

Describe('validator: named import aliases', () => {
  Test('retains constructors and signature projections under their local import spelling', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': `
        use Title as TitleType, Display as Show from ./library/Library
        let Title = TitleType "Untitled"
        let Other = TitleType "Other"
        type DisplayTitle is Show.Value
        let Shown = Show(DisplayTitle "Shown")
      `,
      'library/Library.tao': library,
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
      const use = result.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      const owner = AST.resolvedImportedDeclarations(use).find(AST.isTypeDeclaration)
      Expect.Is(owner, AST.isTypeDeclaration)
      const other = result.entry.ast.statements.find(statement =>
        AST.isAliasDeclaration(statement) && statement.name === 'Other'
      )
      Expect.Is(other, AST.isAliasDeclaration)
      Expect.Is(other.value, AST.isConfigurationConstructor)
      Expect(other.value.type.ref).toBe(owner)
      const projection = result.entry.ast.statements.find(statement =>
        AST.isTypeDeclaration(statement) && statement.name === 'DisplayTitle'
      )
      Expect.Is(projection, AST.isTypeDeclaration)
      Expect.Is(projection.type, AST.isNamedTypeReference)
      const signatureOwner = AST.resolvedImportedDeclarations(use).find(AST.isFunctionDeclaration)
      Expect.Is(signatureOwner, AST.isFunctionDeclaration)
      Expect(Type.definitionOfReference(projection.type) === AST.parametersOf(signatureOwner)[0]?.inlineType).toBe(true)
      const domain = Type.ofDefinition(projection)
      Expect(domain.kind).toBe('primitive')
      if (domain.kind === 'primitive') {
        Expect(domain.primitive).toBe('text')
      }
      Expect(result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport)).toEqual([])
    })
  })

  Test('keeps dotted callees under lexical shadow and self-order rules', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'use Title from ./library/Library\nlet Title = Title.Default()',
      'library/Library.tao': `public type Title is text with {
        static func Default() -> Title { return Title "Untitled" }
      }`,
    }, result => {
      Expect(validationErrorMessages(result).length).toBeGreaterThan(0)
      const call = AST.streamAllContents(result.entry.ast).find(AST.isMethodCallExpression)
      Expect.Is(call, AST.isMethodCallExpression)
      Expect.Is(call.callee, AST.isMemberAccessExpression)
      Expect(AST.isTypeDeclaration(call.callee.target.ref)).toBe(false)
    })
  })

  Test('keeps source visibility separate from a public-looking local alias', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'use Hidden as Visible from ./library/Library\nlet Value = Visible "x"',
      'library/Library.tao': 'type Hidden is text',
    }, result => {
      Expect(validationErrorMessages(result).length).toBeGreaterThan(0)
      const use = result.entry.ast.statements.find(AST.isUseStatement)
      Expect.Is(use, AST.isUseStatement)
      Expect(AST.resolvedImportedBindings(use)).toEqual([])
    })
  })

  Test('checks local alias collisions in their namespace', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'use Label as Local, Greeting as Local from ./library/Library\nlet Value = Local "x"',
      'library/Library.tao': 'public type Label is text\npublic let Greeting = "hello"',
    }, result => {
      Expect(validationErrorMessages(result)).toEqual([])
    })
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'use Label as Local, Other as Local from ./library/Library\nlet Value = Local "x"',
      'library/Library.tao': 'public type Label is text\npublic type Other is text',
    }, result => {
      Expect(validationErrorMessages(result)).toContain(useValidationMessages.duplicateImport('Local'))
    })
  })

  Test('reports an unused alias even though the import target itself is linked', async () => {
    await withValidatedFiles('Main.tao', {
      'Main.tao': 'use Title as TitleType from ./library/Library\nlet Value = "unused"',
      'library/Library.tao': library,
    }, result => {
      Expect(
        result.diagnostics.filter(diagnostic => diagnostic.code === useValidationCodes.unusedImport).map(diagnostic =>
          diagnostic.message
        ),
      )
        .toEqual([useValidationMessages.unusedImport('TitleType')])
    })
  })
})
