import { AST, Parser } from '@parser'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import {
  type AssociatedCallableDescriptor,
  capabilityRequirements,
  ownAssociatedMethods,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { Type } from '../ast-utils-src/Type'

Describe('Associated method invocation resolution', () => {
  Test('binds real parameters and retains the inherited defining owner and actual receiver', async () => {
    const file = await parse(`
      type Token is text with {
        func Format(Prefix text, Count number) fails never -> text { return Prefix }
      }
      type Child is Token
      func Show(Value Child) -> text { return Value.Format(2, "prefix") }
    `)
    const token = namedType(file, 'Token')
    const child = namedType(file, 'Child')
    const show = namedFunction(file, 'Show')
    const call = returnedCall(show)
    Expect.Is(call.callee, AST.isMemberAccessExpression)
    Expect(call.callee.target.ref).toBe(AST.parametersOf(show)[0])
    const method = ownAssociatedMethods(token)[0]!
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(resolved.invocation).toBe(call)
    Expect(resolved.problem).toBeUndefined()
    Expect(resolved.descriptor?.declaration).toBe(method)
    Expect(resolved.descriptor?.owner).toBe(token)
    Expect(resolved.receiver && Type.displayName(resolved.receiver)).toBe('Child')
    Expect(resolved.receiver && Type.identityKey(resolved.receiver)).toBe(Type.identityKey(Type.ofDefinition(child)))
    Expect(resolved.descriptor && Type.displayName(resolved.descriptor.receiver)).toBe('Token')
    Expect(resolved.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Prefix', 'Count'])
    Expect(resolved.pairs[0]!.parameter).toBe(AST.parametersOf(method)[0])
    Expect(resolved.pairs[0]!.argument).toBe(AST.argumentsOf(call)[1])
    Expect(resolved.pairs[1]!.parameter).toBe(AST.parametersOf(method)[1])
    Expect(resolved.pairs[1]!.argument).toBe(AST.argumentsOf(call)[0])
    Expect(resolved.diagnostics).toEqual([])
  })

  Test('uses only the real contextual receiver and lets a lexical parameter shadow its spelling', async () => {
    const file = await parse(
      `
      type Token is text with {
        func Format() fails never -> text { return "token" }
        func Echo() fails never -> text { return Token.Format() }
      }
      type Label is text with { func Format() fails never -> text { return "label" } }
      func Shadow(Token Label) -> text { return Token.Format() }
      func Global() -> text { return Token.Format() }
    `,
      false,
    )
    const token = namedType(file, 'Token')
    const label = namedType(file, 'Label')
    const echo = ownAssociatedMethods(token).find(method => method.name === 'Echo')
    Assert.defined(echo, 'the contextual invocation fixture has its real method')
    const contextual = returnedCall(echo)
    Expect.Is(contextual.callee, AST.isMemberAccessExpression)
    Expect(contextual.callee.target.ref).toBe(token)
    Expect(AST.associatedReceiverOwner(contextual.callee)).toBe(token)
    Expect(resolveAssociatedMethodInvocation(contextual).descriptor?.owner).toBe(token)
    const shadow = namedFunction(file, 'Shadow')
    const shadowed = returnedCall(shadow)
    Expect.Is(shadowed.callee, AST.isMemberAccessExpression)
    Expect(shadowed.callee.target.ref).toBe(AST.parametersOf(shadow)[0])
    Expect(resolveAssociatedMethodInvocation(shadowed).descriptor?.owner).toBe(label)
    const global = resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Global')))
    Expect(global.problem).toBe('unknown-method')
    Expect(global.descriptor).toBeUndefined()
    Expect(global.pairs).toEqual([])
  })

  Test('resolves returned-value chains and nested member paths from their actual roots', async () => {
    const file = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build() -> Token { return Token "value" }
      func Chain() -> text { return Build().Again().Format() }
      func Nested(Value { Inner Token }) -> text { return Value.Inner.Format() }
    `)
    const token = namedType(file, 'Token')
    const chain = returnedCall(namedFunction(file, 'Chain'))
    Expect.Is(chain.callee, AST.isPostfixMemberAccess)
    Expect.Is(chain.callee.receiver, AST.isMethodCallExpression)
    const again = chain.callee.receiver
    Expect.Is(again.callee, AST.isPostfixMemberAccess)
    Expect.Is(again.callee.receiver, AST.isFunctionCallExpression)
    Expect(again.callee.receiver.function.ref).toBe(namedFunction(file, 'Build'))
    Expect(resolveAssociatedMethodInvocation(again).descriptor?.declaration.name).toBe('Again')
    const resolvedChain = resolveAssociatedMethodInvocation(chain)
    Expect(resolvedChain.descriptor?.owner).toBe(token)
    Expect(resolvedChain.descriptor?.declaration.name).toBe('Format')
    Expect(resolvedChain.problem).toBeUndefined()
    const nested = namedFunction(file, 'Nested')
    const memberCall = returnedCall(nested)
    Expect.Is(memberCall.callee, AST.isMemberAccessExpression)
    Expect(memberCall.callee.target.ref).toBe(AST.parametersOf(nested)[0])
    Expect(memberCall.callee.members).toEqual(['Inner', 'Format'])
    const resolvedMember = resolveAssociatedMethodInvocation(memberCall)
    Expect(resolvedMember.descriptor?.owner).toBe(token)
    Expect(resolvedMember.problem).toBeUndefined()
    Expect(resolvedMember.diagnostics).toEqual([])
  })

  Test('selects a capability requirement through a returned capability and preserves pending contracts', async () => {
    const file = await parse(`
      can Display { Format(Count number) fails never -> text }
      func Relay(Value Display) -> Display { return Value }
      func Show(Value Display) -> text { return Relay(Value).Format(3) }
      func Unknown(Value Display) -> text { return Value.Missing() }
    `)
    const display = namedType(file, 'Display')
    const requirement = capabilityRequirements(display)[0]!
    const call = returnedCall(namedFunction(file, 'Show'))
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(resolved.receiver?.kind).toBe('capability')
    Expect(resolved.descriptor?.owner).toBe(display)
    Expect(resolved.descriptor?.declaration).toBe(requirement)
    Expect(resolved.pairs[0]!.parameter).toBe(AST.parametersOf(requirement)[0])
    Expect(resolved.pairs[0]!.argument).toBe(AST.argumentsOf(call)[0])
    Expect(resolved.diagnostics).toEqual([])
    withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => {
      Expect(resolveAssociatedMethodInvocation(call).problem).toBe('pending-contract')
      Expect(resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Unknown'))).problem).toBe(
        'unknown-method',
      )
    })
  })

  Test('shares default, missing, named-type and unknown-name diagnostics with ordinary argument binding', async () => {
    const file = await parse(`
      type Word is text
      type Token is text with {
        func Format(Count number, Caption text default "default", Entry Word) -> text { return Caption }
      }
      func Omitted(Value Token) -> text { return Value.Format(Count: 2, Entry: "raw") }
      func Missing(Value Token) -> text { return Value.Format(Entry: "raw") }
      func Wrong(Value Token) -> text { return Value.Format(Count: "wrong", Entry: "raw") }
      func Unknown(Value Token) -> text { return Value.Format(Count: 2, Entry: "raw", Unknown: true) }
    `)
    const method = ownAssociatedMethods(namedType(file, 'Token'))[0]!
    const omitted = resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Omitted')))
    Expect(omitted.diagnostics).toEqual([])
    Expect(omitted.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Count', 'Entry'])
    Expect(omitted.pairs[0]?.parameter === AST.parametersOf(method)[0]).toBe(true)
    Expect(omitted.pairs[1]?.parameter === AST.parametersOf(method)[2]).toBe(true)
    const missing = resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Missing')))
    Expect(missing.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['missing-argument'])
    const missingDiagnostic = missing.diagnostics[0]!
    Expect(missingDiagnostic.kind === 'missing-argument' && missingDiagnostic.parameter).toBe(
      AST.parametersOf(method)[0],
    )
    const wrongCall = returnedCall(namedFunction(file, 'Wrong'))
    const wrong = resolveAssociatedMethodInvocation(wrongCall)
    Expect(wrong.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['named-argument-type'])
    const wrongDiagnostic = wrong.diagnostics[0]!
    Expect(wrongDiagnostic.kind === 'named-argument-type' && wrongDiagnostic.argument).toBe(
      AST.argumentsOf(wrongCall)[0],
    )
    Expect(wrongDiagnostic.kind === 'named-argument-type' && wrongDiagnostic.parameter).toBe(
      AST.parametersOf(method)[0],
    )
    const unknown = resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Unknown')))
    Expect(unknown.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unknown-named-argument'])
  })

  Test('binds sealed signature domains and omissions by real parameter identity', async () => {
    const file = await parse(`
      type Token is text with { func Format(Count number) -> text { return "token" } }
      func Changed(Value Token) -> text { return Value.Format(Count: true) }
      func Omitted(Value Token) -> text { return Value.Format() }
    `)
    const owner = namedType(file, 'Token')
    const method = ownAssociatedMethods(owner)[0]!
    const materialized = Type.associatedCallable(method, owner)
    Assert(materialized.kind === 'ready', 'the signature invocation fixture has a resolved contract')
    const descriptor: AssociatedCallableDescriptor = {
      ...materialized.descriptor,
      result: { kind: 'primitive', primitive: 'boolean' },
      signature: {
        ...materialized.descriptor.signature,
        inputs: materialized.descriptor.signature.inputs.map(input => ({
          ...input,
          type: { kind: 'primitive', primitive: 'boolean' },
          omissible: true,
        })),
      },
    }
    const changed = returnedCall(namedFunction(file, 'Changed'))
    Expect(resolveAssociatedMethodInvocation(changed).diagnostics.map(diagnostic => diagnostic.kind))
      .toEqual(['named-argument-type'])
    withAssociatedEffects({ descriptors: new Map([[method, descriptor]]), analyses: new Map() }, () => {
      const resolved = resolveAssociatedMethodInvocation(changed)
      Expect(resolved.descriptor).toBe(descriptor)
      Expect(Type.ofExpression(changed) === descriptor.result).toBe(true)
      Expect(resolved.diagnostics).toEqual([])
      Expect(resolved.pairs[0]!.parameter).toBe(AST.parametersOf(method)[0])
      Expect(resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Omitted'))).diagnostics).toEqual([])
    })
    withAssociatedEffects({ descriptors: new Map(), analyses: new Map() }, () => {
      Expect(Type.ofExpression(changed).kind).toBe('unresolved')
      Expect(resolveAssociatedMethodInvocation(changed).problem).toBe('pending-contract')
    })
    const incomplete: AssociatedCallableDescriptor = {
      ...descriptor,
      signature: { ...descriptor.signature, inputs: [] },
    }
    withAssociatedEffects({ descriptors: new Map([[method, incomplete]]), analyses: new Map() }, () => {
      Expect(() => resolveAssociatedMethodInvocation(changed)).toThrow(Errors.UnexpectedBehaviorError)
    })
  })

  Test('does not fall back past the nearest pending declaration to a ready inherited method', async () => {
    const file = await parse(`
      type Base is text with { func Format() -> text { return "base" } }
      type Child is Base with { func Format() { return Child.Format() } }
      func Read(Value Child) -> text { return Value.Format() }
      func Unknown(Value Child) -> text { return Value.Missing() }
    `)
    const base = namedType(file, 'Base')
    const child = namedType(file, 'Child')
    const inherited = ownAssociatedMethods(base)[0]!
    const nearest = ownAssociatedMethods(child)[0]!
    const contract = Type.associatedCallable(inherited, base)
    Assert(contract.kind === 'ready', 'the pending invocation fixture has a resolved inherited contract')
    const call = returnedCall(namedFunction(file, 'Read'))
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(Type.associatedMethodDeclaration(Type.ofDefinition(child), 'Format')?.declaration).toBe(nearest)
    Expect(resolved.problem).toBe('pending-contract')
    Expect(resolved.descriptor).toBeUndefined()
    withAssociatedEffects({ descriptors: new Map([[inherited, contract.descriptor]]), analyses: new Map() }, () => {
      Expect(resolveAssociatedMethodInvocation(call).problem).toBe('pending-contract')
      Expect(resolveAssociatedMethodInvocation(call).descriptor).toBeUndefined()
      Expect(resolveAssociatedMethodInvocation(returnedCall(namedFunction(file, 'Unknown'))).problem).toBe(
        'unknown-method',
      )
    })
  })

  Test('reports a real numeric-shade callee as unsupported before resolving its receiver', async () => {
    const file = await parse('func Shade(Value color) -> text { return Value.20() }')
    const call = returnedCall(namedFunction(file, 'Shade'))
    Expect.Is(call.callee, AST.isMemberAccessExpression)
    Expect(call.callee.shade).toBe(20)
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(resolved.invocation).toBe(call)
    Expect(resolved.problem).toBe('unsupported-callee')
    Expect(resolved.receiver).toBeUndefined()
    Expect(resolved.descriptor).toBeUndefined()
    Expect(resolved.pairs).toEqual([])
    Expect(resolved.diagnostics).toEqual([])
  })
})

async function parse(source: string, cleanLinks = true): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  if (cleanLinks) {
    Expect(parsed.diagnostics).toEqual([])
  }
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}

function returnedCall(
  declaration: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
): AST.MethodCallExpression {
  const expression = AST.returnStatementsOf(declaration)[0]?.value
  Expect.Is(expression, AST.isMethodCallExpression)
  return expression
}
