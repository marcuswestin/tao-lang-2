import { Packages, Type } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Assert, FS, Switch } from '@shared'
import { Describe, Expect, Test, type TestOverrideSlot, testOverrideSlot, withTaoFiles } from '@shared/test'
import { type TaoType } from '../ast-utils-src/Type'

Describe('batch type inference', () => {
  Test('reuses all public query kinds while preserving nominal, alias, function, and nullable results', async () => {
    const parsed = await Parser.parseCode(`
      type Name is text
      let Original = Name "Ada"
      let Alias = Original
      function Echo(Value Name?) { return Value }
      let Result = Echo(Alias)
    `)
    Expect(parsed.diagnostics).toEqual([])
    const name = parsed.entry.ast.statements.find(AST.isTypeDeclaration)
    const aliases = parsed.entry.ast.statements.filter(AST.isAliasDeclaration)
    const echo = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(name, AST.isTypeDeclaration)
    Expect.Is(name.type, AST.isPrimitiveTypeReference)
    Expect.Is(echo, AST.isFunctionDeclaration)
    const parameter = AST.parametersOf(echo)[0]!
    const parameterType = parameter.inlineType?.type ?? parameter.type
    Expect.Is(parameterType, AST.isNamedTypeReference)
    const alias = aliases[1]!
    Expect.Is(alias.value, AST.isValueReference)
    const expression = alias.value
    const queries: Array<{ query: () => TaoType; node: object; property: string }> = [
      { query: () => Type.ofReference(parameterType), node: parameterType, property: 'root' },
      { query: () => Type.ofTypeExpression(name.type!), node: name.type, property: 'primitive' },
      { query: () => Type.ofDefinition(name), node: name, property: 'type' },
      { query: () => Type.ofParameter(parameter), node: parameter, property: 'inlineType' },
      { query: () => Type.ofExpression(expression), node: expression, property: 'target' },
      { query: () => Type.ofValueDeclaration(alias), node: alias, property: 'value' },
      { query: () => Type.ofFunctionReturn(echo), node: echo, property: 'block' },
    ]
    for (const { query, node, property } of queries) {
      const cold = query()
      const witness = witnessReads(node, property)
      try {
        const memo = Type.createInferenceMemo()
        Type.withInferenceMemo(memo, () => {
          const first = query()
          const reads = witness.reads()
          Expect(reads).toBeGreaterThan(0)
          const second = query()
          Expect(witness.reads()).toBe(reads)
          expectSameInference(first, cold)
          expectSameInference(second, cold)
          Expect(second === first).toBe(false)
        })
        const reads = witness.reads()
        expectSameInference(query(), cold)
        Expect(witness.reads()).toBeGreaterThan(reads)
      } finally {
        witness.restore()
      }
    }
    Expect(Type.displayName(Type.ofValueDeclaration(alias))).toBe('Name')
    Expect(Type.displayName(Type.ofFunctionReturn(echo))).toBe('Name | none')
  })

  Test('keeps cyclic resolutions independent of query order and leaves unresolved queries cold', async () => {
    const parsed = await Parser.parseCode(
      `
      type First is Second
      type Second is First
      let Left = Right
      let Right = Left
      function Loop() { return Loop() }
    `,
      { validation: false },
    )
    Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
    const definitions = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
    const aliases = parsed.entry.ast.statements.filter(AST.isAliasDeclaration)
    const loop = parsed.entry.ast.statements.find(AST.isFunctionDeclaration)
    Expect.Is(loop, AST.isFunctionDeclaration)
    const queries = [
      ...definitions.map(definition => () => Type.ofDefinition(definition)),
      ...aliases.map(alias => () => Type.ofValueDeclaration(alias)),
      () => Type.ofFunctionReturn(loop),
    ]
    const cold = queries.map(query => query())
    Expect(cold.map(type => type.kind)).toEqual(['unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved'])
    for (const order of [queries, [...queries].reverse()]) {
      Type.withInferenceMemo(Type.createInferenceMemo(), () => {
        for (const query of order) {
          Expect(query()).toEqual(cold[queries.indexOf(query)])
          Expect(query()).toEqual(cold[queries.indexOf(query)])
        }
      })
    }
    const witness = witnessReads(aliases[0]!, 'value')
    try {
      Type.withInferenceMemo(Type.createInferenceMemo(), () => {
        Type.ofValueDeclaration(aliases[0])
        const reads = witness.reads()
        Type.ofValueDeclaration(aliases[0])
        Expect(witness.reads()).toBeGreaterThan(reads)
        Expect(Type.ofValueDeclaration(undefined)).toEqual({ kind: 'unresolved' })
      })
    } finally {
      witness.restore()
    }
  })

  Test('separates the same contextual Account declaration in two linked consumer files', async () => {
    await withTaoFiles('tao-inference-context-', {
      '.tao/.gitkeep': '',
      'First.tao': 'use Account from @tao/auth\ndata Accounts / Account { Name text }\nlet Me = Account',
      'Second.tao': 'use Account from @tao/auth\ndata Accounts / Account { Count number }\nlet Me = Account',
      'Packages/@tao/auth/Auth.tao': 'public let Account = none',
    }, async (paths, root) => {
      const context = Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root)) })
      const first = await Parser.parse(context, URI.file(paths['First.tao']!), { validation: false })
      const second = await Parser.parse(context, URI.file(paths['Second.tao']!), { validation: false })
      Expect(first.diagnostics).toEqual([])
      Expect(second.diagnostics).toEqual([])
      const references = [first, second].map(result => {
        const alias = result.entry.ast.statements.find(AST.isAliasDeclaration)
        Expect.Is(alias, AST.isAliasDeclaration)
        Expect.Is(alias.value, AST.isValueReference)
        return alias.value
      })
      const declaration = references[0]!.target.ref
      Expect.Is(declaration, AST.isAliasDeclaration)
      Expect(references[1]!.target.ref === declaration).toBe(true)
      const cold = references.map(reference => Type.ofValueDeclaration(declaration, reference))
      Expect(cold.map(type => type.kind)).toEqual(['entity', 'entity'])
      Expect(cold[0]!.kind === 'entity' && cold[1]!.kind === 'entity' && cold[0]!.entity !== cold[1]!.entity).toBe(true)
      Type.withInferenceMemo(Type.createInferenceMemo(), () => {
        Expect(Type.ofValueDeclaration(declaration)).toEqual({ kind: 'primitive', primitive: 'none' })
        for (let pass = 0; pass < 2; pass++) {
          references.forEach((reference, index) => {
            const type = Type.ofValueDeclaration(declaration, reference)
            expectSameInference(type, cold[index]!)
            Expect(
              type.kind === 'entity' && type.entity === (index === 0 ? first : second)
                    .entry.ast.statements.find(AST.isEntityDataDeclaration),
            ).toBe(true)
          })
        }
      })
    })
  })

  Test(
    'isolates mutations of unions, list elements, action parameters, and plain shapes while retaining AST identities',
    async () => {
      const parsed = await Parser.parseCode(`
      type Name is text
      type Names is list of Name
      type Person is { Name text }
      type Expanded is Person with { Count number }
      type Input is view with { Caption text }
      data Documents / Document { Title text, Body text }
      type Draft is Document { Title }
      view Consumer(Names?, Callback action(list of Name)) { }
    `)
      Expect(parsed.diagnostics).toEqual([])
      const definitions = parsed.entry.ast.statements.filter(AST.isTypeDeclaration)
      const person = definitions.find(type => type.name === 'Person')!
      const expanded = definitions.find(type => type.name === 'Expanded')!
      const input = definitions.find(type => type.name === 'Input')!
      const draft = definitions.find(type => type.name === 'Draft')!
      const consumer = parsed.entry.ast.statements.find(AST.isViewDeclaration)
      Expect.Is(consumer, AST.isViewDeclaration)
      const parameters = AST.parametersOf(consumer)
      const queries = [
        () => Type.ofParameter(parameters[0]!),
        () => Type.ofParameter(parameters[1]!),
        () => Type.ofDefinition(person),
        () => Type.ofDefinition(expanded),
        () => Type.ofDefinition(input),
        () => Type.ofDefinition(draft),
      ]
      const cold = queries.map(query => query())
      Type.withInferenceMemo(Type.createInferenceMemo(), () => {
        const first = queries.map(query => query())
        const optional = first[0]!
        Expect(optional.kind).toBe('union')
        if (optional.kind === 'union') {
          const list = optional.members[0]!
          Expect(list.kind).toBe('list')
          if (list.kind === 'list') {
            list.element = { kind: 'unresolved' }
          }
          const members = optional.members as TaoType[]
          members.push({ kind: 'unresolved' })
        }
        const callback = first[1]!
        Expect(callback.kind === 'primitive' && callback.primitive === 'action').toBe(true)
        if (callback.kind === 'primitive' && callback.primitive === 'action') {
          callback.parameters[0]!.type = { kind: 'unresolved' }
          const mutableParameters = callback.parameters as unknown[]
          mutableParameters.push({ type: { kind: 'unresolved' } })
        }
        const personType = first[2]!
        Expect(personType.kind === 'item' && personType.item === person.type).toBe(true)
        for (const type of first.slice(3)) {
          const shape: ReturnType<typeof Type.slotsOf> = Type.slotsOf(type)
          Assert.defined(shape, 'Expected a type shape for the inferred query result.')
          Expect(AST.isItemTypeExpression(shape)).toBe(false)
          const properties = shape.properties as AST.TypeProperty[]
          properties.length = 0
          if (shape.dataFields) {
            const dataFields = shape.dataFields as AST.EntityDataField[]
            dataFields.length = 0
          }
        }
        const second = queries.map(query => query())
        second.forEach((type, index) => expectSameInference(type, cold[index]!))
        const secondPerson = second[2]!
        Expect(secondPerson.kind === 'item' && secondPerson.item === person.type).toBe(true)
        Expect(secondPerson.kind === 'item' && secondPerson.nominal === person).toBe(true)
        const secondDraft = second[5]!
        const entity = parsed.entry.ast.statements.find(AST.isEntityDataDeclaration)!
        Expect(Type.projectedEntityOf(secondDraft) === entity).toBe(true)
        Expect(Type.slotsOf(secondDraft)?.dataFields?.[0] === Type.dataFields(entity)[0]).toBe(true)
        const secondOptional = second[0]!
        if (secondOptional.kind === 'union') {
          const members = secondOptional.members as TaoType[]
          members.length = 0
        }
        queries.forEach((query, index) => expectSameInference(query(), cold[index]!))
      })
    },
  )

  Test('restores nested and thrown scopes and removes the scope before an async continuation', async () => {
    const parsed = await Parser.parseCode('let Value = "stable"')
    Expect(parsed.diagnostics).toEqual([])
    const alias = parsed.entry.ast.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    const witness = witnessReads(alias, 'value')
    try {
      const outer = Type.createInferenceMemo()
      Type.withInferenceMemo(outer, () => {
        Type.ofValueDeclaration(alias)
        const outerReads = witness.reads()
        const sentinel = { message: 'scope failure' }
        try {
          Type.withInferenceMemo(Type.createInferenceMemo(), () => {
            Type.ofValueDeclaration(alias)
            Expect(witness.reads()).toBeGreaterThan(outerReads)
            throw sentinel
          })
        } catch (error) {
          Expect(error).toBe(sentinel)
        }
        const innerReads = witness.reads()
        Type.ofValueDeclaration(alias)
        Expect(witness.reads()).toBe(innerReads)
      })
      const outsideReads = witness.reads()
      Type.ofValueDeclaration(alias)
      Expect(witness.reads()).toBeGreaterThan(outsideReads)
      let beforeAwait = 0
      await Type.withInferenceMemo(Type.createInferenceMemo(), async () => {
        Type.ofValueDeclaration(alias)
        beforeAwait = witness.reads()
        await Promise.resolve()
        Type.ofValueDeclaration(alias)
        Expect(witness.reads()).toBeGreaterThan(beforeAwait)
      })
      const finalReads = witness.reads()
      Type.ofValueDeclaration(alias)
      Expect(witness.reads()).toBeGreaterThan(finalReads)
    } finally {
      witness.restore()
    }
  })

  Test('uses a fresh memo after an imported type changes and retained AST references relink', async () => {
    await withTaoFiles('tao-inference-relink-', {
      '.tao/.gitkeep': '',
      'Main.tao': 'use Shared from ./Shared\nlet Result is Shared = none',
      'Shared.tao': 'public type Shared is text',
    }, async (paths, root) => {
      const context = Parser.createContext({ packages: Packages.createResolver(await Packages.createContext(root)) })
      const uri = URI.file(paths['Main.tao']!)
      const before = await Parser.parse(context, uri, { validation: false })
      Expect(before.diagnostics).toEqual([])
      const result = before.entry.ast.statements.find(AST.isAliasDeclaration)
      Expect.Is(result, AST.isAliasDeclaration)
      const oldType = Type.withInferenceMemo(Type.createInferenceMemo(), () => Type.ofValueDeclaration(result))
      Expect(oldType.kind === 'primitive' && oldType.primitive).toBe('text')
      await FS.writeText(paths['Shared.tao']!, 'public type Shared is number')
      const after = await Parser.parse(context, uri, { validation: false })
      Expect(after.diagnostics).toEqual([])
      Expect(after.entry.ast === before.entry.ast).toBe(true)
      const cold = Type.ofValueDeclaration(result)
      Expect(cold.kind === 'primitive' && cold.primitive).toBe('number')
      Type.withInferenceMemo(Type.createInferenceMemo(), () => {
        expectSameInference(Type.ofValueDeclaration(result), cold)
        expectSameInference(Type.ofValueDeclaration(result), cold)
      })
    })
  })
})

