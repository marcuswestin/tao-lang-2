import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { resolveAssociatedMethodInvocation } from '../ast-utils-src/associated-invocations'
import {
  type AssociatedCallableDeclaration,
  type AssociatedCallableDescriptor,
  capabilityRequirements,
  ownAssociatedMethods,
  ownAssociatedViews,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { callableSignatureOf } from '../ast-utils-src/callable-signatures'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { Type } from '../ast-utils-src/Type'

Describe('Associated view descriptors', () => {
  Test('production inventory retains actual entity mounted declarations and owners', async () => {
    const file = await parse(`
      data Books / Book { Title text, view Book.Render() { render Book.Title } }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Assert(entity, 'actual entity owner exists')
    const view = ownAssociatedViews(entity)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    const context = createAssociatedEffects([file])
    Expect(context.descriptors.get(view)?.declaration).toBe(view)
    Expect(context.descriptors.get(view)?.owner).toBe(entity)
  })
  Test('selects the real mounted view and binds optional parameters by declaration identity', async () => {
    const file = await parse(`
      view Text(Value text) { }
      type Card is text with {
        view Card.Render(Caption text default "fallback") { render Text(Caption) }
      }
      type Child is Card
      func Show(Value Child) -> rendered { return Value.Render(Caption: "title") }
    `)
    const owner = namedType(file, 'Card')
    const view = ownAssociatedViews(owner)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    const parameter = AST.parametersOf(view)[0]
    Expect.Is(parameter, AST.isParameterDeclaration)
    const call = returnedCall(file, 'Show')
    const resolved = resolveAssociatedMethodInvocation(call)
    Expect(ownAssociatedMethods(owner)).toEqual([])
    Expect(Type.ownAssociatedViews(owner)[0]).toBe(view)
    Expect(resolved.problem).toBeUndefined()
    Expect(resolved.descriptor?.declaration).toBe(view)
    Expect(resolved.descriptor?.owner).toBe(owner)
    Expect(resolved.descriptor?.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    Expect(resolved.descriptor?.signature.inputs[0]?.omissible).toBe(true)
    Expect(callableSignatureOf(view).inputs[0]?.declaration).toBe(parameter)
    Expect(resolved.pairs[0]?.parameter).toBe(parameter)
    Expect(resolved.pairs[0]?.argument).toBe(AST.argumentsOf(call)[0])
    Expect(resolved.diagnostics).toEqual([])
    Expect(Type.ofExpression(call)).toEqual({ kind: 'primitive', primitive: 'rendered' })

    const snapshot = publishCanonicalEffectSnapshot([file])
    const descriptor = snapshot.descriptors.get(view)
    Assert.defined(descriptor, 'the mounted view has a canonical descriptor')
    const materialized = snapshot.associatedDescriptors.get(view)
    Assert(materialized?.kind === 'ready', 'the real mounted descriptor materializes')
    Expect(materialized.descriptor.declaration).toBe(view)
    Expect(descriptor.declaration).toBe(view)
    Expect(descriptor.owner).toBe(owner)
    Expect(descriptor.body).toBe(view.block)
    Expect(descriptor.parameters[0]).toBe(parameter)
    Expect(descriptor.signature?.inputs[0]?.declaration).toBe(parameter)
    Expect(descriptor.result).toEqual({ kind: 'primitive', primitive: 'rendered' })
    Expect(descriptor.convention).toBe('mounted')
    Expect(descriptor.contract).toBeUndefined()
    Expect(descriptor.pending).toEqual([])
    Expect(snapshot.calls.get(call)?.target).toBe(view)
    Expect(snapshot.calls.get(call)?.descriptor).toBe(descriptor)
    Expect(snapshot.calls.get(call)?.pairs[0]?.parameter).toBe(parameter)
    Expect(Object.isFrozen(descriptor)).toBe(true)
    Expect(Object.isFrozen(descriptor.parameters)).toBe(true)
    Expect(Object.isFrozen(descriptor.signature?.inputs)).toBe(true)
  })

  Test('supports no parameter list and excludes views from static lookup', async () => {
    const file = await parse(`
      type Card is text with { view Card.Render { } }
      func Show(Value Card) -> rendered { return Value.Render() }
      func Static() -> rendered { return Card.Render() }
    `)
    const owner = namedType(file, 'Card')
    const view = ownAssociatedViews(owner)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect(view.parameterList).toBeUndefined()
    const resolved = resolveAssociatedMethodInvocation(returnedCall(file, 'Show'))
    Expect(resolved.descriptor?.declaration).toBe(view)
    Expect(resolved.pairs).toEqual([])
    Expect(resolved.diagnostics).toEqual([])
    Expect(Type.associatedMethodDeclaration(Type.ofDefinition(owner), 'Render', undefined, 'static')).toBeUndefined()
    Expect(resolveAssociatedMethodInvocation(returnedCall(file, 'Static')).problem).toBe('unknown-method')
  })

  Test('does not turn descriptor materialization into structural creator purity proof', async () => {
    const file = await parse(`
      can ui { Render() fails never -> rendered }
      type Card is text with { view Card.Render { } }
    `)
    const owner = namedType(file, 'Card')
    const requirementOwner = namedType(file, 'ui')
    const view = ownAssociatedViews(owner)[0]
    const requirement = capabilityRequirements(requirementOwner)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    Expect.Is(requirement, AST.isCapabilityMethodDeclaration)
    const supplied = Type.associatedCallable(view, owner)
    const required = Type.associatedCallable(requirement, requirementOwner)
    Assert(supplied.kind === 'ready' && required.kind === 'ready', 'the declared contracts resolve')
    const descriptors = new Map<AssociatedCallableDeclaration, AssociatedCallableDescriptor>([
      [view, supplied.descriptor],
      [requirement, required.descriptor],
    ])
    withAssociatedEffects({
      descriptors,
      analyses: new Map(),
    }, () => {
      Expect(Type.capabilityWitnesses(Type.ofDefinition(owner), Type.ofDefinition(requirementOwner))).toBeUndefined()
    })
  })
})

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function returnedCall(file: AST.TaoFile, name: string): AST.MethodCallExpression {
  const declaration = file.statements.find(statement => AST.isFunctionDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  const expression = AST.returnStatementsOf(declaration)[0]?.value
  Expect.Is(expression, AST.isMethodCallExpression)
  return expression
}
