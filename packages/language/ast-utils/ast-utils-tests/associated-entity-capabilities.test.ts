import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import {
  capabilityRequirements,
  ownAssociatedMethods,
  ownAssociatedViews,
  withAssociatedEffects,
} from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'
import { planCapabilityTransport } from '../ast-utils-src/capability-transport'
import { Type } from '../ast-utils-src/Type'

Describe('Associated entity capability admission', () => {
  Test('admits a real entity function using production sealed facts and retains attachment identities', async () => {
    const file = await parse(`
      can Keyed { Key() fails never -> text }
      data Books / Book { Title text, func Book.Key() fails never -> text { return "book" } }
      data OtherBooks / OtherBook { Title text }
    `)
    const entity = namedEntity(file, 'Books')
    const other = namedEntity(file, 'OtherBooks')
    const capability = namedType(file, 'Keyed')
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(capability)
    Expect(Type.isAssignable(row, expected)).toBe(false)
    const evidence = createAssociatedEffects([file])
    const analysis = evidence.analyses.get(method)
    Assert.defined(analysis, 'the production pipeline analyzes the actual entity function')
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(analysis.effects.failures).toEqual({ cases: [], open: false })
    withAssociatedEffects(evidence, () => {
      Expect(Type.isAssignable(row, expected)).toBe(true)
      Expect(Type.isCallableAssignable(row, expected)).toBe(true)
      Expect(Type.isAssignable(expected, row)).toBe(false)
      Expect(Type.isAssignable(row, Type.ofAssociatedOwner(other))).toBe(false)
      Expect(Type.isAssignable({ kind: 'list', element: row }, expected)).toBe(false)
      const witnesses = Type.capabilityWitnesses(row, expected)
      Assert.defined(witnesses, 'the sealed entity function supplies a concrete capability witness')
      Expect(witnesses).toHaveLength(1)
      Expect(witnesses[0]?.receiver).toBe(row)
      Expect(witnesses[0]?.supplied.owner).toBe(entity)
      Expect(witnesses[0]?.supplied.declaration).toBe(method)
      Expect(witnesses[0]?.required.declaration).toBe(capabilityRequirements(capability)[0])
      const result = planCapabilityTransport(row, expected)
      Assert(
        result.kind === 'ready' && result.plan.kind === 'attach',
        'entity capability transport attaches its witness',
      )
      const transported = result.plan.methods[0]
      Assert.defined(transported, 'the attachment retains the real supplied method')
      Expect(transported.supplied.owner).toBe(entity)
      Expect(transported.supplied.declaration).toBe(method)
      Assert(transported.supplied.receiver.kind === 'entity', 'the transported receiver remains an entity row')
      Expect(transported.supplied.receiver.entity).toBe(entity)
      Expect(Object.isFrozen(transported.supplied)).toBe(true)
    })
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(Type.correspondenceResolver(snapshot.associatedDescriptors).compare(row, expected)).toBe('compatible')
  })

  Test('uses real reordered parameter correspondence and refuses a mismatched result domain', async () => {
    const file = await parse(`
      can Formatter { Format(Count number, Caption text) fails never -> text }
      can WrongResult { Format(Count number, Caption text) fails never -> number }
      data Books / Book {
        Title text,
        func Book.Format(Caption text, Count number) fails never -> text { return "book" }
      }
    `)
    const entity = namedEntity(file, 'Books')
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const capability = namedType(file, 'Formatter')
    const requirement = capabilityRequirements(capability)[0]
    Expect.Is(requirement, AST.isCapabilityMethodDeclaration)
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(capability)
    withAssociatedEffects(createAssociatedEffects([file]), () => {
      const result = planCapabilityTransport(row, expected)
      Assert(result.kind === 'ready' && result.plan.kind === 'attach', 'the matched entity function can be attached')
      const transported = result.plan.methods[0]
      Assert.defined(transported, 'the supplied function has an input transport plan')
      Expect(transported.correspondence).toHaveLength(2)
      Expect(transported.correspondence[0]?.required.declaration).toBe(AST.parametersOf(requirement)[1])
      Expect(transported.correspondence[0]?.supplied.declaration).toBe(AST.parametersOf(method)[0])
      Expect(transported.correspondence[1]?.required.declaration).toBe(AST.parametersOf(requirement)[0])
      Expect(transported.correspondence[1]?.supplied.declaration).toBe(AST.parametersOf(method)[1])
      Expect(transported.inputs.map(input => input.plan.kind)).toEqual(['identity', 'identity'])
      Expect(transported.result.kind).toBe('identity')
      Expect(Type.isAssignable(row, Type.ofDefinition(namedType(file, 'WrongResult')))).toBe(false)
    })
  })

  Test('requires existing sealed analysis and refuses an open failure proof', async () => {
    const file = await parse(`
      can Keyed { Key() fails never -> text }
      data Books / Book { Title text, func Book.Key() fails never -> text { return "book" } }
    `)
    const entity = namedEntity(file, 'Books')
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(namedType(file, 'Keyed'))
    const evidence = createAssociatedEffects([file])
    withAssociatedEffects({ descriptors: evidence.descriptors, analyses: new Map() }, () => {
      Expect(Type.capabilityWitnesses(row, expected)).toBeUndefined()
      Expect(planCapabilityTransport(row, expected)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
    })
    const analysis = evidence.analyses.get(method)
    Assert.defined(analysis, 'the production function analysis exists before the negative evidence probe')
    // Unit boundary: replace only a sealed failure contract to prove that admission refuses open evidence.
    const analyses = new Map(evidence.analyses)
    analyses.set(method, { ...analysis, effects: { ...analysis.effects, failures: { cases: [], open: true } } })
    withAssociatedEffects({ descriptors: evidence.descriptors, analyses }, () => {
      Expect(Type.capabilityWitnesses(row, expected)).toBeUndefined()
      Expect(planCapabilityTransport(row, expected).kind).toBe('unsupported')
    })
  })

  Test('keeps actual entity field reads unknown under existing production read facts', async () => {
    const file = await parse(`
      can Keyed { Key() -> text }
      data Books / Book { Title text, func Book.Key() -> text { return Book.Title } }
    `)
    const entity = namedEntity(file, 'Books')
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    const evidence = createAssociatedEffects([file])
    const analysis = evidence.analyses.get(method)
    Assert.defined(analysis, 'the production pipeline retains the actual field-reading function analysis')
    Expect(analysis.effects.purity.open).toBe(true)
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(namedType(file, 'Keyed'))
    withAssociatedEffects(evidence, () => {
      Expect(Type.capabilityWitnesses(row, expected)).toBeUndefined()
      Expect(planCapabilityTransport(row, expected)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
    })
  })

  Test('refuses collection-qualified functions as row capability implementations', async () => {
    const file = await parse(`
      can Keyed { Key() -> text }
      data Books / Book { Title text, func Books.Key() -> text { return "book" } }
    `)
    const entity = namedEntity(file, 'Books')
    const method = ownAssociatedMethods(entity)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect(Type.associatedCallable(method, entity).kind).toBe('pending')
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(namedType(file, 'Keyed'))
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(Type.correspondenceResolver(snapshot.associatedDescriptors).compare(row, expected)).toBe('incompatible')
    withAssociatedEffects(createAssociatedEffects([file]), () => {
      Expect(Type.capabilityWitnesses(row, expected)).toBeUndefined()
      Expect(planCapabilityTransport(row, expected)).toEqual({ kind: 'unsupported', reason: 'incompatible-types' })
    })
  })

  Test('retains mounted entity descriptors without inventing creator purity', async () => {
    const file = await parse(`
      can ui { Render() fails never -> rendered }
      data Books / Book { Title text, view Book.Render() { } }
    `)
    const entity = namedEntity(file, 'Books')
    const view = ownAssociatedViews(entity)[0]
    Expect.Is(view, AST.isAssociatedViewDeclaration)
    const descriptor = Type.associatedCallable(view, entity)
    Assert(descriptor.kind === 'ready', 'the real mounted view has a declared descriptor')
    const row = Type.ofAssociatedOwner(entity)
    const expected = Type.ofDefinition(namedType(file, 'ui'))
    const evidence = createAssociatedEffects([file])
    const descriptors = new Map(evidence.descriptors)
    descriptors.set(view, descriptor.descriptor)
    withAssociatedEffects({ descriptors, analyses: evidence.analyses }, () => {
      Expect(Type.capabilityWitnesses(row, expected)).toBeUndefined()
      Expect(planCapabilityTransport(row, expected)).toEqual({ kind: 'unknown', reason: 'missing-proof' })
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

function namedEntity(file: AST.TaoFile, name: string): AST.EntityDataDeclaration {
  const declaration = file.statements.find(statement =>
    AST.isEntityDataDeclaration(statement) && statement.name === name
  )
  Expect.Is(declaration, AST.isEntityDataDeclaration)
  return declaration
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}
