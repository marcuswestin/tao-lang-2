import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { resolveAssociatedConversion } from '../ast-utils-src/associated-converters'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Explicit associated conversion selection', () => {
  Test('selects the nearest declared source ancestor and retains the actual conversion body', async () => {
    const parsed = await Parser.parseCode(`
      type Base is text with {
        Base as Target fails never { return Target "base" }
      }
      type Child is Base with {
        Child as Target fails Invalid { return Target "child" }
      }
      type Grandchild is Child
      type Target is text
      func Convert(Value Grandchild) { return Value as Target }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const fn = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(fn, AST.isFunctionDeclaration)
    const expression = AST.returnStatementsOf(fn)[0]!.value
    Expect.Is(expression, AST.isConversionExpression)
    const resolved = resolveAssociatedConversion(expression)
    Expect(resolved.problem).toBeUndefined()
    Expect(resolved.descriptor?.owner.name).toBe('Child')
    Expect(resolved.descriptor?.signature.inputs).toEqual([])
    Expect(resolved.descriptor?.signature.failures).toEqual({ cases: ['Invalid'], open: false })
    const owner = resolved.descriptor!.owner
    Expect.Is(owner.type, AST.isDerivedTypeExpression)
    Expect(resolved.descriptor!.declaration === owner.type.slots.converters[0]).toBe(true)
    const snapshot = publishCanonicalEffectSnapshot([parsed.entry.ast])
    const callable = snapshot.descriptors.get(resolved.descriptor!.declaration)!
    Expect(callable.body === resolved.descriptor!.declaration.block).toBe(true)
    Expect(callable.parameters).toEqual([])
    const call = snapshot.calls.get(expression)!
    Expect(call.kind).toBe('complete')
    Expect(call.target === resolved.descriptor!.declaration).toBe(true)
    Expect(call.receiver?.kind === 'expression' && call.receiver.expression === expression.value).toBe(true)
    Expect(call.pairs).toEqual([])
    Expect(call.defaults).toEqual([])
  })

  Test('rejects equally applicable attached converters without chaining', async () => {
    const parsed = await Parser.parseCode(`
      type Source is text with { Source as Target { return Target "source" } }
      type Target is text with { Source as Target { return Target "target" } }
      type Final is text with { Target as Final { return Final "final" } }
      func Ambiguous(Value Source) { return Value as Target }
      func Missing(Value Source) { return Value as Final }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const functions = parsed.entry.ast.statements.filter(AST.isFunctionDeclaration)
    const conversion = (name: string) => {
      const fn = functions.find(candidate => candidate.name === name)!
      const expression = AST.returnStatementsOf(fn)[0]!.value
      Expect.Is(expression, AST.isConversionExpression)
      return resolveAssociatedConversion(expression)
    }
    Expect(conversion('Ambiguous').problem).toBe('ambiguous-converter')
    Expect(conversion('Ambiguous').candidates).toHaveLength(2)
    Expect(conversion('Missing').problem).toBe('missing-converter')
  })
})
