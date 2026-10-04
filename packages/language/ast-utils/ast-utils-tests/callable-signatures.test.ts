import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { resolveArgumentBindings } from '../ast-utils-src/argument-bindings'
import {
  bindCallableArguments,
  type CallableSignature,
  callableSignatureOf,
  compareCallableSignatures,
} from '../ast-utils-src/callable-signatures'
import { type TaoType, Type } from '../ast-utils-src/Type'

Describe('Concrete callable signature substitution', () => {
  Test('accepts an ancestor input domain and rejects narrowing to a descendant', async () => {
    const { Supplied, Required } = await signatures(`
      type Base is text
      type Leaf is Base
      view Supplied(Base) { }
      view Required(Leaf) { }
    `)
    const safe = compareCallableSignatures(Supplied, Required)
    Expect(safe.compatible).toBe(true)
    Expect(safe.correspondence.map(pair => pair.supplied.localName)).toEqual(['Base'])
    const unsafe = compareCallableSignatures(Required, Supplied)
    Expect(unsafe.compatible).toBe(false)
    Expect(unsafe.correspondence).toHaveLength(0)
  })

  Test('maps repeated primitive roles in implementation order without positional ties', async () => {
    const { Supplied, Required } = await signatures(`
      view Supplied(Second text, First text) { }
      view Required(First text, Second text) { }
    `)
    const result = compareCallableSignatures(Supplied, Required)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(result.correspondence.map(pair => [pair.required.role, pair.supplied.role])).toEqual([
      ['Second', 'Second'],
      ['First', 'First'],
    ])
  })

  Test('keeps a directed public role from falling back to another same-type input', async () => {
    const { Supplied, Required } = await signatures(`
      view Supplied(Wrong text) { }
      view Required(Value text) { }
    `)
    const result = compareCallableSignatures(Supplied, Required)
    Expect(result.compatible).toBe(false)
    Expect(result.correspondence).toHaveLength(0)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unknown-named', 'missing'])
  })

  Test('keeps Book role and public label separate from the Entry binder alias', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      type Occurrence is number
      view Supplied(Occurrence, Entry Book) { }
      view Required(Book, Occurrence) { }
    `)
    const supplied: CallableSignature = {
      ...Supplied,
      inputs: Supplied.inputs.map(input => ({
        ...input,
        role: input.localName === 'Entry' ? 'Book' : 'Occurrence',
        labelName: input.localName === 'Entry' ? 'Book' : 'Occurrence',
      })),
    }
    const required: CallableSignature = {
      ...Required,
      inputs: Required.inputs.map(input => ({ ...input, role: input.labelName })),
    }
    const result = compareCallableSignatures(supplied, required)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(result.correspondence.map(pair => [pair.required.role, pair.supplied.localName])).toEqual([
      ['Occurrence', 'Occurrence'],
      ['Book', 'Entry'],
    ])
    Expect(Type.identityKey(supplied.inputs[1]!.type)).toBe(Type.identityKey(required.inputs[0]!.type))

    const parsed = await Parser.parseCode(`
      type Book is text
      type Occurrence is number
      view Main() { render Target(Book: Book "Ada", Occurrence: Occurrence 1) }
      view Target(Occurrence, Entry Book) { }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, 0)
    Expect.Is(render, AST.isRenderStatement)
    const target = render.view?.ref
    Expect.Is(target, AST.isViewDeclaration)
    const targetSignature = callableSignatureOf(target)
    const aliased: CallableSignature = {
      ...targetSignature,
      inputs: targetSignature.inputs.map(input => ({
        ...input,
        labelName: input.localName === 'Entry' ? 'Book' : input.labelName,
      })),
    }
    const binding = bindCallableArguments(aliased, AST.argumentsOf(render))
    Expect(binding.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(binding.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Occurrence', 'Entry'])
  })

  Test('rejects repeated undirected nominal domains as ambiguous', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied(First Book, Second Book) { }
      view Required(First Book, Second Book) { }
    `)
    const undirected = { ...Required, inputs: Required.inputs.map(input => ({ ...input, role: undefined })) }
    const result = compareCallableSignatures(Supplied, undirected)
    Expect(result.compatible).toBe(false)
    Expect(result.correspondence).toHaveLength(0)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toContain('duplicate-candidate-type')
  })

  Test('preserves receiving omission and nominal domain when a binder changes the declaration anchor', async () => {
    const parsed = await Parser.parseCode(`
      type Book is text
      type Magazine is text
      view Original(Value Book default Book "default") { }
      view Alias(Entry Magazine) { }
      view Main() {
        render Alias(Value: Book "accepted")
        render Alias(Value: Magazine "rejected")
      }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const views = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    const original = views.find(view => view.name === 'Original')
    const alias = views.find(view => view.name === 'Alias')
    const main = views.find(view => view.name === 'Main')
    Expect.Is(original, AST.isViewDeclaration)
    Expect.Is(alias, AST.isViewDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    const receiving = callableSignatureOf(original)
    const aliasInput = callableSignatureOf(alias).inputs[0]!
    const adapted: CallableSignature = {
      ...receiving,
      inputs: receiving.inputs.map(input => ({ ...input, declaration: aliasInput.declaration, localName: 'Entry' })),
    }
    Expect(bindCallableArguments(adapted, []).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    const accepted = AST.blockStatementOf(main, 0)
    const rejected = AST.blockStatementOf(main, 1)
    Expect.Is(accepted, AST.isRenderStatement)
    Expect.Is(rejected, AST.isRenderStatement)
    const safe = bindCallableArguments(adapted, AST.argumentsOf(accepted))
    Expect(safe.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(safe.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Entry'])
    const unsafe = bindCallableArguments(adapted, AST.argumentsOf(rejected))
    Expect(unsafe.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['named-argument-type'])
  })

  Test(
    'rejects an unresolved required domain even when an empty implementation produces no legacy diagnostics',
    async () => {
      const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied() { }
      view Required(Book) { }
    `)
      const unresolved: CallableSignature = {
        ...Required,
        inputs: Required.inputs.map(input => ({ ...input, type: { kind: 'unresolved' } })),
      }
      const result = compareCallableSignatures(Supplied, unresolved)
      Expect(result.compatible).toBe(false)
      Expect(result.correspondence).toHaveLength(0)
      Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unresolved-input'])
    },
  )

  Test('rejects unresolved nested domains and unresolved omissible implementation inputs', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied() { }
      view Required(Book) { }
    `)
    const domains: TaoType[] = [
      { kind: 'list', element: { kind: 'unresolved' } },
      { kind: 'union', members: [Required.inputs[0]!.type, { kind: 'unresolved' }] },
      {
        kind: 'primitive',
        primitive: 'action',
        parameters: [{ type: { kind: 'unresolved' }, optional: false, writable: false }],
      },
    ]
    for (const type of domains) {
      const unknown: CallableSignature = {
        ...Required,
        inputs: Required.inputs.map(input => ({ ...input, type, omissible: true })),
      }
      const caller = compareCallableSignatures(Supplied, unknown)
      Expect(caller.compatible).toBe(false)
      Expect(caller.correspondence).toHaveLength(0)
      Expect(caller.diagnostics.map(diagnostic => diagnostic.kind)).toContain('unresolved-input')
      Expect(
        caller.diagnostics.filter(diagnostic => diagnostic.kind === 'unresolved-input').map(diagnostic =>
          diagnostic.side
        ),
      )
        .toEqual(['required'])
      const implementation = compareCallableSignatures(unknown, Supplied)
      Expect(implementation.compatible).toBe(false)
      Expect(
        implementation.diagnostics.filter(diagnostic => diagnostic.kind === 'unresolved-input').map(diagnostic =>
          diagnostic.side
        ),
      )
        .toEqual(['supplied'])
    }
  })

  Test('rejects a missing accepted input and an extra required implementation input', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      type Count is number
      view Supplied(Book, Count) { }
      view Required(Book) { }
    `)
    Expect(compareCallableSignatures(Supplied, Required).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'missing',
    ])
    Expect(compareCallableSignatures(Required, Supplied).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'unmatched',
    ])
  })

  Test('allows extra defaulted implementation inputs without skipping contract correspondence', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      type Count is number
      view Supplied(Book, Count default Count 1) { }
      view Required(Book) { }
    `)
    const result = compareCallableSignatures(Supplied, Required)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(result.correspondence.map(pair => pair.supplied.localName)).toEqual(['Book'])
    Expect(compareCallableSignatures(Required, Supplied).compatible).toBe(false)
  })

  Test('checks omission per role rather than by the total number of defaults', async () => {
    const { Supplied, Required } = await signatures(`
      view Supplied(First text, Second text default "second") { }
      view Required(First text default "first", Second text) { }
    `)
    const result = compareCallableSignatures(Supplied, Required)
    Expect(result.compatible).toBe(false)
    const diagnostic = result.diagnostics.find(item => item.kind === 'incompatible-input')
    Expect(diagnostic?.kind).toBe('incompatible-input')
    if (diagnostic?.kind === 'incompatible-input') {
      Expect(diagnostic.reasons).toEqual(['omission'])
    }
    Expect(result.correspondence.map(pair => pair.supplied.role)).toEqual(['Second'])
  })

  Test('distinguishes none in the value domain from argument omission', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied(Book?) { }
      view Required(Book? default none) { }
    `)
    Expect(Supplied.inputs[0]!.acceptsNone).toBe(true)
    Expect(Supplied.inputs[0]!.omissible).toBe(false)
    Expect(Required.inputs[0]!.acceptsNone).toBe(true)
    Expect(Required.inputs[0]!.omissible).toBe(true)
    Expect(compareCallableSignatures(Supplied, Required).compatible).toBe(false)
    Expect(compareCallableSignatures(Required, Supplied).compatible).toBe(true)
    const missing = bindCallableArguments(Supplied, [])
    Expect(missing.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['missing-argument'])
    Expect(bindCallableArguments(Required, []).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
  })

  Test('rejects a renderer requiring shared writes from a readonly receiving role', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied(mutable Book) { }
      view Required(Book) { }
    `)
    Expect(Supplied.inputs[0]!.callerWritable).toBe(true)
    Expect(compareCallableSignatures(Supplied, Required).compatible).toBe(false)
    Expect(compareCallableSignatures(Required, Supplied).compatible).toBe(true)
  })

  Test('requires invariant shared write domains while allowing copied local mutation', async () => {
    const { Supplied, Required, get } = await signatures(`
      type Base is text
      type Leaf is Base
      view Supplied(mutable Value Base) { }
      view Required(mutable Value Leaf) { }
      view Copied(copy Value Base) { action Change() { set Value = Base "changed" } }
    `)
    const Copied = get('Copied')
    const unsafe = compareCallableSignatures(Supplied, Required)
    Expect(
      unsafe.diagnostics.map(diagnostic =>
        diagnostic.kind === 'incompatible-input' ? diagnostic.reasons : diagnostic.kind
      ),
    ).toEqual([['write-domain']])
    Expect(compareCallableSignatures(Required, Required).compatible).toBe(true)
    Expect(Copied.inputs[0]!.callerWritable).toBe(false)
    Expect(compareCallableSignatures(Copied, Required).compatible).toBe(true)
  })

  Test('removes an unsafe exact edge before selecting a safe compatible alternative', async () => {
    const { Supplied, Required } = await signatures(`
      type Base is text
      type Leaf is Base
      view Supplied(mutable Leaf default Leaf "x", Base) { }
      view Required(Leaf) { }
    `)
    const result = compareCallableSignatures(Supplied, Required)
    Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(result.correspondence.map(pair => pair.supplied.localName)).toEqual(['Base'])
  })

  Test('extracts inferred writable forwarding without recursing through signature extraction', async () => {
    const { Supplied, Required } = await signatures(`
      type Book is text
      view Supplied(Book) { render Child(Book) }
      view Child(mutable Book) { }
      view Required(Book) { }
    `)
    Expect(Supplied.inputs[0]!.callerWritable).toBe(true)
    Expect(compareCallableSignatures(Supplied, Required).compatible).toBe(false)
  })

  Test('preserves named list elements when extracting primitive and list role domains', async () => {
    const { Supplied, Required, get } = await signatures(`
      type Base is text
      type Leaf is Base
      view Supplied(Values list of Base, Caption text?) { }
      view Required(Values list of Leaf, Caption text) { }
      view Narrow(Values list of Leaf, Caption text) { }
    `)
    const Narrow = get('Narrow')
    Expect(Supplied.inputs[1]!.acceptsNone).toBe(true)
    Expect(Supplied.inputs[1]!.omissible).toBe(false)
    Expect(compareCallableSignatures(Supplied, Required).compatible).toBe(true)
    Expect(compareCallableSignatures(Narrow, Supplied).compatible).toBe(false)
  })

  Test('uses known and open failure bounds in the supplied-to-required direction', async () => {
    const { Supplied, Required } = await signatures('view Supplied() { } view Required() { }')
    Expect(Supplied.failures).toEqual({ cases: [], open: true })
    const narrow = { ...Supplied, failures: { cases: ['Missing'], open: false } }
    const broad = { ...Required, failures: { cases: ['Missing', 'Denied'], open: false } }
    Expect(compareCallableSignatures(narrow, broad).compatible).toBe(true)
    Expect(compareCallableSignatures(broad, narrow).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'failure-bound',
    ])
    Expect(compareCallableSignatures(Supplied, narrow).compatible).toBe(false)
    Expect(compareCallableSignatures(narrow, Required).compatible).toBe(true)
    Expect(compareCallableSignatures({ ...Supplied, failures: { cases: [], open: false } }, narrow).compatible).toBe(
      true,
    )
  })

  Test('preserves ordinary pairs and diagnostics through the params-and-arguments core', async () => {
    const parsed = await Parser.parseCode(`
      view Main() { render Tile(1, "Open", Extra: 2) }
      view Tile(Title text, Count number, Hint text default "hint") { }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    const render = AST.blockStatementOf(main, 0)
    Expect.Is(render, AST.isRenderStatement)
    const target = render.view?.ref
    Expect.Is(target, AST.isViewDeclaration)
    const legacy = resolveArgumentBindings(target, render)
    const adapted = bindCallableArguments(callableSignatureOf(target), AST.argumentsOf(render))
    Expect(legacy.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Title', 'Count'])
    Expect(legacy.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unknown-named-argument'])
    Expect(adapted.pairs.map(pair => [pair.argument.label, Type.parameterName(pair.parameter)])).toEqual([
      [undefined, 'Title'],
      [undefined, 'Count'],
    ])
    Expect(adapted.diagnostics.map(diagnostic => diagnostic.kind)).toEqual(['unknown-named-argument'])
  })
})

async function signatures(source: string): Promise<{
  Supplied: CallableSignature
  Required: CallableSignature
  get(name: string): CallableSignature
}> {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics).toEqual([])
  const byName = new Map(
    parsed.entry.ast.statements.filter(AST.isViewDeclaration).map(view =>
      [
        view.name,
        callableSignatureOf(view),
      ] as const
    ),
  )
  const get = (name: string): CallableSignature => {
    const signature = byName.get(name)
    Assert.defined(signature, `Expected callable fixture ${name}.`)
    return signature
  }
  return { Supplied: get('Supplied'), Required: get('Required'), get }
}
