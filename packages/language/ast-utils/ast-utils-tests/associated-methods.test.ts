import { ASTUtils, Type } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

Describe('Associated callable contract materialization', () => {
  Test('retains distinct nominal receivers and the actual inherited implementation owner', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with {
        func ToText() -> text { return "token:{Token}" }
      }
      type Label is text with {
        func ToText() -> text { return "label:{Label}" }
      }
      type Child is Token
      can Display { ToText() -> text }
      func Relay(Value Display) -> Display { return Value }
      func Show(Value Display) -> text { return Relay(Value).ToText() }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const declarations = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
    const declaration = (name: string) => {
      const found = declarations.find(candidate => candidate.name === name)
      Expect.Is(found, AST.isTypeDeclaration)
      return found
    }
    const Token = declaration('Token')
    const Label = declaration('Label')
    const Child = declaration('Child')
    const Display = declaration('Display')
    const token = Type.ofDefinition(Token)
    const label = Type.ofDefinition(Label)
    const child = Type.ofDefinition(Child)
    const display = Type.ofDefinition(Display)
    Expect(Type.isAssignable(child, token)).toBe(true)
    Expect(Type.isAssignable(token, child)).toBe(false)
    Expect(Type.isAssignable(label, token)).toBe(false)
    Expect(Type.identityKey(child) === Type.identityKey(token)).toBe(false)
    const methods = Type.associatedMethods(child)
    Expect(methods).toHaveLength(1)
    const selected = methods[0]!
    Expect(selected.receiver === child).toBe(true)
    Expect(selected.descriptor.owner === Token).toBe(true)
    Expect(selected.descriptor.declaration === ASTUtils.ownAssociatedMethods(Token)[0]).toBe(true)
    Expect(Type.displayName(selected.descriptor.receiver)).toBe('Token')
    Expect(Type.displayName(selected.descriptor.result)).toBe('text')
    Expect(selected.descriptor.signature.inputs).toEqual([])
    Expect(selected.descriptor.signature.failures).toEqual({ cases: [], open: true })
    Expect(Object.isFrozen(selected.descriptor)).toBe(true)
    Expect(display.kind).toBe('capability')
    Assert(display.kind === 'capability', 'Expected the declared structural capability.')
    const requirements = Type.capabilityMethods(display)
    Expect(requirements).toHaveLength(1)
    Expect(requirements[0]!.kind).toBe('ready')
    const show = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration).find(fn => fn.name === 'Show')
    Expect.Is(show, AST.isFunctionDeclaration)
    const call = AST.returnStatementsOf(show)[0]!.value
    Expect.Is(call, AST.isMethodCallExpression)
    const target = ASTUtils.associatedMethodCallTarget(call)
    Expect(target?.name).toBe('ToText')
    Expect(target?.receiver.kind).toBe('expression')
    Expect(Type.displayName(Type.ofExpression(call))).toBe('text')
  })

  Test('does not publish an inferred recursive method as a resolved contract', async () => {
    const parsed = await Parser.parseCode(`
      type Token is text with {
        func ToText() { return Token.ToText() }
      }
    `)
    const owner = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const method = ASTUtils.ownAssociatedMethods(owner)[0]!
    const contract = Type.associatedCallable(method, owner)
    Expect(contract.kind).toBe('pending')
    if (contract.kind === 'pending') {
      Expect(contract.dependencies).toHaveLength(1)
      Expect(contract.dependencies[0] === method).toBe(true)
    }
  })
})
