import { Type } from '@ast-utils'
import { Describe, Expect, Test } from '@shared/test'
import { AST } from '../parser-src/parser'
import { parseCodeWithErrors, testParseCode } from './test-parse'

Describe('parser: typed values', () => {
  Test('parses alias ascriptions, element-typed lists, fields?, and bridged expressions', async () => {
    const result = await testParseCode(`
      type Profile is {
        Name text,
        Subtitle text?,
      }
      let Names is list of text = ["Ada", "Grace"]
      function CountWords(Value text) returns number {
        return CountWords(Value) from ./Text.ts
      }
    `)

    const profile = result.entry.ast.statements.find(AST.isTypeDeclaration)
    const names = result.entry.ast.statements.find(AST.isAliasDeclaration)
    const countWords = result.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(profile, AST.isTypeDeclaration)
    Expect.Is(profile.type, AST.isItemTypeExpression)
    Expect(profile.type.properties[1]?.optional).toBe(true)
    Expect.Is(names, AST.isAliasDeclaration)
    Expect.Is(names.type, AST.isListTypeReference)
    Expect(Type.referenceName(names.type)).toBe('list of text')
    Expect.Is(countWords, AST.isFunctionDeclaration)
    const returned = AST.returnStatementsOf(countWords)[0]?.value
    Expect.Is(returned, AST.isFromExpression)
    Expect(returned.path).toBe('./Text.ts')
    Expect.Is(returned.expression, AST.isFunctionCallExpression)
    Expect(returned.expression.function.$refText).toBe('CountWords')
  })

  Test('rejects bare list in user type references while primitive list remains valid', async () => {
    const rejected = await parseCodeWithErrors('primitive list type Tags is list')
    Expect(rejected.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(rejected.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)

    const primitive = await testParseCode('primitive list')
    Expect.Is(primitive.entry.ast.statements[0], AST.isPrimitiveDeclaration)
  })
})
