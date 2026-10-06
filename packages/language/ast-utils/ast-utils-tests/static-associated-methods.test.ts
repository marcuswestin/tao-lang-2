import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import { Type } from '../ast-utils-src/Type'

Describe('Static associated method selection', () => {
  Test('selects actual type roots, preserves inherited results and lets values hide types', async () => {
    const parsed = await Parser.parseCode(
      `
      type Title is text with {
        static func Default() -> Title { return Title "fallback" }
        static func Inferred() { return Title "inferred" }
        func ToText() -> text { return Title }
      }
      type Child is Title
      func DefaultTitle() -> Title { return Title.Default() }
      func Inherited() -> Title { return Child.Default() }
      func Inferred() -> Title { return Child.Inferred() }
      func Instance(Value Child) -> text { return Value.ToText() }
      func WrongType() -> text { return Title.ToText() }
      func WrongValue(Value Title) -> Title { return Value.Default() }
      func Shadow(Title Title) -> Title { return Title.Default() }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const title = file.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Title')
    Expect.Is(title, AST.isTypeDeclaration)
    const resolve = (name: string) => {
      const fn = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === name)
      Expect.Is(fn, AST.isFunctionDeclaration)
      const call = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(call, AST.isMethodCallExpression)
      return resolveAssociatedMethodInvocation(call)
    }
    for (const name of ['DefaultTitle', 'Inherited', 'Inferred']) {
      const resolved = resolve(name)
      Expect(resolved.problem).toBeUndefined()
      Expect(resolved.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(resolved.descriptor?.owner === title).toBe(true)
      Expect(
        resolved.descriptor && AST.isAssociatedFunctionDeclaration(resolved.descriptor.declaration)
          && resolved.descriptor.declaration.static,
      ).toBe(true)
      Expect(resolved.descriptor && Type.displayName(resolved.descriptor.result)).toBe('Title')
    }
    const instance = resolve('Instance')
    Expect(instance.problem).toBeUndefined()
    Expect(instance.receiver && Type.displayName(instance.receiver)).toBe('Child')
    Expect(instance.descriptor?.owner === title).toBe(true)
    for (const name of ['WrongType', 'WrongValue', 'Shadow']) {
      Expect(resolve(name).problem).toBe('unknown-method')
    }
    const shadow = file.statements.find(node => AST.isFunctionDeclaration(node) && node.name === 'Shadow')
    Expect.Is(shadow, AST.isFunctionDeclaration)
    const call = AST.returnStatementsOf(shadow)[0]!.value
    Expect.Is(call, AST.isMethodCallExpression)
    Expect.Is(call.callee, AST.isMemberAccessExpression)
    Expect(call.callee.target.ref === AST.parametersOf(shadow)[0]).toBe(true)
  })
})