/** Compare semantic values without giving the matcher a linked AST graph to inspect or print. */
function expectSameInference(actual: TaoType, expected: TaoType): void {
  Expect(inferenceSummary(actual)).toEqual(inferenceSummary(expected))
  const actualReferences = inferenceReferences(actual)
  const expectedReferences = inferenceReferences(expected)
  Expect(actualReferences.length).toBe(expectedReferences.length)
  actualReferences.forEach((reference, index) => Expect(reference === expectedReferences[index]).toBe(true))
}

function inferenceSummary(type: TaoType): unknown {
  const shape = Type.slotsOf(type)
  const common = {
    kind: type.kind,
    identity: Type.identityKey(type),
    properties: shape?.properties.map(property => [property.name, property.optional]),
    dataFields: shape?.dataFields?.map(field => [field.name, field.optional]),
  }
  return Switch.kind<TaoType, unknown>(type, {
    unresolved: () => common,
    primitive: type =>
      type.primitive === 'action'
        ? {
          ...common,
          primitive: type.primitive,
          parameters: type.parameters.map(parameter => ({
            name: parameter.name,
            optional: parameter.optional,
            writable: parameter.writable,
            type: inferenceSummary(parameter.type),
          })),
        }
        : { ...common, primitive: type.primitive },
    list: type => ({ ...common, element: type.element && inferenceSummary(type.element) }),
    item: () => common,
    entity: type => ({ ...common, entity: Type.dataEntityName(type.entity) }),
    enum: type => ({ ...common, declaration: type.declaration.name }),
    union: type => ({ ...common, members: type.members.map(inferenceSummary) }),
  })
}

