import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  associatedCallableWitnessKey,
  type AssociatedCallableWitnessKeyContext,
  type AssociatedOperatorWitnessDeclaration,
} from '../ast-utils-src/associated-callable-witness-key'

Describe('Associated callable witness keys', () => {
  Test('retains ordinary names without consulting operator allocation', async () => {
    const declarations = await parse(`
      can Display { Format() -> text }
      type Token is text with { func Format() -> text { return "token" } }
    `)
    const ordinary = declarations.filter(declaration => declaration.name === 'Format')
    Expect(ordinary).toHaveLength(2)
    const context: AssociatedCallableWitnessKeyContext = {
      operatorKey: () => {
        Assert(false, 'ordinary names do not allocate operator keys')
        return undefined
      },
    }
    ordinary.forEach(declaration => {
      Expect(associatedCallableWitnessKey(declaration)).toBe('Format')
      Expect(associatedCallableWitnessKey({ declaration }, context)).toBe('Format')
    })
  })

  Test('refuses operator name fallback when allocation proof is absent', async () => {
    const declarations = await parse('can Addition { +(Other Self) -> Self }')
    const declaration = declarations[0]!
    Expect(associatedCallableWitnessKey(declaration)).toBeUndefined()
    Expect(associatedCallableWitnessKey({ declaration }, { operatorKey: () => undefined })).toBeUndefined()
  })

  Test('uses actual defining declarations across descriptor wrappers and independent contexts', async () => {
    const declarations = await parse(`
      type Amount is number
      type Count is number
      can Arithmetic {
        +() -> Self
        +(Other Amount) -> Amount
        +(Other Count) -> Count
      }
      type Number is number with { static func +(Left Number, Other Number) -> Number { return Left } }
    `)
    Expect(declarations).toHaveLength(4)
    // These fixture keys stand for deterministic module planning, not allocation in this helper.
    const planned = new Map<AssociatedOperatorWitnessDeclaration, string>([
      [declarations[0]!, '_TaoOperatorUnary'],
      [declarations[1]!, '_TaoOperatorAmount'],
      [declarations[2]!, '_TaoOperatorCount'],
      [declarations[3]!, '_TaoOperatorImplementation'],
    ])
    const context: AssociatedCallableWitnessKeyContext = { operatorKey: declaration => planned.get(declaration) }
    const keys = declarations.map(declaration => associatedCallableWitnessKey(declaration, context))
    Expect(new Set(keys).size).toBe(4)
    declarations.forEach((declaration, index) => {
      const defining = Object.freeze({ declaration })
      const specialized = Object.freeze({ ...defining })
      Expect(associatedCallableWitnessKey(defining, context)).toBe(keys[index])
      Expect(associatedCallableWitnessKey(specialized, context)).toBe(keys[index])
      Expect(associatedCallableWitnessKey(specialized, { operatorKey: node => planned.get(node) })).toBe(keys[index])
      Expect(associatedCallableWitnessKey(specialized, { operatorKey: () => undefined })).toBeUndefined()
    })
  })
})

async function parse(source: string): Promise<AssociatedOperatorWitnessDeclaration[]> {
  const result = await Parser.parseCode(source, { validation: false })
  Expect(result.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(result.entry.document.parseResult.parserErrors).toEqual([])
  Expect(result.diagnostics).toEqual([])
  const declarations = AST.streamAllContents(result.entry.ast).filter((node): node is AssociatedOperatorWitnessDeclaration =>
    AST.isAssociatedFunctionDeclaration(node) || AST.isCapabilityMethodDeclaration(node)
  )
  Assert(declarations.length > 0, 'parsed fixture has actual callable declarations')
  return declarations
}
