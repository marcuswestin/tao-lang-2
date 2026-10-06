import { Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'

Describe('Action when payload scope', () => {
  Test('binds the real error payload inside its branch and restores the outer value in siblings', async () => {
    const parsed = await Parser.parseCode(
      `
      data Documents / Document { Title text }
      let Message = "outer"
      action Report(Message text) { }
      action Read() {
        when Documents {
          error Message -> { do Report(Message) }
          empty -> { do Report(Message) }
        }
        do Report(Message)
      }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenActionStatement)
    Expect.Is(statement, AST.isWhenActionStatement)
    const branch = statement.branches[0]!
    Expect.Is(branch.payload, AST.isCasePayload)
    const outer = parsed.entry.ast.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'Message')
    Expect.Is(outer, AST.isAliasDeclaration)
    const refs = [...AST.streamAllContents(parsed.entry.ast)].filter(node =>
      AST.isValueReference(node) && node.target.$refText === 'Message'
    )
    Expect(refs).toHaveLength(3)
    Expect.Is(refs[0], AST.isValueReference)
    Expect.Is(refs[1], AST.isValueReference)
    Expect.Is(refs[2], AST.isValueReference)
    Expect(refs[0].target.ref === branch.payload).toBe(true)
    Expect(refs[1].target.ref === outer).toBe(true)
    Expect(refs[2].target.ref === outer).toBe(true)
    Expect(Type.displayName(Type.ofValueDeclaration(branch.payload))).toBe('text')
    Expect(Type.displayName(Type.ofExpression(refs[0]))).toBe('text')
  })
})
