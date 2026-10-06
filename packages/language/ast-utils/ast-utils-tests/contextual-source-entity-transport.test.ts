import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { createAssociatedEffects } from '../ast-utils-src/associated-effect-context'
import { ownAssociatedMethods } from '../ast-utils-src/associated-methods'
import { publishCanonicalEffectSnapshot } from '../ast-utils-src/canonical-effect-snapshot'

Describe('Contextual source-call entity handle transport', () => {
  Test('forwards the original readonly entity list through a source wrapper into its native head', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func GroupedRows(Items list of Book) fails never -> list of Book { return Bridge(Items) }
    `)
    const effects = createAssociatedEffects([file])
    Expect(effects.analyses.get(namedFunction(file, 'Bridge'))?.effects).toEqual(closed)
    Expect(effects.analyses.get(namedFunction(file, 'GroupedRows'))?.effects).toEqual(closed)
    assertTransport(file, namedFunction(file, 'GroupedRows'), 'many')
  })

  Test('forwards an actual associated method parameter through the same ordinary source call', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      type Carrier is text with {
        func Forward(Items list of Book) fails never -> list of Book { return Bridge(Items) }
      }
    `)
    const owner = file.statements.find(AST.isTypeDeclaration)
    Expect.Is(owner, AST.isTypeDeclaration)
    const method = ownAssociatedMethods(owner)[0]
    Expect.Is(method, AST.isAssociatedFunctionDeclaration)
    Expect(createAssociatedEffects([file]).analyses.get(method)?.effects).toEqual(closed)
    assertTransport(file, method, 'many')
  })

  Test('retains exact singular entity transport anchors', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Value Book) fails never -> Book { return Export(Value) from ./Native.ts }
      func Forward(Value Book) fails never -> Book { return Bridge(Value) }
    `)
    Expect(createAssociatedEffects([file]).analyses.get(namedFunction(file, 'Forward'))?.effects).toEqual(closed)
    assertTransport(file, namedFunction(file, 'Forward'), 'one')
  })

  Test('does not treat a converter in the return type as execution in the enclosing function body', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func Outer(Items list of Book) -> {
        Book as Books { return Bridge(Items) }
      } {
        return Bridge(Items)
      }
    `)
    const owner = namedFunction(file, 'Outer')
    const converter = AST.streamAllContents(owner.returnType!).find(AST.isAssociatedConverterDeclaration)
    Expect.Is(converter, AST.isAssociatedConverterDeclaration)
    const reference = argumentRead(converter)
    Expect(reference.target.ref).toBe(owner.parameterList.parameters[0])
    const argument = reference.$container
    Expect.Is(argument, AST.isArgument)
    const call = argument.$container?.$container
    Expect.Is(call, AST.isFunctionCallExpression)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const publication = snapshot.calls.get(call)
    Expect(publication?.kind).toBe('complete')
    Expect(publication?.descriptor?.kind).toBe('source')
    Expect(publication?.target).toBe(namedFunction(file, 'Bridge'))
    Expect(publication?.pairs[0]?.argument).toBe(argument)
    Expect(publication?.pairs[0]?.parameter).toBe(namedFunction(file, 'Bridge').parameterList.parameters[0])
    Expect(snapshot.reads.get(reference)?.classification).toBe('unknown')
    Expect(snapshot.reads.get(reference)?.kind).toBe('unknown')
    Expect(snapshot.reads.get(reference)?.proof?.kind).toBe('parameter')
    assertTransport(file, owner, 'many', true)
  })

  Test('upgrades only the forwarded occurrence and leaves another bare read open', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func Extra(Items list of Book) fails never -> list of Book {
        if true { return Bridge(Items) }
        return Items
      }
    `)
    const owner = namedFunction(file, 'Extra')
    assertTransport(file, owner, 'many')
    const references = AST.streamAllContents(owner).filter(AST.isValueReference)
    Expect(references.length).toBe(2)
    Expect(references[0]?.target.ref).toBe(references[1]?.target.ref)
    const snapshot = publishCanonicalEffectSnapshot([file])
    Expect(snapshot.reads.get(references[1]!)?.classification).toBe('unknown')
    Expect(snapshot.reads.get(references[1]!)?.proof?.kind).toBe('parameter')
    Expect(createAssociatedEffects([file]).analyses.get(owner)?.effects.purity.open).toBe(true)
  })

  Test('preserves executing field reads and opaque native effects in a structurally compatible callee', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Impure(Value Book) fails never -> text { return Value.Title }
      func CallImpure(Value Book) fails never -> text { return Impure(Value) }
      func Opaque(Items list of Book) fails never -> list of Book { return Read from ./Native.ts }
      func CallOpaque(Items list of Book) fails never -> list of Book { return Opaque(Items) }
    `)
    const effects = createAssociatedEffects([file])
    for (
      const [callee, caller, cardinality] of [
        ['Impure', 'CallImpure', 'one'],
        ['Opaque', 'CallOpaque', 'many'],
      ] as const
    ) {
      assertTransport(file, namedFunction(file, caller), cardinality)
      Expect(effects.analyses.get(namedFunction(file, callee))?.effects.purity.open).toBe(true)
      Expect(effects.analyses.get(namedFunction(file, caller))?.effects.purity.open).toBe(true)
      Expect(effects.analyses.get(namedFunction(file, caller))?.effects.failures.open).toBe(true)
    }
  })

  Test('does not exempt mutable or copied source or destination parameters', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func Mutable(mutable Items list of Book) -> list of Book { return Bridge(Items) }
      func Copied(copy Items list of Book) -> list of Book { return Bridge(Items) }
      func MutableTarget(mutable Items list of Book) -> list of Book { return Export(Items) from ./Native.ts }
      func CopiedTarget(copy Items list of Book) -> list of Book { return Export(Items) from ./Native.ts }
      func ToMutable(Items list of Book) -> list of Book { return MutableTarget(Items) }
      func ToCopied(Items list of Book) -> list of Book { return CopiedTarget(Items) }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const name of ['Mutable', 'Copied']) {
      Expect(snapshot.reads.get(argumentRead(namedFunction(file, name)))?.classification).toBe('reactive')
    }
    for (const name of ['ToMutable', 'ToCopied']) {
      Expect(snapshot.reads.get(argumentRead(namedFunction(file, name)))?.classification).toBe('unknown')
    }
  })

  Test('rejects entity/cardinality mismatch and incomplete argument binding', async () => {
    const file = await parse(`
      data Books / Book { Title text }
      data Notes / Note { Title text }
      func Bridge(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func WrongEntity(Items list of Note) -> list of Book { return Bridge(Items) }
      func WrongCardinality(Items Book) -> list of Book { return Bridge(Items) }
      func Incomplete(Items list of Book) -> list of Book { return Bridge(Items, "extra") }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    for (const name of ['WrongEntity', 'WrongCardinality', 'Incomplete']) {
      const reference = argumentRead(namedFunction(file, name))
      const call = reference.$container?.$container?.$container
      Expect.Is(call, AST.isFunctionCallExpression)
      Expect(snapshot.calls.get(call)?.kind).toBe('unknown')
      Expect(snapshot.reads.get(reference)?.classification).toBe('unknown')
    }
  })

  Test('leaves members, queries, state, aliases and action/view/default scopes outside transport', async () => {
    const file = await parse(`
      data Books / Book { Title text, Parent Book }
      view Shown(Value Book) {}
      func Bridge(Value Book) fails never -> Book { return Export(Value) from ./Native.ts }
      func BridgeMany(Items list of Book) fails never -> list of Book { return Export(Items) from ./Native.ts }
      func Member(Value Book) -> Book { return Bridge(Value.Parent) }
      action ActionValue(Value Book) -> Book { return Bridge(Value) }
      func Deferred(Value Book) -> action { return action { return Bridge(Value) } }
      func Defaults(Items list of Book, Other list of Book default BridgeMany(Items)) -> list of Book {
        return BridgeMany(Items)
      }
      view Scope(Value Book, Items list of Book) {
        state Current is Book = Value
        let Alias = Value
        query Found = Books
        func StateValue() -> Book { return Bridge(Current) }
        func AliasValue() -> Book { return Bridge(Alias) }
        func QueryValue() -> list of Book { return BridgeMany(Found) }
        render Shown(Bridge(Value))
      }
    `)
    const snapshot = publishCanonicalEffectSnapshot([file])
    const member = AST.streamAllContents(namedFunction(file, 'Member')).find(AST.isMemberAccessExpression)
    Expect.Is(member, AST.isMemberAccessExpression)
    Expect(snapshot.reads.get(member)?.classification).toBe('unknown')
    const action = file.statements.find(AST.isActionDeclaration)
    Expect.Is(action, AST.isActionDeclaration)
    Expect(snapshot.reads.get(argumentRead(action))?.classification).toBe('unknown')
    const deferred = namedFunction(file, 'Deferred')
    const deferredRead = argumentRead(deferred)
    Expect(deferredRead.target.ref).toBe(deferred.parameterList.parameters[0])
    Expect(snapshot.reads.get(deferredRead)?.classification).toBe('unknown')
    Expect(snapshot.reads.get(deferredRead)?.proof?.owner).toBe(deferred)
    const defaults = namedFunction(file, 'Defaults')
    const defaultValue = defaults.parameterList.parameters[1]?.defaultValue
    Expect.Is(defaultValue, AST.isFunctionCallExpression)
    const defaultRead = defaultValue.argumentList?.arguments[0]?.value
    Expect.Is(defaultRead, AST.isValueReference)
    Expect(snapshot.reads.get(defaultRead)?.classification).toBe('unknown')
    assertTransport(file, defaults, 'many', true)
    Expect(snapshot.reads.get(argumentRead(namedFunction(file, 'StateValue')))?.classification).toBe('reactive')
    const alias = argumentRead(namedFunction(file, 'AliasValue'))
    Expect(snapshot.reads.get(alias)?.proof?.kind).toBe('live-alias')
    Expect(snapshot.reads.get(alias)?.initializer).toBe(AST.streamAllContents(file).find(AST.isAliasDeclaration)?.value)
    const query = argumentRead(namedFunction(file, 'QueryValue'))
    Expect(snapshot.reads.get(query)?.classification).toBe('unknown')
    const view = file.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Scope')
    Expect.Is(view, AST.isViewDeclaration)
    const rendered = AST.streamAllContents(view).find(AST.isRender)
    Expect.Is(rendered, AST.isRender)
    Expect(snapshot.reads.get(argumentRead(rendered))?.classification).toBe('unknown')
  })
})

const closed = { purity: { violations: [], open: false }, failures: { cases: [], open: false } }

async function parse(source: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(source, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([])
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const owner = AST.streamAllContents(file).find(node => AST.isFunctionDeclaration(node) && node.name === name)
  Expect.Is(owner, AST.isFunctionDeclaration)
  return owner
}

function argumentRead(owner: AST.Node): AST.ValueReference {
  const reference = AST.streamAllContents(owner).find(node =>
    AST.isValueReference(node) && AST.isArgument(node.$container)
  )
  Expect.Is(reference, AST.isValueReference)
  return reference
}

function assertTransport(
  file: AST.TaoFile,
  owner: AST.FunctionDeclaration | AST.AssociatedFunctionDeclaration,
  cardinality: 'one' | 'many',
  bodyOnly = false,
): void {
  const reference = argumentRead(bodyOnly ? owner.block : owner)
  const argument = reference.$container
  Expect.Is(argument, AST.isArgument)
  const call = argument.$container?.$container
  Expect.Is(call, AST.isFunctionCallExpression)
  const snapshot = publishCanonicalEffectSnapshot([file])
  const publication = snapshot.calls.get(call)
  Expect(publication?.kind).toBe('complete')
  Expect(publication?.descriptor?.kind).toBe('source')
  const pair = publication?.pairs.find(pair => pair.argument === argument)
  const read = snapshot.reads.get(reference)
  Expect(read?.reference).toBe(reference)
  Expect(read?.classification).toBe('immutable')
  Expect(read?.kind).toBe('complete')
  const proof = read?.proof
  Expect(proof?.kind).toBe('source-call-entity-transport')
  if (proof?.kind === 'source-call-entity-transport') {
    Expect(proof.owner).toBe(owner)
    Expect(proof.call).toBe(call)
    Expect(proof.argument).toBe(argument)
    Expect(proof.sourceParameter).toBe(reference.target.ref)
    Expect(proof.target).toBe(publication?.target)
    Expect(proof.targetParameter).toBe(pair?.parameter)
    Expect(proof.entity).toBe(file.statements.find(AST.isEntityDataDeclaration))
    Expect(proof.cardinality).toBe(cardinality)
  }
}
