import { AST, Parser } from '@parser'
import { Assert, Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import {
  capabilityRequirements,
  ownAssociatedMethods,
} from '../ast-utils-src/associated-methods'
import { discoverCallableEffectFacts } from '../ast-utils-src/callable-effect-facts'
import type { NativeEffectPublication } from '../ast-utils-src/callable-effect-facts'
import { projectCallableEffectPublications } from '../ast-utils-src/callable-effect-publications'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'
import {
  publishCanonicalEffectSnapshot,
} from '../ast-utils-src/canonical-effect-snapshot'

Describe('Canonical callable effect projection', () => {
  Test('closes direct entity and entity-list forwarding to real declared native call heads', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func ForwardEntity(Value Book) -> Book { return Export(Value) from ./Native.ts }
      func ForwardList(Value Books) -> Books { return Export(Value) from ./Native.ts }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const owners = ['ForwardEntity', 'ForwardList'].map(name => namedFunction(file, name))
    const heads = owners.map(owner => {
      const bridge = AST.returnStatementsOf(owner)[0]?.value
      Expect.Is(bridge, AST.isFromExpression)
      Expect.Is(bridge.expression, AST.isFunctionCallExpression)
      Expect.Is(bridge.$container, AST.isReturnStatement)
      Expect(bridge.$container.value).toBe(bridge)
      const argument = bridge.expression.argumentList?.arguments[0]
      Expect.Is(argument, AST.isArgument)
      Expect.Is(argument.value, AST.isValueReference)
      Expect(argument.value.target.ref).toBe(owner.parameterList.parameters[0])
      Expect(argument.value.$container).toBe(argument)
      return bridge.expression
    })
    const natives: NativeEffectPublication[] = heads.map(head => ({
      declaration: head,
      exportSource: head,
      phase: 'evaluation',
      kind: 'complete',
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    }))
    const snapshot = publishCanonicalEffectSnapshot([file], { natives })
    const [single, collection] = owners.map(owner => snapshot.descriptors.get(owner)?.signature?.inputs[0]?.type)
    Assert(single?.kind === 'entity', 'the actual Book input is an entity domain')
    Expect(single.entity).toBe(entity)
    Assert(collection?.kind === 'list' && collection.element?.kind === 'entity', 'the actual Books input has rows')
    Expect(collection.element.entity).toBe(entity)
    const observed = owners.map((owner, index) => {
      const head = heads[index]!
      const reference = head.argumentList!.arguments[0]!.value
      const canonical = snapshot.calls.get(head)
      Assert.defined(canonical, 'the native foreign head has its actual canonical operation row')
      Expect(canonical.site).toBe(head)
      const native = snapshot.natives.find(publication => publication.declaration === head)
      Assert.defined(native, 'the typed pure native contract is anchored at this real foreign head')
      Expect(native.exportSource).toBe(head)
      Expect(native.phase).toBe('evaluation')
      const read = snapshot.reads.get(reference)
      Assert.defined(read, 'the factory publishes the real directly forwarded parameter read')
      Expect(read.declaration).toBe(owner.parameterList.parameters[0])
      const projected = projectCallableEffectPublications(snapshot, owner)
      const facts = discoverCallableEffectFacts(owner, projected.inputs, projected.context)
      Expect(facts.some(fact => fact.node === reference)).toBe(true)
      return {
        read: { classification: read.classification, kind: read.kind },
        effects: analyzeCallableEffects(owner, facts).effects,
      }
    })
    const registered = createAssociatedEffects([file])

    Expect({ observed, registered: owners.map(owner => registered.analyses.get(owner)?.effects) }).toEqual({
      observed: [
        {
          read: { classification: 'immutable', kind: 'complete' },
          effects: { purity: { violations: [], open: false }, failures: { cases: [], open: true } },
        },
        {
          read: { classification: 'immutable', kind: 'complete' },
          effects: { purity: { violations: [], open: false }, failures: { cases: [], open: true } },
        },
      ],
      registered: [
        { purity: { violations: [], open: false }, failures: { cases: [], open: true } },
        { purity: { violations: [], open: false }, failures: { cases: [], open: true } },
      ],
    })
  })

  Test(
    'keeps entity member reads nested calls and ordinary whole-entity returns outside native forwarding',
    async () => {
      const file = await parse(`
      data Books / Book { Title text }
      func Other(Value Book) -> Book { return Value }
      func Field(Value Book) -> text { return Export(Value.Title) from ./Native.ts }
      func Nested(Value Book) -> Book { return Export(Other(Value)) from ./Native.ts }
    `)
      const field = namedFunction(file, 'Field')
      const nested = namedFunction(file, 'Nested')
      const other = namedFunction(file, 'Other')
      const heads = [field, nested].map(owner => {
        const bridge = AST.returnStatementsOf(owner)[0]?.value
        Expect.Is(bridge, AST.isFromExpression)
        Expect.Is(bridge.expression, AST.isFunctionCallExpression)
        return bridge.expression
      })
      const snapshot = publishCanonicalEffectSnapshot([file], {
        natives: heads.map(head => ({
          declaration: head,
          exportSource: head,
          phase: 'evaluation',
          kind: 'complete',
          purity: { violations: [], open: false },
          failures: { cases: [], open: true },
        })),
      })
      const member = heads[0]!.argumentList?.arguments[0]?.value
      Expect.Is(member, AST.isMemberAccessExpression)
      Expect(member.members).toEqual(['Title'])
      const inner = heads[1]!.argumentList?.arguments[0]?.value
      Expect.Is(inner, AST.isFunctionCallExpression)
      Expect(inner.function.ref).toBe(other)
      const nestedReference = inner.argumentList?.arguments[0]?.value
      Expect.Is(nestedReference, AST.isValueReference)
      const ordinaryReference = AST.returnStatementsOf(other)[0]?.value
      Expect.Is(ordinaryReference, AST.isValueReference)
      for (const reference of [member, nestedReference, ordinaryReference]) {
        const read = snapshot.reads.get(reference)
        Assert.defined(read, 'the real conservative read keeps its canonical publication')
        Expect(read.classification).toBe('unknown')
        Expect(read.kind).toBe('unknown')
      }
      const projected = projectCallableEffectPublications(snapshot, nested)
      const facts = discoverCallableEffectFacts(nested, projected.inputs, projected.context)
      Expect(projected.inputs.calls.find(call => call.site === inner)?.target).toBe(other)
      Expect(facts.find(fact => fact.node === inner)?.executes.some(edge => edge.target === other)).toBe(true)
      Expect(facts.some(fact => fact.node === other.block)).toBe(true)
      const registered = createAssociatedEffects([file])
      for (const owner of [field, nested, other]) {
        Expect(registered.analyses.get(owner)?.effects.purity).toEqual({ violations: [], open: true })
      }
    },
  )

  Test('closes an ordinary pure function selecting an optional scalar from an immutable item parameter', async () => {
    const file = await parse(`
      type Result is { Value text? }
      func Label(ResultValue Result) fails never -> text { return "{ResultValue.Value}" }
    `)
    const label = namedFunction(file, 'Label')
    const parameter = label.parameterList.parameters[0]
    Assert.defined(parameter, 'Label declares the actual ResultValue item parameter')
    const selection = AST.streamAllContents(label).find(AST.isMemberAccessExpression)
    Expect.Is(selection, AST.isMemberAccessExpression)
    Expect(selection.target.ref).toBe(parameter)
    Expect(selection.members).toEqual(['Value'])
    const result = namedType(file, 'Result')
    Expect.Is(result.type, AST.isItemTypeExpression)
    Expect(result.type.properties.find(property => property.name === 'Value')?.optional).toBe(true)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const read = snapshot.reads.get(selection)
    Assert.defined(read, 'the factory publishes the actual selected optional field read')
    Expect(read.reference).toBe(selection)
    Expect(read.declaration).toBe(parameter)
    Expect(read.proof?.kind).toBe('parameter')
    Expect(read.proof?.owner).toBe(label)
    const projected = projectCallableEffectPublications(snapshot, label)
    const facts = discoverCallableEffectFacts(label, projected.inputs, projected.context)
    Expect(facts.some(fact => fact.node === selection)).toBe(true)
    const registered = createAssociatedEffects([file])

    Expect({
      read: { classification: read.classification, kind: read.kind },
      discovered: analyzeCallableEffects(label, facts).effects,
      registered: registered.analyses.get(label)?.effects,
    }).toEqual({
      read: { classification: 'immutable', kind: 'complete' },
      discovered: {
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      },
      registered: {
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      },
    })
  })

  Test('keeps whole item and entity reads unknown and mutable copy and state selections reactive', async () => {
    const file = await parse(`
      type Result is { Value text? }
      data Notes / Note { Title text }
      type Envelope is { Record Note }
      func Whole(ResultValue Result) fails never -> Result { return ResultValue }
      func EntityRead(Value Note) fails never -> text { return "{Value.Title}" }
      func NestedEntityRead(Value Envelope) fails never -> text { return "{Value.Record.Title}" }
      func MutableRead(mutable ResultValue Result) fails never -> text { return "{ResultValue.Value}" }
      func CopyRead(copy ResultValue Result) fails never -> text { return "{ResultValue.Value}" }
      view Example {
        state Current is Result = Result { Value "current" }
        func StateRead() fails never -> text { return "{Current.Value}" }
      }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const registered = createAssociatedEffects([file])
    for (const name of ['Whole', 'EntityRead', 'NestedEntityRead']) {
      const owner = namedFunction(file, name)
      const reference = name === 'Whole'
        ? AST.returnStatementsOf(owner)[0]?.value
        : AST.streamAllContents(owner).find(AST.isMemberAccessExpression)
      Assert.defined(reference, 'each conservative control contains its actual read')
      if (name === 'NestedEntityRead') {
        Expect.Is(reference, AST.isMemberAccessExpression)
        Expect(reference.members).toEqual(['Record', 'Title'])
      }
      const read = snapshot.reads.get(reference)
      Assert.defined(read, 'each conservative control has its canonical read publication')
      Expect(read.declaration).toBe(owner.parameterList.parameters[0])
      Expect(read.classification).toBe('unknown')
      Expect(read.kind).toBe('unknown')
      Expect(registered.analyses.get(owner)?.effects.purity).toEqual({ violations: [], open: true })
    }
    for (const name of ['MutableRead', 'CopyRead', 'StateRead']) {
      const owner = namedFunction(file, name)
      const reference = AST.streamAllContents(owner).find(AST.isMemberAccessExpression)
      Expect.Is(reference, AST.isMemberAccessExpression)
      Expect(reference.members).toEqual(['Value'])
      const read = snapshot.reads.get(reference)
      Assert.defined(read, 'each reactive control has its canonical selected read publication')
      Expect(read.declaration).toBe(reference.target.ref)
      if (name === 'StateRead') {
        Expect.Is(reference.target.ref, AST.isStateDeclaration)
      } else {
        const parameter = owner.parameterList.parameters[0]
        Assert.defined(parameter, 'each parameter control has its actual parameter')
        Expect(reference.target.ref).toBe(parameter)
        Expect(name === 'MutableRead' ? parameter.mutable : parameter.copy).toBe(true)
      }
      Expect(read.classification).toBe('reactive')
      Expect(read.kind).toBe('complete')
      Expect(registered.analyses.get(owner)?.effects.purity).toEqual({
        violations: ['reactive-state'],
        open: false,
      })
    }
  })

  Test('trusts only a declared foreign call head while retaining executing defaults and open arguments', async () => {
    const file = await parse(`
      let Host is text = Unclassified from ./Native.ts
      func Export(Value text default Host) -> text { return Host }
      func Native(Value text) -> text { return Export(Value) from ./Native.ts }
      func NoArguments() -> text { return Export() from ./Native.ts }
      func Defaulted(Value text default Host) -> text { return Export(Value) from ./Native.ts }
      func Unknown() -> text { return Host }
      func CallsOpen() -> text { return Export(Unknown()) from ./Native.ts }
    `)
    const registered = createAssociatedEffects([file])
    Expect(registered.analyses.get(namedFunction(file, 'Native'))?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
    Expect(registered.analyses.get(namedFunction(file, 'NoArguments'))?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
    for (const name of ['Defaulted', 'Unknown', 'CallsOpen', 'Export']) {
      Expect(registered.analyses.get(namedFunction(file, name))?.effects.purity.open).toBe(true)
    }
  })

  Test('retains a reactive argument executed before a declared foreign head', async () => {
    const file = await parse(`
      view Example {
        state Counter = 1
        func Native() -> number { return Export(Counter) from ./Native.ts }
        func Defaulted(Value number default Counter) -> number { return Export(Value) from ./Native.ts }
      }
    `)
    const registered = createAssociatedEffects([file])
    Expect(registered.analyses.get(namedFunction(file, 'Native'))?.effects).toEqual({
      purity: { violations: ['reactive-state'], open: false },
      failures: { cases: [], open: true },
    })
    Expect(registered.analyses.get(namedFunction(file, 'Defaulted'))?.effects).toEqual({
      purity: { violations: ['reactive-state'], open: false },
      failures: { cases: [], open: true },
    })
  })

  Test('registers ordinary source functions even without associated declarations', async () => {
    const file = await parse('func Entry() fails never -> text { return "pure" }')
    const entry = namedFunction(file, 'Entry')
    const registered = createAssociatedEffects([file])

    Expect(registered.descriptors.size).toBe(0)
    Expect(registered.analyses.get(entry)?.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('registers an uncalled converter on an owner without associated methods', async () => {
    const file = await parse(`
      type Token is text with { Token as text fails never { return "token" } }
    `)
    const converter = AST.streamAllContents(file).find(AST.isAssociatedConverterDeclaration)
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, converter)
    const facts = discoverCallableEffectFacts(converter, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(converter, facts)
    const registered = createAssociatedEffects([file])

    Expect(snapshot.descriptors.get(converter)?.body).toBe(converter.block)
    Expect(projected.context.root?.node).toBe(converter)
    Expect(facts.some(fact => fact.node === converter.block)).toBe(true)
    Expect(analysis.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    Expect(registered.analyses.get(converter)?.effects).toEqual(analysis.effects)
    Expect(registered.descriptors.size).toBe(0)
  })

  Test('executes a real conversion operand once and carries converter bridge effects to its caller', async () => {
    const file = await parse(`
      let Host is text = Native from ./Native.ts
      type Token is text with {
        Token as text fails never { return Host }
      }
      func Operand(Value Token) fails never -> Token { return Value }
      func Convert(Value Token) fails never -> text { return Operand(Value) as text }
    `)
    const converter = AST.streamAllContents(file).find(AST.isAssociatedConverterDeclaration)
    const convert = namedFunction(file, 'Convert')
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    const conversion = AST.returnStatementsOf(convert)[0]?.value
    Expect.Is(conversion, AST.isConversionExpression)
    Expect.Is(conversion.value, AST.isFunctionCallExpression)
    const alias = file.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    const bridge = alias.value
    Expect.Is(bridge, AST.isFromExpression)
    const snapshot = publishCanonicalEffectSnapshot([file], {
      natives: [{
        declaration: bridge,
        exportSource: bridge,
        phase: 'evaluation',
        kind: 'complete',
        purity: { violations: ['io'], open: false },
        failures: { cases: ['ReadFailed'], open: false },
      }],
    })
    const projected = projectCallableEffectPublications(snapshot, convert)
    const facts = discoverCallableEffectFacts(convert, projected.inputs, projected.context)
    const call = projected.inputs.calls.find(value => value.site === conversion)
    Assert.defined(call, 'the actual conversion has its canonical projected execution row')

    Expect(call.target).toBe(converter)
    Expect(call.body).toBe(converter.block)
    Expect(call.kind).toBe('complete')
    Expect(call.pairs).toEqual([])
    Expect(call.defaults).toEqual([])
    Expect(facts.filter(fact => fact.node === conversion.value)).toHaveLength(1)
    Expect(facts.find(fact => fact.node === conversion)?.executes.filter(edge => edge.target === conversion.value))
      .toHaveLength(1)
    Expect(facts.some(fact => fact.node === namedFunction(file, 'Operand').block)).toBe(true)
    Expect(facts.some(fact => fact.node === converter.block)).toBe(true)
    Expect(analyzeCallableEffects(convert, facts).effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['ReadFailed'], open: true },
    })
  })

  Test('projects authored primitive operators and leaves boolean built-ins outside call completeness', async () => {
    const file = await parse(`
      primitive number with {
        static func +(Left number, Right number) fails never -> number { return Left }
        static func -(Value number) fails never -> number { return Value }
      }
      func Operand(Value number) fails never -> number { return Value }
      func Add(Left number, Right number) fails never -> number { return Operand(Left) + Right }
      func Negate(Value number) fails never -> number { return -Value }
      func Both(Left boolean, Right boolean) fails never -> boolean { return Left and Right }
    `)
    const primitive = file.statements.find(AST.isPrimitiveDeclaration)
    Expect.Is(primitive, AST.isPrimitiveDeclaration)
    const methods = ownAssociatedMethods(primitive)
    Expect(methods).toHaveLength(2)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const registered = createAssociatedEffects([file])
    for (const method of methods) {
      Expect(registered.analyses.get(method)?.effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
      Expect(registered.descriptors.get(method)?.owner).toBe(primitive)
    }
    for (const name of ['Add', 'Negate', 'Both']) {
      const owner = namedFunction(file, name)
      const site = AST.returnStatementsOf(owner)[0]?.value
      Assert.defined(site, 'each function contains its real operation expression')
      const projected = projectCallableEffectPublications(snapshot, owner)
      const facts = discoverCallableEffectFacts(owner, projected.inputs, projected.context)
      const call = projected.inputs.calls.find(value => value.site === site)
      if (name === 'Both') {
        Expect(call).toBeUndefined()
      } else {
        Assert.defined(call, 'an authored operation has its real projected call')
        Expect(call.kind).toBe('complete')
        Expect(call.target).toBe(methods[name === 'Add' ? 0 : 1])
        Expect(facts.some(fact => fact.node === call.body)).toBe(true)
      }
      if (name === 'Add') {
        Expect.Is(site, AST.isBinaryExpression)
        Expect(facts.find(fact => fact.node === site)?.executes.filter(edge => edge.target === site.left))
          .toHaveLength(1)
        Expect(facts.some(fact => fact.node === namedFunction(file, 'Operand').block)).toBe(true)
      }
      Expect(analyzeCallableEffects(owner, facts).effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
    }
  })

  Test('keeps an actual unselected conversion open while executing its known operand', async () => {
    const file = await parse(`
      type Token is text
      func Operand(Value Token) fails never -> Token { return Value }
      func Convert(Value Token) fails never -> text { return Operand(Value) as text }
    `)
    const convert = namedFunction(file, 'Convert')
    const conversion = AST.returnStatementsOf(convert)[0]?.value
    Expect.Is(conversion, AST.isConversionExpression)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, convert)
    const facts = discoverCallableEffectFacts(convert, projected.inputs, projected.context)
    const call = projected.inputs.calls.find(value => value.site === conversion)
    Assert.defined(call, 'an unselected actual conversion still has a published row')

    Expect(call.kind).toBe('unknown')
    Expect(call.target).toBeUndefined()
    Expect(facts.some(fact => fact.node === namedFunction(file, 'Operand').block)).toBe(true)
    Expect(analyzeCallableEffects(convert, facts).effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
  })

  Test('carries actual authored operator bridge effects into an ordinary function analysis', async () => {
    const file = await parse(`
      let Host is Scalar = Native from ./Native.ts
      type Scalar is numeric with {
        static func +(Left Scalar, Right Scalar) fails never -> Scalar { return Host }
      }
      func Add(Left Scalar, Right Scalar) fails never -> Scalar { return Left + Right }
    `)
    const method = ownAssociatedMethods(namedType(file, 'Scalar'))[0]
    Assert.defined(method, 'Scalar declares its actual authored operator body')
    const alias = file.statements.find(AST.isAliasDeclaration)
    Expect.Is(alias, AST.isAliasDeclaration)
    const bridge = alias.value
    Expect.Is(bridge, AST.isFromExpression)
    const add = namedFunction(file, 'Add')
    const site = AST.returnStatementsOf(add)[0]?.value
    Expect.Is(site, AST.isBinaryExpression)
    const snapshot = publishCanonicalEffectSnapshot([file], {
      natives: [{
        declaration: bridge,
        exportSource: bridge,
        phase: 'evaluation',
        kind: 'complete',
        purity: { violations: ['io'], open: false },
        failures: { cases: ['ReadFailed'], open: false },
      }],
    })
    const projected = projectCallableEffectPublications(snapshot, add)
    const facts = discoverCallableEffectFacts(add, projected.inputs, projected.context)

    Expect(projected.inputs.calls.find(value => value.site === site)?.target).toBe(method)
    Expect(facts.some(fact => fact.node === method.block)).toBe(true)
    Expect(facts.some(fact => fact.node === bridge)).toBe(true)
    Expect(analyzeCallableEffects(add, facts).effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['ReadFailed'], open: true },
    })
  })

  Test('discovers and closes a real uncalled pure associated method root', async () => {
    const file = await parse(`
      type Title is text with {
        func ToText() fails never { return "{Title}" }
      }
    `)
    const title = namedType(file, 'Title')
    const method = ownAssociatedMethods(title)[0]
    Assert.defined(method, 'the Title type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, method)
    const facts = discoverCallableEffectFacts(method, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(method, facts)
    const contextualRead = [...snapshot.reads.values()].find(read => read.proof?.kind === 'contextual-owner')

    Assert.defined(contextualRead, 'the interpolation publishes its contextual Title read')
    Expect(contextualRead.proof?.owner).toBe(title)
    Expect(projected.context.root?.node).toBe(method)
    Expect(projected.context.root?.bodies[0]).toBe(method.block)
    Expect(facts.some(fact => fact.node === method)).toBe(true)
    Expect(facts.some(fact => fact.node === method.block)).toBe(true)
    Expect(facts.some(fact => fact.node === method.parameterList)).toBe(false)
    Expect(analysis.effects.purity).toEqual({ violations: [], open: false })
    Expect(analysis.effects.failures).toEqual({ cases: [], open: false })
  })

  Test('carries a live alias through its actual reactive initializer path', async () => {
    const file = await parse(`
      view Example {
        state Counter = 1
        let Live = Counter
        func Read() -> text { return "{Live}" }
      }
    `)
    const read = namedFunction(file, 'Read')
    const alias = AST.streamAllContents(file).find(value => AST.isAliasDeclaration(value) && value.name === 'Live')
    const state = AST.streamAllContents(file).find(value => AST.isStateDeclaration(value) && value.name === 'Counter')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(state, AST.isStateDeclaration)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const reference = AST.streamAllContents(read).find(value =>
      AST.isValueReference(value) && value.target.ref === alias
    )
    Expect.Is(reference, AST.isValueReference)
    const projected = projectCallableEffectPublications(snapshot, read)
    const fact = discoverCallableEffectFacts(read, projected.inputs, projected.context).find(value =>
      value.node === reference
    )
    const analysis = analyzeCallableEffects(
      read,
      discoverCallableEffectFacts(read, projected.inputs, projected.context),
    )
    const readPublication = projected.inputs.reads.find(value => value.reference === reference)

    Assert.defined(fact, 'the actual alias reference is discovered')
    Assert.defined(readPublication, 'the alias reference has a projected read publication')
    Expect(readPublication.classification).toBe('immutable')
    Expect(readPublication.initializer).toBe(alias.value)
    Expect(fact.executes.some(edge => edge.target === alias.value)).toBe(true)
    Expect(snapshot.reads.get(alias.value)?.classification).toBe('reactive')
    Expect(snapshot.reads.get(alias.value)?.declaration).toBe(state)
    Expect(projected.inputs.reads.some(value => value.reference === alias.value)).toBe(true)
    Expect(analysis.effects.purity.violations).toContain('reactive-state')
    Expect(analysis.effects.purity.open).toBe(false)
  })

  Test('keeps real computed receivers through supported text wrapper construction', async () => {
    const file = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build() -> Token { return Token "value" }
      func Chain() -> text { return Build().Again().Format() }
    `)
    const token = namedType(file, 'Token')
    const [again, format] = ownAssociatedMethods(token)
    const build = namedFunction(file, 'Build')
    const chain = namedFunction(file, 'Chain')
    Assert.defined(again, 'Token declares Again')
    Assert.defined(format, 'Token declares Format')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, chain)
    const facts = discoverCallableEffectFacts(chain, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(chain, facts)
    const computedCalls = [...snapshot.calls.values()].filter(value =>
      value.target === again || value.target === format
    )
    const buildCall = [...snapshot.calls.values()].find(value => value.target === build)
    Assert(computedCalls.length >= 2, 'both actual computed method calls are published')
    Assert.defined(buildCall, 'the computed receiver invocation has a canonical row')

    Expect(computedCalls.every(value => AST.isMethodCallExpression(value.site))).toBe(true)
    Expect(facts.some(fact => fact.node === build.block)).toBe(true)
    Expect(facts.some(fact => fact.node === again.block)).toBe(true)
    Expect(facts.some(fact => fact.node === format.block)).toBe(true)
    Expect(facts.some(fact => fact.node === again.parameterList || fact.node === format.parameterList)).toBe(false)
    Expect(facts.some(fact => fact.node === again.returnType || fact.node === format.returnType)).toBe(false)
    Expect(facts.some(fact => fact.node === buildCall.site)).toBe(true)
    Expect(facts.some(fact => fact.executes.some(edge => edge.target === buildCall.site))).toBe(true)
    Expect(analysis.effects.purity.open).toBe(false)
    Expect(analysis.effects.failures.open).toBe(false)
  })

  Test('closes parameter-based static selections and preserves reactive receiver violations', async () => {
    const pureFile = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build(Value Token) fails never -> Token { return Value }
      func Chain(Value Token) fails never -> text { return Build(Value).Again().Format() }
    `)
    const pureToken = namedType(pureFile, 'Token')
    const pureMethods = ownAssociatedMethods(pureToken)
    const again = pureMethods.find(value => value.name === 'Again')
    const format = pureMethods.find(value => value.name === 'Format')
    const chain = namedFunction(pureFile, 'Chain')
    Assert.defined(again, 'Token declares the pure Again method')
    Assert.defined(format, 'Token declares the pure Format method')
    const pureSnapshot = publishCanonicalEffectSnapshot([pureFile])
    const methodCalls = AST.streamAllContents(chain).filter(AST.isMethodCallExpression)
    const pureProjected = projectCallableEffectPublications(pureSnapshot, chain)
    const pureFacts = discoverCallableEffectFacts(chain, pureProjected.inputs, pureProjected.context)
    const pureAnalysis = analyzeCallableEffects(chain, pureFacts)

    Expect(methodCalls).toHaveLength(2)
    for (const call of methodCalls) {
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      const selection = pureProjected.inputs.reads.find(read => read.reference === call.callee)
      Assert.defined(selection, 'each computed method callee has a projected selection read')
      const canonicalSelection = pureSnapshot.reads.get(call.callee)
      Assert.defined(canonicalSelection, 'the factory retains each static selection proof')
      Expect(selection.kind).toBe('complete')
      Expect(selection.classification).toBe('immutable')
      Assert(
        canonicalSelection.proof?.kind === 'static-method-selection',
        'the selection carries its independent static proof',
      )
      Expect(canonicalSelection.proof.owner).toBe(pureToken)
      Expect(pureFacts.find(fact => fact.node === call.callee)?.kind).toBe('complete')
    }
    Expect(pureSnapshot.calls.size).toBe(3)
    Expect(pureFacts.some(fact => fact.node === chain.parameterList.parameters[0])).toBe(false)
    Expect(pureAnalysis.effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })

    const reactiveFile = await parse(`
      type Token is text with {
        func Again() fails never -> Token { return Token }
        func Format() fails never -> text { return "token" }
      }
      func Build(Value Token) fails never -> Token { return Value }
      view Example {
        state Current is Token = Token "current"
        func Read() fails never -> text { return Build(Current).Again().Format() }
      }
    `)
    const reactiveToken = namedType(reactiveFile, 'Token')
    const view = reactiveFile.statements.find(AST.isViewDeclaration)
    Expect.Is(view, AST.isViewDeclaration)
    const state = AST.streamAllContents(view).find(value => AST.isStateDeclaration(value) && value.name === 'Current')
    Expect.Is(state, AST.isStateDeclaration)
    const read = namedFunction(reactiveFile, 'Read')
    const reactiveSnapshot = publishCanonicalEffectSnapshot([reactiveFile])
    const stateReference = AST.streamAllContents(read).find(value =>
      AST.isValueReference(value) && value.target.ref === state
    )
    Expect.Is(stateReference, AST.isValueReference)
    const reactiveCalls = AST.streamAllContents(read).filter(AST.isMethodCallExpression)
    const reactiveProjected = projectCallableEffectPublications(reactiveSnapshot, read)
    const reactiveFacts = discoverCallableEffectFacts(read, reactiveProjected.inputs, reactiveProjected.context)
    const reactiveAnalysis = analyzeCallableEffects(read, reactiveFacts)

    Expect(reactiveSnapshot.reads.get(stateReference)?.classification).toBe('reactive')
    Expect(reactiveCalls).toHaveLength(2)
    for (const call of reactiveCalls) {
      Expect.Is(call.callee, AST.isPostfixMemberAccess)
      const selection = reactiveProjected.inputs.reads.find(value => value.reference === call.callee)
      Assert.defined(selection, 'the reactive receiver call keeps its static selection read')
      const canonicalSelection = reactiveSnapshot.reads.get(call.callee)
      Assert.defined(canonicalSelection, 'the factory keeps the selection proof beside the reactive receiver')
      Expect(selection.classification).toBe('immutable')
      Assert(
        canonicalSelection.proof?.kind === 'static-method-selection',
        'the receiver does not weaken static selection',
      )
      Expect(canonicalSelection.proof.owner).toBe(reactiveToken)
      const receiver = call.callee.receiver
      Expect(
        reactiveFacts.find(fact => fact.node === call.callee)?.executes.some(edge => edge.target === receiver),
      ).toBe(true)
    }
    Expect(reactiveAnalysis.effects).toEqual({
      purity: { violations: ['reactive-state'], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('retains a genuine recursive backedge with one fact per source node', async () => {
    const file = await parse(`
      func Recurse(Value number) fails never -> number { return Recurse(Value) }
      func Entry(Value number) -> number { return Recurse(Value) }
    `)
    const recurse = namedFunction(file, 'Recurse')
    const entry = namedFunction(file, 'Entry')
    const recursiveSite = AST.returnStatementsOf(recurse)[0]?.value
    Expect.Is(recursiveSite, AST.isFunctionCallExpression)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const projected = projectCallableEffectPublications(snapshot, entry)
    const facts = discoverCallableEffectFacts(entry, projected.inputs, projected.context)
    const backedge = facts.find(fact => fact.node === recursiveSite)?.executes.find(edge => edge.target === recurse)

    Expect(facts.filter(fact => fact.node === recurse)).toHaveLength(1)
    Expect(facts.filter(fact => fact.node === recurse.block)).toHaveLength(1)
    Expect(backedge?.site).toBe(recursiveSite)
    Expect(backedge?.target).toBe(recurse)
    Expect(analyzeCallableEffects(entry, facts).effects.purity).toEqual({ violations: [], open: false })
    Expect(analyzeCallableEffects(entry, facts).effects.failures).toEqual({ cases: [], open: true })
  })

  Test('preserves unknown evaluation and invocation bridge phases at real source anchors', async () => {
    const file = await parse(`
      view Main {
        let Native is action(text) = OpenUrl from ./Native.ts
        action Root() { do Native("https://example.test") }
      }
    `)
    const alias = AST.streamAllContents(file).find(value => AST.isAliasDeclaration(value) && value.name === 'Native')
    const owner = AST.streamAllContents(file).find(value => AST.isActionDeclaration(value) && value.name === 'Root')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(owner, AST.isActionDeclaration)
    Expect.Is(alias.value, AST.isFromExpression)
    const site = owner.block?.statements[0]
    Expect.Is(site, AST.isDoStatement)
    const exportSource = alias.value
    const native = (phase: NativeEffectPublication['phase'], declaration: AST.Node): NativeEffectPublication => ({
      phase,
      declaration,
      exportSource,
      kind: 'unknown',
      reason: 'unclassified-native',
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const snapshot = publishCanonicalEffectSnapshot([file], {
      natives: [native('evaluation', exportSource), native('invocation', site)],
    })
    const projected = projectCallableEffectPublications(snapshot, owner)
    const facts = discoverCallableEffectFacts(owner, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(owner, facts)
    const phases = projected.inputs.natives.filter(value => value.exportSource === exportSource)

    Expect(phases.map(value => value.phase)).toEqual(['evaluation', 'invocation'])
    Expect(phases.every(value => value.kind === 'unknown' && value.reason === 'unclassified-native')).toBe(true)
    Expect(phases.every(value => value.exportSource === alias.value)).toBe(true)
    Expect(projected.inputs.calls.some(value => value.site === site)).toBe(false)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('retains real inherited parameter bindings and omits only independently excluded defaults', async () => {
    const file = await parse(`
      type Token is text with {
        func Format(Prefix text, Count number) fails never -> text {
          return Prefix
        }
      }
      type Child is Token
      func Show(Value Child) -> text { return Value.Format(2, "prefix") }
      func Read(Caption text? default "default") -> text { return "{Caption}" }
      func Omitted() -> text { return Read() }
      func Supplied() -> text { return Read(Caption: none) }
    `)
    const token = namedType(file, 'Token')
    const method = ownAssociatedMethods(token)[0]
    const show = namedFunction(file, 'Show')
    const read = namedFunction(file, 'Read')
    const omitted = namedFunction(file, 'Omitted')
    const supplied = namedFunction(file, 'Supplied')
    Assert.defined(method, 'the Token type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const methodCall = [...snapshot.calls.values()].find(value => value.target === method)
    const readCalls = [...snapshot.calls.values()].filter(value => value.target === read)
    const omittedCall = readCalls.find(value => value.defaults.some(item => item.eligibility === 'may'))
    const suppliedCall = readCalls.find(value => value.defaults.some(item => item.eligibility === 'cannot'))
    Assert.defined(methodCall, 'the inherited associated call has a real canonical row')
    Assert.defined(omittedCall, 'the omitted call has a real canonical row')
    Assert.defined(suppliedCall, 'the supplied call has a real canonical row')

    const parameters = method.parameterList.parameters
    const methodCallSite = methodCall.site
    Expect.Is(methodCallSite, AST.isMethodCallExpression)
    const methodArguments = AST.argumentsOf(methodCallSite)
    Expect(methodCall.pairs.find(pair => pair.parameter === parameters[0])?.argument).toBe(
      methodArguments[1],
    )
    Expect(methodCall.pairs.find(pair => pair.parameter === parameters[1])?.argument).toBe(
      methodArguments[0],
    )
    const defaultParameter = read.parameterList.parameters[0]
    Assert.defined(defaultParameter, 'Read declares its defaulted parameter')
    Expect(omittedCall.defaults.find(value => value.parameter === defaultParameter)?.expression).toBe(
      defaultParameter.defaultValue,
    )
    Expect(suppliedCall.defaults.find(value => value.parameter === defaultParameter)?.eligibility).toBe('cannot')

    const omittedProjection = projectCallableEffectPublications(snapshot, omitted)
    const suppliedProjection = projectCallableEffectPublications(snapshot, supplied)
    const omittedFacts = discoverCallableEffectFacts(omitted, omittedProjection.inputs, omittedProjection.context)
    const suppliedFacts = discoverCallableEffectFacts(supplied, suppliedProjection.inputs, suppliedProjection.context)
    const omittedEdge = omittedFacts.find(fact => fact.node === omittedCall.site)?.executes.find(edge =>
      edge.target === defaultParameter.defaultValue
    )
    const suppliedEdge = suppliedFacts.find(fact => fact.node === suppliedCall.site)?.executes.find(edge =>
      edge.target === defaultParameter.defaultValue
    )
    Expect(omittedEdge?.site).toBe(defaultParameter)
    Expect(suppliedEdge).toBeUndefined()
    const showProjection = projectCallableEffectPublications(snapshot, show)
    Expect(
      showProjection.inputs.calls.find(value => value.site === methodCall.site)?.pairs.find(pair =>
        pair.parameter === parameters[0]
      )?.argument,
    ).toBe(methodArguments[1])
  })

  Test('seeds an uncalled associated method default and excludes it for a supplied call', async () => {
    const file = await parse(`
      let Foreign is text = Read from ./Native.ts
      type Token is text with {
        func Format(Caption text default Foreign) fails never -> text { return Caption }
      }
      func Supplied(Value Token) fails never -> text { return Value.Format(Caption: "provided") }
    `)
    const foreign = file.statements.find(value => AST.isAliasDeclaration(value) && value.name === 'Foreign')
    const method = ownAssociatedMethods(namedType(file, 'Token'))[0]
    const supplied = namedFunction(file, 'Supplied')
    Expect.Is(foreign, AST.isAliasDeclaration)
    Assert.defined(method, 'the Token type declares Format')
    const parameter = method.parameterList.parameters[0]
    Assert.defined(parameter, 'Format declares its defaulted Caption parameter')
    const defaultValue = parameter.defaultValue
    Expect.Is(defaultValue, AST.isValueReference)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const methodProjection = projectCallableEffectPublications(snapshot, method)
    const methodFacts = discoverCallableEffectFacts(method, methodProjection.inputs, methodProjection.context)
    const methodAnalysis = analyzeCallableEffects(method, methodFacts)
    const rootDefault = methodProjection.context.root?.defaults.find(value => value.parameter === parameter)

    Assert.defined(rootDefault, 'the uncalled source root seeds Caption default execution')
    Expect(rootDefault.expression).toBe(defaultValue)
    Expect(methodFacts.some(fact => fact.node === defaultValue)).toBe(true)
    Expect(snapshot.reads.get(defaultValue)?.declaration).toBe(foreign)
    Expect(methodAnalysis.effects.purity.open).toBe(true)
    Expect(methodAnalysis.effects.failures.open).toBe(true)

    const suppliedProjection = projectCallableEffectPublications(snapshot, supplied)
    const suppliedFacts = discoverCallableEffectFacts(supplied, suppliedProjection.inputs, suppliedProjection.context)
    const call = suppliedProjection.inputs.calls.find(value => value.target === method)
    Assert.defined(call, 'Supplied has the real associated invocation')
    Expect(call.defaults.some(value => value.parameter === parameter)).toBe(false)
    Expect(suppliedFacts.some(fact => fact.executes.some(edge => edge.target === defaultValue))).toBe(false)
    Expect(analyzeCallableEffects(supplied, suppliedFacts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('keeps known arguments and defaults while an unresolved binding opens the call', async () => {
    const file = await parse(
      `
      type Token is text with {
        func Format(Prefix text, Caption text default "default") fails never -> text { return Prefix }
      }
      func Broken(Value Token) -> text { return Value.Format(Prefix: Missing) }
    `,
      true,
    )
    const method = ownAssociatedMethods(namedType(file, 'Token'))[0]
    const broken = namedFunction(file, 'Broken')
    Assert.defined(method, 'the Token type has its source method')
    const snapshot = publishCanonicalEffectSnapshot([file])
    const canonical = [...snapshot.calls.values()].find(value => value.target === method)
    Assert.defined(canonical, 'the unresolved associated call keeps its known target')
    const projected = projectCallableEffectPublications(snapshot, broken)
    const call = projected.inputs.calls.find(value => value.site === canonical.site)
    Assert.defined(call, 'the canonical call is projected')
    const facts = discoverCallableEffectFacts(broken, projected.inputs, projected.context)
    const analysis = analyzeCallableEffects(broken, facts)

    Expect(call.kind).toBe('unknown')
    const canonicalSite = canonical.site
    Expect.Is(canonicalSite, AST.isMethodCallExpression)
    Expect(call.pairs[0]?.argument).toBe(AST.argumentsOf(canonicalSite)[0])
    Expect(call.defaults.some(value =>
      value.parameter === method.parameterList.parameters[1]
      && value.expression === method.parameterList.parameters[1]?.defaultValue
    )).toBe(true)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('leaves missing requirement evidence open and projects only its independently supplied contract', async () => {
    const file = await parse(`
      can Display { Format() fails never -> text }
      func Show(Value Display) -> text { return Value.Format() }
    `)
    const requirement = capabilityRequirements(namedType(file, 'Display'))[0]
    const show = namedFunction(file, 'Show')
    Assert.defined(requirement, 'Display declares its real Format requirement')
    const call = [...publishCanonicalEffectSnapshot([file]).calls.values()].find(value => value.target === requirement)
    Assert.defined(call, 'the requirement invocation is published')
    const withoutEvidence = publishCanonicalEffectSnapshot([file])
    const missingProjection = projectCallableEffectPublications(withoutEvidence, show)
    const missingFacts = discoverCallableEffectFacts(show, missingProjection.inputs, missingProjection.context)
    const missingAnalysis = analyzeCallableEffects(show, missingFacts)
    Expect(missingProjection.inputs.calls.find(value => value.site === call.site)?.kind).toBe('unknown')
    Expect(missingAnalysis.effects.purity.open).toBe(true)
    Expect(missingAnalysis.effects.failures.open).toBe(true)

    const contract = { purity: { violations: [], open: false }, failures: { cases: [], open: false } }
    const withEvidence = publishCanonicalEffectSnapshot([file], { requirements: new Map([[requirement, contract]]) })
    const evidenceProjection = projectCallableEffectPublications(withEvidence, show)
    const evidenceCall = evidenceProjection.inputs.calls.find(value => value.site === call.site)
    Assert.defined(evidenceCall, 'the actual requirement call keeps its source site')
    Expect(evidenceCall.contract).toEqual(contract)
    Expect(evidenceCall.body).toBeUndefined()
    Expect(evidenceCall.kind).toBe('complete')
    const evidenceFacts = discoverCallableEffectFacts(show, evidenceProjection.inputs, evidenceProjection.context)
    Expect(analyzeCallableEffects(show, evidenceFacts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
  })

  Test('rejects copied snapshot provenance and opens owners outside factory coverage', async () => {
    const indexed = await parse('func Indexed() -> text { return "indexed" }')
    const outside = await parse('func Outside() -> text { return "outside" }')
    const owner = namedFunction(outside, 'Outside')
    const snapshot = publishCanonicalEffectSnapshot([indexed])
    Expect(() => projectCallableEffectPublications({ ...snapshot }, owner)).toThrow(Errors.UnexpectedBehaviorError)

    const genuineProjection = projectCallableEffectPublications(snapshot, owner)
    const facts = discoverCallableEffectFacts(owner, genuineProjection.inputs, genuineProjection.context)
    const analysis = analyzeCallableEffects(owner, facts)
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.failures.open).toBe(true)
    Expect(facts.find(fact => fact.node === owner)?.reason).toBe('incomplete-fact')
  })
})

async function parse(source: string, allowUnresolved = false): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.length > 0).toBe(allowUnresolved)
  return parsed.entry.ast
}

function namedType(file: AST.TaoFile, name: string): AST.TypeDeclaration {
  const declaration = file.statements.find(value => AST.isTypeDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isTypeDeclaration)
  return declaration
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const declaration = AST.streamAllContents(file).find(value => AST.isFunctionDeclaration(value) && value.name === name)
  Expect.Is(declaration, AST.isFunctionDeclaration)
  return declaration
}
