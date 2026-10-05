import { Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import {
  associatedWitnessExports,
  planAssociatedWitnessBindings,
} from '../compiler-src/codegen/react-native/app/associated-witness-plan'

Describe('compiler: private associated witness bindings', () => {
  Test('reserves authored names and keeps export allocation independent of graph order', async () => {
    const parsed = await Parser.parseCode(`
      let __tao_associated_witness_1__ = "authored"
      type Token is text with { func ToText() -> text { return Token } }
      type Child is Token
    `)
    Expect(parsed.diagnostics).toEqual([])
    const file = parsed.entry.ast
    const owner = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Token')
    Expect.Is(owner, AST.isTypeDeclaration)
    const child = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'Child')
    Expect.Is(child, AST.isTypeDeclaration)
    const exports = associatedWitnessExports(file)
    Expect([...exports.values()]).toEqual(['__tao_associated_witness_1__1'])
    Expect(associatedWitnessExports(file).get(owner)).toBe('__tao_associated_witness_1__1')
    Expect(exports.has(child)).toBe(false)
    const descriptor = Type.associatedMethods(Type.ofDefinition(child))[0]?.descriptor
    Expect(descriptor?.owner === owner).toBe(true)
    const plan = planAssociatedWitnessBindings(file, exports, new Set([owner]), exports)
    Expect(plan.bindings.get(owner)).toBe('__tao_associated_witness_1__1')
    Expect(plan.imports).toEqual([])
  })

  Test('imports distinct same-name owners by declaration identity with collision-free local names', async () => {
    const first = await Parser.parseCode('type Token is text with { func ToText() -> text { return "one" } }', {
      uri: Langium.URI.parse('file:///witness-plan/First.tao'),
    })
    const second = await Parser.parseCode('type Token is text with { func ToText() -> text { return "two" } }', {
      uri: Langium.URI.parse('file:///witness-plan/Second.tao'),
    })
    const caller = await Parser.parseCode(
      'func Shadow(Token text, __tao_associated_import_1__ text) -> text { return Token }',
    )
    const firstOwner = first.entry.ast.statements.find(AST.isTypeDeclaration)
    const secondOwner = second.entry.ast.statements.find(AST.isTypeDeclaration)
    Expect.Is(firstOwner, AST.isTypeDeclaration)
    Expect.Is(secondOwner, AST.isTypeDeclaration)
    const exports = new Map([
      ...associatedWitnessExports(first.entry.ast),
      ...associatedWitnessExports(second.entry.ast),
    ])
    const plan = planAssociatedWitnessBindings(
      caller.entry.ast,
      new Map(),
      new Set([firstOwner, secondOwner]),
      exports,
      ['__tao_associated_import_2__'],
    )
    Expect(plan.imports.map(({ exported, binding }) => [exported, binding])).toEqual([
      ['__tao_associated_witness_1__', '__tao_associated_import_1__1'],
      ['__tao_associated_witness_1__', '__tao_associated_import_2__1'],
    ])
    Expect(plan.bindings.get(firstOwner)).not.toBe(plan.bindings.get(secondOwner))
    Expect(plan.imports[0]?.owner === firstOwner).toBe(true)
    Expect(plan.imports[1]?.owner === secondOwner).toBe(true)
    Expect(plan.imports.map(item => item.sourcePath)).toEqual(['/witness-plan/First.tao', '/witness-plan/Second.tao'])
  })
})
