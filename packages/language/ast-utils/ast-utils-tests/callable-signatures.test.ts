import { ASTUtils, Packages } from '@ast-utils'
import { AST, Parser, URI } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { resolveArgumentBindings, resolveParameterArgumentBindings } from '../ast-utils-src/argument-bindings'
import {
  bindCallableArguments,
  type CallableSignature,
  callableSignatureOf,
  type CallableSignatureResolution,
  compareCallableSignatures,
} from '../ast-utils-src/callable-signatures'
import { type TaoType, Type } from '../ast-utils-src/Type'
import { resolveBindings } from '../ast-utils-src/type-binding-matches'

Describe('Concrete callable signature substitution', () => {
  Test('binds real call arguments with the contract-stage relation before effect admission', async () => {
    const parsed = await Parser.parseCode('view Target(Value number) { } view Main() { render Target(1) }')
    Expect(parsed.diagnostics).toEqual([])
    const target = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Target'
    )
    const main = parsed.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'Main'
    )
    Expect.Is(target, AST.isViewDeclaration)
    Expect.Is(main, AST.isViewDeclaration)
    const call = AST.blockStatementOf(main, 0)
    Expect.Is(call, AST.isRenderStatement)
    const parameters = AST.parametersOf(target)
    const arguments_ = AST.argumentsOf(call)
    const number: TaoType = { kind: 'primitive', primitive: 'number' }
    const text: TaoType = { kind: 'primitive', primitive: 'text' }
    const denied = resolveParameterArgumentBindings(parameters, arguments_, { accepts: () => false })
    Expect(denied.pairs).toEqual([])
    const admitted = resolveParameterArgumentBindings(parameters, arguments_, {
      parameterType: () => number,
      argumentType: () => text,
      accepts: () => true,
    })
    Expect(admitted.diagnostics).toEqual([])
    Expect(admitted.pairs).toHaveLength(1)
    Expect(admitted.pairs[0]!.parameter === parameters[0]).toBe(true)
    Expect(admitted.pairs[0]!.argument === arguments_[0]).toBe(true)
  })

  Test('uses guarded contract resolution and final admission without substituting default relations', async () => {
    const parsed = await Parser.parseCode('view Target(Entry text?) { }')
    Expect(parsed.diagnostics).toEqual([])
    const view = parsed.entry.ast.statements.find(AST.isViewDeclaration)
    Assert.defined(view, 'the guarded contract fixture has its real parameter owner')
    const domain: TaoType = { kind: 'primitive', primitive: 'number' }
    const resolved: AST.ParameterDeclaration[] = []
    const acceptanceCalls: [TaoType, TaoType][] = []
    const resolution: CallableSignatureResolution = {
      inputDomain: parameter => {
        resolved.push(parameter)
        return domain
      },
      accepts: (actual, expected) => {
        acceptanceCalls.push([actual, expected])
        return true
      },
    }
    const signature = callableSignatureOf(AST.parametersOf(view), { cases: [], open: false }, resolution)
    Expect(resolved).toHaveLength(1)
    Expect(resolved[0] === AST.parametersOf(view)[0]).toBe(true)
    Expect(signature.inputs[0]!.type).toBe(domain)
    Expect(signature.inputs[0]!.acceptsNone).toBe(true)
    Expect(Type.isAssignable(Type.ofNone(), domain)).toBe(false)
    Expect(acceptanceCalls).toEqual([[Type.ofNone(), domain]])
    Expect(compareCallableSignatures(signature, signature).compatible).toBe(true)
    const rejected = compareCallableSignatures(signature, signature, () => false)
    Expect(rejected.compatible).toBe(false)
    Expect(rejected.correspondence).toEqual([])
    Expect(rejected.diagnostics.length).toBeGreaterThan(0)
    const required = {
      ...signature,
      inputs: signature.inputs.map(input => ({ ...input, role: undefined, labelName: 'Required' })),
    }
    const supplied = {
      ...signature,
      inputs: signature.inputs.map(input => ({
        ...input,
        role: undefined,
        labelName: 'Supplied',
        type: { kind: 'primitive', primitive: 'text' } as TaoType,
      })),
    }
    Expect(compareCallableSignatures(supplied, required).compatible).toBe(false)
    Expect(compareCallableSignatures(supplied, required, () => true).compatible).toBe(true)
  })

  Test('retains owned parameter metadata and writable forwarding through readonly arrays', async () => {
    const { Supplied } = await signatures(`
      type Book is text
      view Supplied(mutable Value Book, Entry Book default Book "fallback", Caption text?, copy Count number, Values list of Book, Forwarded Book) {
        render Child(Forwarded)
      }
      view Child(mutable Book) { }
      view Required() { }
    `)
    const parameters: readonly AST.ParameterDeclaration[] = Supplied.inputs.map(input => input.declaration).toReversed()
    const failures = { cases: ['Missing'], open: false }
    const fromArray = ASTUtils.callableSignatureOf(parameters, failures)
    Expect(inputMetadata(fromArray)).toEqual(inputMetadata(Supplied).toReversed())
    Expect(fromArray.inputs.every((input, index) => input.declaration === parameters[index])).toBe(true)
    Expect(fromArray.inputs.map(input => [input.localName, input.acceptsNone, input.omissible, input.callerWritable]))
      .toEqual([
        ['Forwarded', false, false, true],
        ['Values', false, false, false],
        ['Count', false, false, false],
        ['Caption', true, false, false],
        ['Entry', false, true, false],
        ['Value', false, false, true],
      ])
    Expect(fromArray.failures === failures).toBe(true)
    Expect(ASTUtils.callableSignatureOf(parameters).failures).toEqual({ cases: [], open: true })
    const empty = ASTUtils.callableSignatureOf([])
    Expect(empty.inputs).toHaveLength(0)
    Expect(compareCallableSignatures(empty, { ...empty, failures }).compatible).toBe(false)
  })

  Test('forwards renamed array binders using receiving labels, defaults and storage contracts', async () => {
    const parsed = await Parser.parseCode(`
      type Base is text
      type Leaf is Base
      type Other is text
      type Occurrence is number
      view Supplied(Occurrence, Value Base default Base "fallback") { }
      view Required(Value Leaf default Leaf "fallback", Occurrence) { }
      view Writer(Occurrence, mutable Value Base default Base "fallback") { }
      view Copied(Occurrence, copy Value Base default Base "fallback") { }
      view Main() {
        render Supplied(Occurrence 1)
        render Supplied(Value: Leaf "provided", Occurrence: Occurrence 1)
        render Supplied(Value: Other "rejected", Occurrence: Occurrence 1)
      }
    `)
    Expect(parsed.diagnostics).toEqual([])
    const views = parsed.entry.ast.statements.filter(AST.isViewDeclaration)
    const arraySignature = (name: string): CallableSignature => {
      const view = views.find(candidate => candidate.name === name)
      Expect.Is(view, AST.isViewDeclaration)
      return ASTUtils.callableSignatureOf(AST.parametersOf(view), { cases: ['Missing'], open: false })
    }
    const supplied = arraySignature('Supplied')
    const receiving = arraySignature('Required')
    const aliased: CallableSignature = {
      ...supplied,
      inputs: supplied.inputs.map(input => ({
        ...input,
        localName: input.role === 'Value' ? 'Entry' : input.localName,
      })),
    }
    const comparison = compareCallableSignatures(aliased, receiving)
    Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(comparison.correspondence.map(pair => [pair.required.localName, pair.supplied.localName])).toEqual([
      ['Occurrence', 'Occurrence'],
      ['Value', 'Entry'],
    ])
    Expect(aliased.inputs[1]!.declaration === supplied.inputs[1]!.declaration).toBe(true)
    Expect(aliased.inputs[1]!.labelName).toBe('Value')
    Expect(compareCallableSignatures(arraySignature('Writer'), receiving).compatible).toBe(false)
    Expect(compareCallableSignatures(arraySignature('Copied'), receiving).compatible).toBe(true)
    const main = views.find(view => view.name === 'Main')
    Expect.Is(main, AST.isViewDeclaration)
    const bindings = [0, 1, 2].map(index => {
      const render = AST.blockStatementOf(main, index)
      Expect.Is(render, AST.isRenderStatement)
      return bindCallableArguments(aliased, AST.argumentsOf(render))
    })
    Expect(bindings.map(binding => binding.diagnostics.map(diagnostic => diagnostic.kind))).toEqual([
      [],
      [],
      ['named-argument-type'],
    ])
    Expect(bindings[0]!.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Occurrence'])
    Expect(bindings[1]!.pairs.map(pair => [pair.argument.label, Type.parameterName(pair.parameter)])).toEqual([
      ['Occurrence', 'Occurrence'],
      ['Value', 'Value'],
    ])
    Expect(bindings[1]!.pairs[1]!.parameter === supplied.inputs[1]!.declaration).toBe(true)
    Expect(compareCallableSignatures({ ...aliased, failures: { cases: [], open: true } }, receiving).compatible).toBe(
      false,
    )
  })

  Test('keeps complete correspondence and real ambiguity for array signatures', async () => {
    const { Supplied, Required, get } = await signatures(`
      type Base is text
      type Leaf is Base
      type Book is text
      view Supplied(Leaf default Leaf "fallback", Base) { }
      view Required(Leaf) { }
      view Repeated(First Book, Second Book) { }
    `)
    const fromArray = (signature: CallableSignature): CallableSignature =>
      ASTUtils.callableSignatureOf(signature.inputs.map(input => input.declaration))
    const complete = compareCallableSignatures(fromArray(Supplied), fromArray(Required))
    Expect(complete.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    Expect(complete.correspondence.map(pair => pair.supplied.localName)).toEqual(['Base'])
    const repeated = fromArray(get('Repeated'))
    const ambiguous = compareCallableSignatures(repeated, {
      ...repeated,
      inputs: repeated.inputs.map(input => ({ ...input, role: undefined })),
    })
    Expect(ambiguous.compatible).toBe(false)
    Expect(ambiguous.correspondence).toHaveLength(0)
    Expect(ambiguous.diagnostics.map(diagnostic => diagnostic.kind)).toContain('duplicate-candidate-type')
  })

  Test('keeps the view-alias route tied to the real target parameter list', async () => {
    await withTaoFiles('tao-callable-alias-', {
      'Main.tao': `
        package { version 1.0.0 includes @widgets }
        use package @widgets
        view Renamed = widgets.Badge
      `,
      '@widgets/Badge.tao': 'public view Badge(Value text default "fallback") { }',
    }, async (paths, rootDir) => {
      const packages = Packages.createResolver(await Packages.createContext(rootDir))
      const parsed = await Parser.parse(Parser.createContext({ packages }), URI.file(paths['Main.tao']))
      Expect(parsed.diagnostics).toEqual([])
      const alias = parsed.entry.ast.statements.find(AST.isViewDeclaration)
      Expect.Is(alias, AST.isViewDeclaration)
      Expect.Is(alias.aliasTarget, AST.isPackageMemberReference)
      const target = alias.aliasTarget.member.ref
      Expect.Is(target, AST.isViewDeclaration)
      Expect(alias.parameterList === undefined).toBe(true)
      const view = ASTUtils.callableSignatureOf(alias)
      const array = ASTUtils.callableSignatureOf(AST.parametersOf(target))
      Expect(inputMetadata(view)).toEqual(inputMetadata(array))
      Expect(view.inputs).toHaveLength(1)
      Expect(view.inputs[0]!.declaration === array.inputs[0]!.declaration).toBe(true)
      Expect(bindCallableArguments(view, []).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
    }, { location: 'worktree' })
  })

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

  Test('leaves an exact default unused when forwarding must fill an ancestor input', async () => {
    for (const parameters of ['Leaf default Leaf "x", Base', 'Base, Leaf default Leaf "x"']) {
      const source = `
        type Base is text
        type Leaf is Base
        view Supplied(${parameters}) { }
        view Required(Leaf) { }
        view Main() { render Supplied(Leaf "provided") }
      `
      const { Supplied, Required } = await signatures(source)
      const comparison = compareCallableSignatures(Supplied, Required)
      Expect(comparison.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(comparison.correspondence.map(pair => [pair.required.localName, pair.supplied.localName])).toEqual([
        ['Leaf', 'Base'],
      ])
      const parsed = await Parser.parseCode(source)
      Expect(parsed.diagnostics).toEqual([])
      const main = parsed.entry.ast.statements.find(node => AST.isViewDeclaration(node) && node.name === 'Main')
      Expect.Is(main, AST.isViewDeclaration)
      const render = AST.blockStatementOf(main, 0)
      Expect.Is(render, AST.isRenderStatement)
      const target = render.view?.ref
      Expect.Is(target, AST.isViewDeclaration)
      const ordinary = bindCallableArguments(callableSignatureOf(target), AST.argumentsOf(render))
      Expect(ordinary.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(ordinary.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Base'])
    }
  })

  Test('uses optional inputs to complete correspondence before preferring exact edges', async () => {
    for (const parameters of ['Base, Leaf default Leaf "x"', 'Leaf default Leaf "x", Base']) {
      const { Supplied, Required } = await signatures(`
        type Base is text
        type Leaf is Base
        view Supplied(${parameters}) { }
        view Required(Leaf, Base) { }
      `)
      const result = compareCallableSignatures(Supplied, Required)
      Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(result.correspondence.map(pair => [pair.required.localName, pair.supplied.localName])).toEqual(
        Supplied.inputs.map(input => [input.localName, input.localName]),
      )
    }
  })

  Test('prefers exact edges among complete assignments without using declaration order', async () => {
    for (const parameters of ['Base, Leaf default Leaf "x"', 'Leaf default Leaf "x", Base']) {
      const { Supplied, Required } = await signatures(`
        type Base is text
        type Leaf is Base
        type Twig is Leaf
        view Supplied(${parameters}) { }
        view Required(Leaf, Twig) { }
      `)
      const result = compareCallableSignatures(Supplied, Required)
      Expect(result.diagnostics.map(diagnostic => diagnostic.kind)).toEqual([])
      Expect(result.correspondence.map(pair => [pair.required.localName, pair.supplied.localName])).toEqual(
        Supplied.inputs.map(input => [input.localName === 'Base' ? 'Twig' : 'Leaf', input.localName]),
      )
    }
  })

  Test('retains ambiguity when individually feasible exact edges cannot coexist', async () => {
    const { Supplied, Required } = await signatures(`
      type X is text
      type Y is text
      type Z is text
      type Mandatory is text
      view Supplied(X default X "x", Y default Y "y", Mandatory) { }
      view Required(X, Y, Z) { }
    `)
    for (const candidates of [Required.inputs, Required.inputs.toReversed()]) {
      for (const targets of [Supplied.inputs, Supplied.inputs.toReversed()]) {
        const result = resolveBindings({
          candidates,
          targets,
          candidateLabel: () => undefined,
          targetName: input => input.localName,
          candidateType: input => input.type,
          targetType: input => input.type,
          namedTypeAccepts: () => true,
          compatibleTypeAccepts: () => true,
          pairAccepts: (candidate, target) =>
            ({
              X: ['X', 'Mandatory'],
              Y: ['Y', 'Mandatory'],
              Z: ['X', 'Y'],
            })[candidate.localName as 'X' | 'Y' | 'Z'].includes(target.localName),
          targetRequiresValue: input => !input.omissible,
          completeCorrespondence: true,
          unresolvedCandidatesExcuseMissing: false,
        })
        Expect(result.pairs).toHaveLength(0)
        Expect(result.diagnostics.some(diagnostic => diagnostic.kind === 'ambiguous-candidate')).toBe(true)
      }
    }
  })

  Test('agrees with enumerated complete assignments across small admission graphs', async () => {
    const { Supplied, Required } = await signatures(`
      type X is text
      type Y is text
      type Z is text
      view Supplied(X, Y, Z) { }
      view Required(X, Y, Z) { }
    `)
    for (let count = 1; count <= 3; count++) {
      const candidates = Required.inputs.slice(0, count)
      // With three candidates every target is filled, so varying mandatory targets adds no cases.
      const mandatoryMasks = count === 3 ? [7] : Array.from({ length: 8 }, (_, mask) => mask)
      for (let graph = 0; graph < 2 ** (count * 3); graph++) {
        const admits = (row: number, column: number): boolean => (graph & (1 << (row * 3 + column))) !== 0
        for (const mandatory of mandatoryMasks) {
          const assignments: number[][] = []
          const enumerate = (columns: number[]): void => {
            if (columns.length === count) {
              if ([0, 1, 2].every(column => !(mandatory & (1 << column)) || columns.includes(column))) {
                assignments.push(columns)
              }
              return
            }
            for (const column of [0, 1, 2]) {
              if (!columns.includes(column) && admits(columns.length, column)) {
                enumerate([...columns, column])
              }
            }
          }
          enumerate([])
          const exactCount = (columns: number[]): number => columns.filter((column, row) => column === row).length
          const best = assignments.filter(columns => exactCount(columns) === Math.max(...assignments.map(exactCount)))
          const result = resolveBindings({
            candidates,
            targets: Supplied.inputs,
            candidateLabel: () => undefined,
            targetName: input => input.localName,
            candidateType: input => input.type,
            targetType: input => input.type,
            namedTypeAccepts: () => true,
            compatibleTypeAccepts: () => true,
            pairAccepts: (candidate, target) => admits(candidates.indexOf(candidate), Supplied.inputs.indexOf(target)),
            targetRequiresValue: target => (mandatory & (1 << Supplied.inputs.indexOf(target))) !== 0,
            completeCorrespondence: true,
            unresolvedCandidatesExcuseMissing: false,
          })
          if (best.length === 0) {
            Expect(result.diagnostics.length > 0).toBe(true)
            continue
          }
          const forced = best[0]!.flatMap((column, row) =>
            best.every(columns => columns[row] === column) ? [`${row}:${column}`] : []
          ).toSorted()
          Expect(
            result.pairs.map(([candidate, target]) =>
              `${candidates.indexOf(candidate)}:${Supplied.inputs.indexOf(target)}`
            ).toSorted(),
          ).toEqual(forced)
          Expect(result.diagnostics.length === 0).toBe(best.length === 1)
        }
      }
    }
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

function inputMetadata(signature: CallableSignature): unknown[] {
  return signature.inputs.map(input => ({
    role: input.role,
    labelName: input.labelName,
    localName: input.localName,
    type: Type.identityKey(input.type),
    acceptsNone: input.acceptsNone,
    omissible: input.omissible,
    callerWritable: input.callerWritable,
  }))
}

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
