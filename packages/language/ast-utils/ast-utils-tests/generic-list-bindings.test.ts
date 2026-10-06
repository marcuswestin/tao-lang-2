import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { Type } from '../ast-utils-src/Type'

const declarations = `
  public func Length where type T is text (Values list of T) fails never -> number { return Values.Count }
  type Name is text
  type ComparedNames is list of Name
  let Readers = ComparedNames ["Ada", "Lovelace"]
`

Describe('bounded generic list invocation domains', () => {
  Test('infers the nominal element of a supplied nominal list through an inline parameter role', async () => {
    const parsed = await Parser.parseCode(
      `${declarations}
      func CountReaders() fails never -> number { return Length(Readers) }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const length = file.statements.filter(AST.isFunctionDeclaration).find(fn => fn.name === 'Length')!
    const caller = file.statements.filter(AST.isFunctionDeclaration).find(fn => fn.name === 'CountReaders')!
    const call = AST.returnStatementsOf(caller)[0]!.value
    Expect.Is(call, AST.isFunctionCallExpression)
    const instantiated = Type.instantiateGenericInvocation(length, AST.argumentsOf(call))
    Expect(instantiated.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(instantiated.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(instantiated.pairs[0]?.parameter === length.parameterList.parameters[0]).toBe(true)
    Expect(Type.displayName(instantiated.bindings.get(length.genericParameters[0]!)!)).toBe('Name')
    const parameter = instantiated.parameterTypes.get(length.parameterList.parameters[0]!)!
    Expect(parameter.kind).toBe('list')
    if (parameter.kind !== 'list') {
      return
    }
    Expect(Type.displayName(parameter.element!)).toBe('Name')
    const transport = instantiated.transportTypes.get(length.parameterList.parameters[0]!)!
    Expect(transport.kind).toBe('list')
    if (transport.kind === 'list') {
      Expect(transport.nominal === parameter.nominal).toBe(true)
      Expect(transport.element?.genericParameter === length.genericParameters[0]).toBe(true)
      Expect(Type.displayName(transport.element!.genericReceiver!)).toBe('Name')
    }
    Expect(Type.displayName(instantiated.result)).toBe('number')
    Expect(Type.displayName(Type.ofExpression(call))).toBe('number')
    Expect(Type.displayName(Type.ofExpression(AST.returnStatementsOf(length)[0]!.value))).toBe('number')
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(snapshot.calls.get(call)?.kind).toBe('complete')
    for (const owner of [length]) {
      const publication = projectCallableEffectPublications(snapshot, owner)
      const facts = discoverCallableEffectFacts(owner, publication.inputs, publication.context)
      Expect(analyzeCallableEffects(owner, facts).effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
    }
  })

  Test('forwards a symbolic list element and resolves a recursive declaration call', async () => {
    const parsed = await Parser.parseCode(
      `${declarations}
      func Forward where type U is text (Values list of U) fails never -> number { return Length(Values) }
      func Recursive where type T is text (Values list of T) fails never -> number { return Recursive(Values) }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const file = parsed.entry.ast
    const functions = file.statements.filter(AST.isFunctionDeclaration)
    for (const name of ['Forward', 'Recursive']) {
      const owner = functions.find(fn => fn.name === name)!
      const call = AST.returnStatementsOf(owner)[0]!.value
      Expect.Is(call, AST.isFunctionCallExpression)
      const target = call.function.ref!
      Expect.Is(target, AST.isFunctionDeclaration)
      const instantiated = Type.instantiateGenericInvocation(target, AST.argumentsOf(call))
      Expect(instantiated.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(instantiated.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(instantiated.bindings.get(target.genericParameters[0]!)?.genericParameter === owner.genericParameters[0])
        .toBe(true)
      Expect(Type.displayName(Type.ofExpression(call))).toBe('number')
    }
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const owner of functions.filter(fn => fn.name === 'Forward' || fn.name === 'Recursive')) {
      const call = AST.returnStatementsOf(owner)[0]!.value
      Expect(snapshot.calls.get(call)?.kind).toBe('complete')
      const publication = projectCallableEffectPublications(snapshot, owner)
      const facts = discoverCallableEffectFacts(owner, publication.inputs, publication.context)
      Expect(analyzeCallableEffects(owner, facts).effects.purity).toEqual({ violations: [], open: false })
    }
    const forward = functions.find(fn => fn.name === 'Forward')!
    const publication = projectCallableEffectPublications(snapshot, forward)
    const facts = discoverCallableEffectFacts(forward, publication.inputs, publication.context)
    Expect(analyzeCallableEffects(forward, facts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('rejects an incompatible typed element and excludes a raw contextual list as an inference anchor', async () => {
    const parsed = await Parser.parseCode(
      `${declarations}
      type Counts is list of number
      let Numbers = Counts [1]
      func Wrong() -> number { return Length(Numbers) }
      func Raw() -> number { return Length(["Ada"]) }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors.map(error => error.message)).toEqual([])
    const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
    const length = functions.find(fn => fn.name === 'Length')!
    for (const name of ['Wrong', 'Raw']) {
      const call = AST.returnStatementsOf(functions.find(fn => fn.name === name)!)[0]!.value
      Expect.Is(call, AST.isFunctionCallExpression)
      const instantiated = Type.instantiateGenericInvocation(length, AST.argumentsOf(call))
      Expect(instantiated.bindings.size).toBe(0)
      Expect(instantiated.genericDiagnostics.map(diagnostic => diagnostic.kind)).toEqual(['uninferred-generic'])
      Expect(Type.ofExpression(call).kind).toBe('unresolved')
    }
  })
})
