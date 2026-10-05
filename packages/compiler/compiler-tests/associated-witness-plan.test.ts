import { Type } from '@ast-utils'
import { AST, Langium, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import {
  associatedWitnessExports,
  planAssociatedWitnessBindings,
  referencedAssociatedWitnessOwners,
} from '../compiler-src/codegen/react-native/app/associated-witness-plan'

Describe('compiler: private associated witness bindings', () => {
  Test('publishes actual primitive operators and discovers defining converter owners', async () => {
    const parsed = await Parser.parseCode(`
      primitive number with {
        static func +(Left number, Right number) fails never -> number { return Left }
      }
      type Caption is text
      type Reading is numeric with {
        Reading as Caption fails never { return Caption "reading" }
      }
      func Add(Left number, Right number) -> number { return Left + Right }
      func Label(Reading) -> Caption { return Reading as Caption }
    `, { validation: false })
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const primitive = parsed.entry.ast.statements.find(AST.isPrimitiveDeclaration)
    const reading = parsed.entry.ast.statements.find(node => AST.isTypeDeclaration(node) && node.name === 'Reading')
    Expect.Is(primitive, AST.isPrimitiveDeclaration)
    Expect.Is(reading, AST.isTypeDeclaration)
    const exports = associatedWitnessExports(parsed.entry.ast)
    Expect(exports.has(primitive)).toBe(true)
    Expect(exports.has(reading)).toBe(true)
    const references = referencedAssociatedWitnessOwners(parsed.entry.ast.statements)
    Expect(references.has(primitive)).toBe(true)
    Expect(references.has(reading)).toBe(true)
    const plan = planAssociatedWitnessBindings(parsed.entry.ast, exports, references, exports)
    Expect(plan.imports).toEqual([])
    Expect(plan.bindings.get(primitive)).toBe(exports.get(primitive))
    Expect(plan.bindings.get(reading)).toBe(exports.get(reading))
  })

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