function inferenceReferences(type: TaoType): AST.Node[] {
  const shape = Type.slotsOf(type)
  const common: AST.Node[] = [
    ...('nominal' in type && type.nominal ? [type.nominal] : []),
    ...(shape && AST.isItemTypeExpression(shape) ? [shape] : []),
    ...(shape?.properties ?? []),
    ...(shape?.dataFields ?? []),
    ...(shape?.projectedEntity ? [shape.projectedEntity] : []),
  ]
  return Switch.kind<TaoType, AST.Node[]>(type, {
    unresolved: () => common,
    primitive: type =>
      type.primitive === 'action'
        ? [...common, ...type.parameters.flatMap(parameter => inferenceReferences(parameter.type))]
        : common,
    list: type => [...common, ...(type.element ? inferenceReferences(type.element) : [])],
    item: () => common,
    entity: type => [...common, type.entity],
    enum: type => [...common, type.declaration],
    union: type => [...common, ...type.members.flatMap(inferenceReferences)],
  })
}

// One slot per object/property makes getter witnesses safe even when installations overlap.
const getterSlots = new WeakMap<object, Map<string, TestOverrideSlot<(() => unknown) | undefined>>>()

function witnessReads(node: object, property: string): { reads: () => number; restore: () => void } {
  let slots = getterSlots.get(node)
  if (!slots) {
    slots = new Map()
    getterSlots.set(node, slots)
  }
  let slot = slots.get(property)
  if (!slot) {
    const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(node, property)
    Assert.defined(descriptor, 'Expected a property descriptor for the inference witness.')
    slot = testOverrideSlot({
      read: () => Object.getOwnPropertyDescriptor(node, property)?.get,
      write: getter =>
        Object.defineProperty(
          node,
          property,
          getter === descriptor.get
            ? descriptor
            : { configurable: true, enumerable: descriptor.enumerable, get: getter },
        ),
    })
    slots.set(property, slot)
  }
  const value: unknown = Reflect.get(node, property)
  let reads = 0
  const restore = slot.install(() => {
    reads++
    return value
  })
  return { reads: () => reads, restore }
}
