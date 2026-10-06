import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { Type } from '../ast-utils-src/Type'

const declarations = `
  type Span is numeric with { units { seconds 1 (default), minutes 60 } }
  type Child is Span
`

async function fixture(source: string) {
  const parsed = await Parser.parseCode(declarations + source, { validation: false })
  Expect(parsed.diagnostics).toEqual([])
  const child = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Child')
  Expect.Is(child, AST.isTypeDeclaration)
  return { file: parsed.entry.ast, child }
}

Describe('type: generated unit reading dispatch', () => {
  Test('retains the concrete nominal receiver through real reading chains', async () => {
    const f = await fixture('func Read(Value Child) -> Child { return Value.seconds().minutes() }')
    const calls = [...AST.streamAllContents(f.file)].filter(AST.isMethodCallExpression)
    Expect(calls).toHaveLength(2)
    for (const call of calls) {
      const type = Type.ofExpression(call)
      Expect(type.kind === 'primitive' && type.primitive === 'numeric' && type.nominal === f.child).toBe(true)
      Expect(Type.quantityOwner(type) === f.child).toBe(true)
    }
    const correspondence = Type.correspondenceResolver(new Map())
    const type = correspondence.ofExpression(calls[0]!)
    Expect(type.kind === 'primitive' && type.nominal === f.child).toBe(true)
  })

  Test('reads a real item member without losing its concrete quantity role', async () => {
    const f = await fixture('func Read(Box { Span Child }) -> Child { return Box.Span.seconds() }')
    const call = AST.streamAllContents(f.file).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    const fn = f.file.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const role = AST.parametersOf(fn)[0]?.inlineType?.type
    Expect.Is(role, AST.isItemTypeExpression)
    const type = Type.ofExpression(call)
    Expect(type.kind === 'primitive' && type.nominal === role.properties[0]).toBe(true)
    Expect(Type.quantityOwner(type) === f.child).toBe(true)
  })

  Test('does not infer a valid quantity result for a generated reading with arguments', async () => {
    const f = await fixture('func Read(Value Child) { return Value.seconds(1) }')
    const call = AST.streamAllContents(f.file).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(Type.ofExpression(call).kind).toBe('unresolved')
  })

  Test('keeps ordinary associated methods outside unit-reading dispatch', async () => {
    const parsed = await Parser.parseCode(
      `
      type Span is numeric with {
        units { seconds 1 (default), minutes 60 }
        func Label() -> text { return "span" }
      }
      func Read(Value Span) -> text { return Value.Label() }
    `,
      { validation: false },
    )
    Expect(parsed.diagnostics).toEqual([])
    const call = AST.streamAllContents(parsed.entry.ast).find(AST.isMethodCallExpression)
    Expect.Is(call, AST.isMethodCallExpression)
    Expect(Type.ofExpression(call)).toEqual({ kind: 'primitive', primitive: 'text' })
  })
})
