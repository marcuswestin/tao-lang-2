import { AST, Parser } from '@parser'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  type CallableEffectFactInputs,
  discoverCallableEffectFacts,
  type NativeEffectPublication,
  type ResolvedCallExecution,
} from '../ast-utils-src/callable-effect-facts'
import { analyzeCallableEffects } from '../ast-utils-src/callable-effects'

Describe('Published source callable effect discovery', () => {
  Test('transfers a native invocation at a real do anchor without executing its distinct origin', async () => {
    const parsed = await parse(`
      view Main {
        let Bridge is action(number) = Initializer()
        action Root() { do Bridge(Argument()) }
      }
      function Initializer() { return 1 }
      function Argument(Value number default Default()) returns number { return 2 }
      function Default() returns number { return 3 }
      function Origin() { return 4 }
    `)
    const root = AST.streamAllContents(parsed).find(node => AST.isActionDeclaration(node) && node.name === 'Root')
    Expect.Is(root, AST.isActionDeclaration)
    const site = root.block!.statements[0]!
    Expect.Is(site, AST.isDoStatement)
    const alias = AST.streamAllContents(parsed).find(node => AST.isAliasDeclaration(node) && node.name === 'Bridge')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    const argument = site.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isFunctionCallExpression)
    const argumentTarget = namedFunction(parsed, 'Argument')
    const parameter = argumentTarget.parameterList.parameters[0]!
    const selected = parameter.defaultValue!
    Expect.Is(selected, AST.isFunctionCallExpression)
    const origin = returned(namedFunction(parsed, 'Origin'))
    const native: NativeEffectPublication = {
      phase: 'invocation',
      declaration: site,
      exportSource: origin,
      kind: 'complete',
      purity: { violations: ['suspend'], open: false },
      failures: { cases: ['NativeFailed'], open: false },
    }
    const operandCalls = [
      call(alias.value, namedFunction(parsed, 'Initializer'), {
        contract: { purity: { violations: ['io'], open: false }, failures: { cases: ['ReadFailed'], open: false } },
      }),
      call(argument, argumentTarget, {
        defaults: [{ parameter, expression: selected }],
        contract: { purity: { violations: [], open: false }, failures: { cases: ['ArgumentFailed'], open: false } },
      }),
      call(selected, namedFunction(parsed, 'Default'), {
        contract: { purity: { violations: [], open: false }, failures: { cases: ['DefaultFailed'], open: false } },
      }),
    ]
    for (const unknown of [false, true]) {
      const publication: NativeEffectPublication = unknown
        ? { ...native, kind: 'unknown', reason: 'unclassified-native' }
        : native
      for (const mode of ['unhandled', 'handled', 'scheduled'] as const) {
        const operation: ResolvedCallExecution = {
          site,
          operation: mode === 'scheduled' ? 'schedule' : 'action',
          kind: 'complete',
          pairs: [],
          defaults: [],
          ...(mode === 'handled' ? { failureTransfer: { handlesAll: true } } : {}),
        }
        const inputs: CallableEffectFactInputs = {
          calls: [operation, ...operandCalls],
          reads: [{ reference: site.action, initializer: alias.value, classification: 'reactive', kind: 'complete' }],
          natives: [publication],
        }
        const facts = discoverCallableEffectFacts(root, inputs)
        const result = analyzeCallableEffects(root, facts)
        Expect(new Set(result.effects.purity.violations)).toEqual(
          new Set(['action', 'suspend', 'reactive-state', 'io']),
        )
        Expect(result.effects.purity.open).toBe(unknown)
        Expect(new Set(result.effects.failures.cases)).toEqual(
          new Set([
            'ReadFailed',
            'ArgumentFailed',
            'DefaultFailed',
            ...(mode === 'unhandled' ? ['NativeFailed'] : []),
          ]),
        )
        Expect(result.effects.failures.open).toBe(unknown && mode === 'unhandled')
        Expect(facts.some(fact => fact.node === origin)).toBe(false)
        Expect(facts.find(fact => fact.node === site)!.executes.some(edge => edge.target === site)).toBe(false)
      }
    }
  })

  Test('executes a computed read receiver independently of its complete immutable read facet', async () => {
    const parsed = await parse('function Root() { return (Source()).Result } function Source() { return 1 }')
    const root = namedFunction(parsed, 'Root')
    const source = namedFunction(parsed, 'Source')
    const reference = returned(root)
    Expect.Is(reference, AST.isPostfixMemberAccess)
    Expect.Is(reference.receiver, AST.isFunctionCallExpression)
    const inputs: CallableEffectFactInputs = {
      calls: [call(reference.receiver, source, {
        contract: {
          purity: { violations: ['io'], open: false },
          failures: { cases: ['Denied'], open: false },
        },
      })],
      reads: [{ reference, classification: 'immutable', kind: 'complete' }],
      natives: [],
    }
    const result = analyze(root, inputs)
    Expect(result.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(result.findings.some(finding =>
      finding.kind === 'violation' && finding.node === source
      && finding.path.some(edge => edge.site === reference && edge.target === reference.receiver)
    )).toBe(true)
  })

  Test('keeps native callable-value contracts latent and transfers only their invocation failures', async () => {
    const parsed = await parse(`
      view Main {
        let Native is action(text) = OpenUrl from ./Native.ts
        function Carry() { return Native }
        action Root() { do Native(Argument()) }
      }
      function Argument(Value text default Default()) returns text { return "argument" }
      function Default() returns text { return "default" }
    `)
    const rootNode = AST.streamAllContents(parsed).find(node => AST.isActionDeclaration(node) && node.name === 'Root')
    Expect.Is(rootNode, AST.isActionDeclaration)
    const root = rootNode
    const carry = namedFunction(parsed, 'Carry')
    const alias = AST.streamAllContents(parsed).find(node => AST.isAliasDeclaration(node) && node.name === 'Native')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFromExpression)
    Expect.Is(alias.value.expression, AST.isValueReference)
    const target = alias.value.expression
    const site = root.block!.statements[0]!
    Expect.Is(site, AST.isDoStatement)
    const argument = site.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isFunctionCallExpression)
    const argumentTarget = namedFunction(parsed, 'Argument')
    const defaultTarget = namedFunction(parsed, 'Default')
    const parameter = argumentTarget.parameterList.parameters[0]!
    const selected = parameter.defaultValue!
    Expect.Is(selected, AST.isFunctionCallExpression)
    const native: NativeEffectPublication = {
      phase: 'invocation',
      declaration: target,
      exportSource: alias.value,
      kind: 'complete',
      purity: { violations: ['io'], open: false },
      failures: { cases: ['NativeFailed'], open: false },
    }
    const reads: CallableEffectFactInputs['reads'] = [
      { reference: returned(carry), initializer: alias.value, classification: 'immutable', kind: 'complete' },
      { reference: site.action, initializer: alias.value, classification: 'immutable', kind: 'complete' },
      { reference: target, classification: 'immutable', kind: 'complete' },
    ]
    const argumentCall = call(argument, argumentTarget, {
      defaults: [{ parameter, expression: selected }],
      contract: { purity: { violations: [], open: false }, failures: { cases: ['ArgumentFailed'], open: false } },
    })
    const defaultCall = call(selected, defaultTarget, {
      contract: {
        purity: { violations: ['suspend'], open: false },
        failures: { cases: ['DefaultFailed'], open: false },
      },
    })
    for (
      const publication of [
        call(site, target, { operation: 'action', failureTransfer: { handlesAll: true } }),
        call(site, target, { operation: 'schedule' }),
      ]
    ) {
      const inputs = { calls: [publication, argumentCall, defaultCall], reads, natives: [native] }
      Expect(analyze(carry, inputs).effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
      const result = analyze(root, inputs)
      Expect(new Set(result.effects.purity.violations)).toEqual(new Set(['action', 'io', 'suspend']))
      Expect(result.effects.purity.open).toBe(false)
      Expect(result.effects.failures).toEqual({ cases: ['ArgumentFailed', 'DefaultFailed'], open: false })
      const facts = discoverCallableEffectFacts(root, inputs)
      Expect(facts.find(fact => fact.node === target)!.purity).toEqual({ violations: [], open: false })
      Expect(facts.find(fact => fact.node === target)!.failures).toEqual({ cases: [], open: false })
      const origin = alias.value
      Expect(
        facts.find(fact => fact.node === site)!.executes.some(edge => edge.target === origin && edge.failureTransfer),
      )
        .toBe(false)
      const unknown: NativeEffectPublication = { ...native, kind: 'unknown', reason: 'unclassified-native' }
      Expect(analyze(carry, { ...inputs, natives: [unknown] }).effects.purity).toEqual({ violations: [], open: false })
      Expect(analyze(root, { ...inputs, natives: [unknown] }).effects.failures).toEqual({
        cases: ['ArgumentFailed', 'DefaultFailed'],
        open: false,
      })
      Expect(analyze(root, { ...inputs, natives: [unknown] }).effects.purity.open).toBe(true)
    }
    const evaluation: NativeEffectPublication = { ...native, phase: 'evaluation', exportSource: target }
    const row = call(site, target, { operation: 'action', failureTransfer: { handlesAll: true } })
    const absentInvocation = analyze(root, { calls: [row, argumentCall, defaultCall], reads, natives: [evaluation] })
    Expect(absentInvocation.effects.purity.open).toBe(true)
    Expect(absentInvocation.effects.failures.open).toBe(true)
    Expect(absentInvocation.effects.failures.cases).toContain('NativeFailed')
    const compact = {
      ...row,
      contract: {
        purity: { violations: [], open: false },
        failures: { cases: ['BodyFailed'], open: false },
      },
    }
    const suppliedInvocation = analyze(root, {
      calls: [compact, argumentCall, defaultCall],
      reads,
      natives: [evaluation],
    })
    Expect(suppliedInvocation.effects.purity.open).toBe(false)
    Expect(suppliedInvocation.effects.failures).toEqual({
      cases: ['NativeFailed', 'ArgumentFailed', 'DefaultFailed'],
      open: false,
    })
    Expect(() =>
      discoverCallableEffectFacts(root, {
        calls: [],
        reads,
        natives: [native, {
          ...native,
          declaration: root,
          phase: 'invocation',
          failures: { cases: ['Other'], open: false },
        }],
      })
    ).toThrow(Errors.UnexpectedBehaviorError)
    Expect(() =>
      discoverCallableEffectFacts(root, {
        calls: [],
        reads,
        natives: [{ ...native, phase: undefined } as unknown as NativeEffectPublication],
      })
    ).toThrow(Errors.UnexpectedBehaviorError)
  })

  Test('merges live read facets with overlapping call and native operation publications', async () => {
    const parsed = await parse(`
      let Live = Source()
      function Root() { return Live }
      function Getter() { return 1 }
      function Source() { return 2 }
    `)
    const root = namedFunction(parsed, 'Root')
    const getter = namedFunction(parsed, 'Getter')
    const source = namedFunction(parsed, 'Source')
    const alias = parsed.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'Live')
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isFunctionCallExpression)
    const reference = returned(root)
    Expect.Is(reference, AST.isValueReference)
    const contract = { purity: { violations: [], open: false }, failures: { cases: ['GetterFailed'], open: false } }
    const operation = call(reference, getter, { contract, failureTransfer: { handlesAll: true } })
    const sourceCall = call(alias.value, source)
    const read = { reference, initializer: alias.value, classification: 'reactive' as const, kind: 'complete' as const }
    const native: NativeEffectPublication = {
      phase: 'invocation',
      declaration: source,
      exportSource: returned(source),
      kind: 'complete',
      purity: { violations: ['io'], open: false },
      failures: { cases: ['AliasFailed'], open: false },
    }
    const siteNative: NativeEffectPublication = {
      phase: 'evaluation',
      declaration: reference,
      exportSource: reference,
      kind: 'complete',
      ...contract,
    }
    for (const natives of [[native], [native, siteNative]]) {
      const result = analyze(root, { calls: [operation, sourceCall], reads: [read], natives })
      Expect(result.effects).toEqual({
        purity: { violations: ['reactive-state', 'io'], open: false },
        failures: { cases: ['AliasFailed'], open: false },
      })
      Expect(result.findings.some(finding => finding.kind === 'violation' && finding.node === source)).toBe(
        true,
      )
      const incomplete = analyze(root, {
        calls: [operation, sourceCall],
        reads: [{ ...read, kind: 'unknown', reason: 'incomplete-fact' }],
        natives,
      })
      Expect(incomplete.effects).toEqual({
        purity: { violations: ['reactive-state', 'io'], open: true },
        failures: { cases: ['AliasFailed'], open: true },
      })
    }
    Expect(analyze(root, { calls: [sourceCall], reads: [read], natives: [native, siteNative] }).effects).toEqual({
      purity: { violations: ['reactive-state', 'io'], open: false },
      failures: { cases: ['GetterFailed', 'AliasFailed'], open: false },
    })
    const selfAnchored = { calls: [{ ...operation, target: reference }, sourceCall], reads: [read], natives: [native] }
    Expect(analyze(root, selfAnchored).effects).toEqual({
      purity: { violations: ['reactive-state', 'io'], open: false },
      failures: { cases: ['AliasFailed'], open: false },
    })
    Expect(discoverCallableEffectFacts(root, selfAnchored).find(fact => fact.node === reference)!.executes
      .some(edge => edge.target === reference)).toBe(false)
  })

  Test('retains executing operands under a standalone native expression contract', async () => {
    const parsed = await parse('function Root() { return [Source()] } function Source() { return 1 }')
    const root = namedFunction(parsed, 'Root')
    const source = namedFunction(parsed, 'Source')
    const list = returned(root)
    Expect.Is(list, AST.isListLiteral)
    const operand = list.elements[0]!
    Expect.Is(operand, AST.isFunctionCallExpression)
    const native: NativeEffectPublication = {
      phase: 'evaluation',
      declaration: list,
      exportSource: list,
      kind: 'complete',
      purity: { violations: [], open: false },
      failures: { cases: ['BuilderFailed'], open: false },
    }
    const sourceNative: NativeEffectPublication = {
      phase: 'invocation',
      declaration: source,
      exportSource: returned(source),
      kind: 'complete',
      purity: { violations: ['io'], open: false },
      failures: { cases: ['OperandFailed'], open: false },
    }
    Expect(analyze(root, { calls: [call(operand, source)], reads: [], natives: [native, sourceNative] }).effects)
      .toEqual({
        purity: { violations: ['io'], open: false },
        failures: { cases: ['BuilderFailed', 'OperandFailed'], open: false },
      })
  })

  Test('keeps carried callable values independent of unrelated invocation body and contract rows', async () => {
    const parsed = await parse(`
      let Saved = action { do Work() }
      function Carry() { return Saved }
      action Run() { do Saved() }
      action Work() { }
    `)
    const carry = namedFunction(parsed, 'Carry')
    const run = namedAction(parsed, 'Run')
    const work = namedAction(parsed, 'Work')
    const saved = parsed.statements.find(node => AST.isAliasDeclaration(node) && node.name === 'Saved')
    Expect.Is(saved, AST.isAliasDeclaration)
    Expect.Is(saved.value, AST.isActionExpression)
    const carried = saved.value
    const reference = returned(carry)
    const site = run.block!.statements[0]!
    Expect.Is(site, AST.isDoStatement)
    const inner = carried.block.statements[0]!
    Expect.Is(inner, AST.isDoStatement)
    const contract = {
      purity: { violations: ['io'] as const, open: false },
      failures: { cases: ['Denied'], open: false },
    }
    const read = { reference, initializer: carried, classification: 'immutable' as const, kind: 'complete' as const }
    const variants = [
      call(site, carried, { operation: 'action', body: carried.block }),
      call(site, carried, { operation: 'action', contract }),
      call(site, carried, { operation: 'action' }),
      call(site, reference, { operation: 'action', contract }),
    ]
    for (const publication of variants) {
      const inputs = {
        calls: [publication, call(inner, work, { operation: 'action', contract })],
        reads: [read],
        natives: [],
      }
      Expect(analyze(carry, inputs).effects).toEqual({
        purity: { violations: [], open: false },
        failures: { cases: [], open: false },
      })
      const facts = discoverCallableEffectFacts(carry, inputs)
      Expect(facts.some(fact => fact.node === carried.block || fact.node === work)).toBe(false)
      Expect(facts.find(fact => fact.node === carried)!.executes).toEqual([])
    }
    const executed = analyze(run, {
      calls: [variants[0]!, call(inner, work, { operation: 'action', contract })],
      reads: [{ ...read, reference: site.action }],
      natives: [],
    })
    Expect(executed.effects).toEqual({
      purity: { violations: ['action', 'io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    const witness = executed.findings.find(finding => finding.kind === 'violation' && finding.node === work)!
    Expect(witness.path.some(edge => edge.site === carried && edge.target === carried.block)).toBe(true)
  })

  Test('handles and schedules inline callable bodies while argument and default failures remain outside', async () => {
    const parsed = await parse(`
      action Root() { do action { do Work() }(Argument()) }
      action Work() { }
      function Argument(Value number default Default()) returns number { return 1 }
      function Default() returns number { return 2 }
    `)
    const root = namedAction(parsed, 'Root')
    const work = namedAction(parsed, 'Work')
    const argumentTarget = namedFunction(parsed, 'Argument')
    const defaultTarget = namedFunction(parsed, 'Default')
    const site = root.block!.statements[0]!
    Expect.Is(site, AST.isDoStatement)
    Expect.Is(site.action, AST.isActionExpression)
    const carried = site.action
    const inner = carried.block.statements[0]!
    Expect.Is(inner, AST.isDoStatement)
    const argument = site.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isFunctionCallExpression)
    const parameter = argumentTarget.parameterList.parameters[0]!
    const selected = parameter.defaultValue!
    Expect.Is(selected, AST.isFunctionCallExpression)
    const argumentCall = call(argument, argumentTarget, {
      defaults: [{ parameter, expression: selected }],
      contract: { purity: { violations: [], open: false }, failures: { cases: ['ArgumentFailed'], open: false } },
    })
    const defaultCall = call(selected, defaultTarget, {
      contract: {
        purity: { violations: ['suspend'], open: false },
        failures: { cases: ['DefaultFailed'], open: false },
      },
    })
    const workCall = call(inner, work, {
      operation: 'action',
      contract: { purity: { violations: ['io'], open: false }, failures: { cases: ['Denied'], open: false } },
    })
    for (
      const publication of [
        call(site, carried, { operation: 'action', body: carried.block, failureTransfer: { handlesAll: true } }),
        call(site, carried, { operation: 'schedule', body: carried.block }),
      ]
    ) {
      const inputs = { calls: [publication, argumentCall, defaultCall, workCall], reads: [], natives: [] }
      const analysis = analyze(root, inputs)
      Expect(analysis.effects.purity.open).toBe(false)
      Expect(new Set(analysis.effects.purity.violations)).toEqual(new Set(['action', 'io', 'suspend']))
      Expect(analysis.effects.failures).toEqual({ cases: ['ArgumentFailed', 'DefaultFailed'], open: false })
      const operation = discoverCallableEffectFacts(root, inputs).find(fact => fact.node === site)!
      Expect(operation.executes.some(edge => edge.target === carried && !edge.failureTransfer)).toBe(true)
      const body = operation.executes.find(edge => edge.target === carried.block)!
      Expect(body.site === carried).toBe(true)
      Expect(body.failureTransfer).toEqual(
        publication.operation === 'schedule' ? { detached: true } : { handlesAll: true },
      )
      Expect(operation.executes.some(edge => edge.target === argument && !edge.failureTransfer)).toBe(true)
      const construction: NativeEffectPublication = {
        phase: 'evaluation',
        declaration: carried,
        exportSource: carried,
        kind: 'complete',
        purity: { violations: [], open: false },
        failures: { cases: ['ConstructionFailed'], open: false },
      }
      Expect(analyze(root, { ...inputs, natives: [construction] }).effects.failures).toEqual({
        cases: ['ConstructionFailed', 'ArgumentFailed', 'DefaultFailed'],
        open: false,
      })
    }
  })

  Test('classifies now only from published native contracts and retains unknown known failures', async () => {
    const parsed = await parse('function Root() { return now }')
    const root = namedFunction(parsed, 'Root')
    const site = returned(root)
    Expect.Is(site, AST.isNowExpression)
    const empty = { calls: [], reads: [], natives: [] }
    const absent = analyze(root, empty)
    Expect(absent.effects).toEqual({
      purity: { violations: [], open: true },
      failures: { cases: [], open: true },
    })
    Expect(absent.findings.some(finding =>
      finding.node === site && finding.kind === 'unknown'
      && finding.reason === 'unclassified-native'
    )).toBe(true)
    const pure: NativeEffectPublication = {
      phase: 'evaluation',
      declaration: site,
      exportSource: site,
      kind: 'complete',
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    }
    Expect(analyze(root, { ...empty, natives: [pure] }).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    const unknown: NativeEffectPublication = {
      ...pure,
      kind: 'unknown',
      reason: 'unclassified-native',
      purity: { violations: ['suspend'], open: false },
      failures: { cases: ['Unavailable'], open: false },
    }
    Expect(analyze(root, { ...empty, natives: [unknown] }).effects).toEqual({
      purity: { violations: ['suspend'], open: true },
      failures: { cases: ['Unavailable'], open: true },
    })
  })

  Test('keeps foreign literal boundaries open and never substitutes a same-named Tao body', async () => {
    const parsed = await parse(
      'function Literal() { return 1 from ./native.ts } function Linked() { return Local() from ./native.ts } function Local() { return 2 }',
    )
    const literal = namedFunction(parsed, 'Literal')
    const linked = namedFunction(parsed, 'Linked')
    const local = namedFunction(parsed, 'Local')
    const linkedValue = returned(linked)
    Expect.Is(linkedValue, AST.isFromExpression)
    const inputs = { calls: [call(linkedValue.expression, local, { body: local.block })], reads: [], natives: [] }
    for (const owner of [literal, linked]) {
      const result = analyze(owner, inputs)
      Expect(result.effects).toEqual({
        purity: { violations: [], open: true },
        failures: { cases: [], open: true },
      })
      Expect(result.findings.some(finding => finding.kind === 'unknown' && finding.reason === 'unclassified-native'))
        .toBe(true)
    }
  })

  Test('retains a real foreign wrapper and bridge site with no Tao target declaration', async () => {
    const parsed = await parse(
      'function Root() { return Host(Argument()) from ./native.ts } function Argument() { return 1 }',
    )
    const root = namedFunction(parsed, 'Root')
    const wrapper = returned(root)
    Expect.Is(wrapper, AST.isFromExpression)
    Expect.Is(wrapper.expression, AST.isFunctionCallExpression)
    const site = wrapper.expression
    const argument = site.argumentList!.arguments[0]!.value
    Expect.Is(argument, AST.isFunctionCallExpression)
    const publication: NativeEffectPublication = {
      phase: 'evaluation',
      declaration: site,
      exportSource: site,
      kind: 'complete',
      purity: { violations: ['io'], open: false },
      failures: { cases: ['NativeFailed'], open: false },
    }
    const inputs = {
      calls: [],
      reads: [],
      natives: [publication, {
        phase: 'evaluation' as const,
        declaration: argument,
        exportSource: argument,
        kind: 'complete' as const,
        purity: { violations: [], open: false },
        failures: { cases: ['ArgumentFailed'], open: false },
      }],
    }
    const result = analyze(root, inputs)
    Expect(result.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['NativeFailed', 'ArgumentFailed'], open: false },
    })
    const witness = result.findings.find(finding => finding.kind === 'violation')!
    Expect(witness.node === site).toBe(true)
    Expect(witness.path.some(edge => edge.site === wrapper && edge.target === site)).toBe(true)
    const absent = analyze(root, { calls: [], reads: [], natives: [] })
    Expect(absent.effects.purity.open).toBe(true)
    Expect(absent.effects.failures.open).toBe(true)
  })

  Test('consumes native bridge-site anchors without self-recursion or losing arguments and defaults', async () => {
    const f = await fixture()
    const row = {
      ...f.rootCall,
      target: f.rootSite,
      body: undefined,
      defaults: [{ parameter: f.parameter, expression: f.defaultSite }],
      failureTransfer: { handlesAll: true },
    }
    const native: NativeEffectPublication = {
      phase: 'evaluation',
      declaration: f.rootSite,
      exportSource: f.rootSite,
      kind: 'complete',
      purity: { violations: ['suspend'], open: false },
      failures: { cases: ['NativeFailed'], open: false },
    }
    const inputs = {
      calls: [row, f.sourceCall, call(f.defaultSite, f.defaultTarget, { body: f.defaultTarget.block })],
      reads: [],
      natives: [native, f.native],
    }
    const facts = discoverCallableEffectFacts(f.root, inputs)
    Expect(facts.find(fact => fact.node === f.rootSite)!.executes.some(edge => edge.target === f.rootSite)).toBe(false)
    Expect(analyzeCallableEffects(f.root, facts).effects).toEqual({
      purity: { violations: ['suspend', 'io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    const noRow = analyze(f.root, { calls: [f.sourceCall], reads: [], natives: [native, f.native] })
    Expect(noRow.effects).toEqual({
      purity: { violations: ['suspend', 'io'], open: false },
      failures: { cases: ['NativeFailed', 'Denied'], open: false },
    })
    const unknown: NativeEffectPublication = { ...native, kind: 'unknown', reason: 'unclassified-native' }
    Expect(analyze(f.root, { ...inputs, natives: [unknown, f.native] }).effects).toEqual({
      purity: { violations: ['suspend', 'io'], open: true },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(
      analyze(f.root, {
        ...inputs,
        calls: [{ ...row, operation: 'schedule' }, f.sourceCall, inputs.calls[2]!],
        natives: [unknown, f.native],
      }).effects,
    ).toEqual({
      purity: { violations: ['action', 'suspend', 'io'], open: true },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(
      analyze(f.root, {
        ...inputs,
        calls: [{ ...row, kind: 'unknown', reason: 'incomplete-fact' }, f.sourceCall, inputs.calls[2]!],
        natives: [unknown, f.native],
      }).effects.failures,
    ).toEqual({ cases: ['Denied'], open: true })
  })

  Test('evaluates real explicit arguments without any call publication or matching pair', async () => {
    const f = await fixture()
    const analysis = analyze(f.root, { calls: [f.sourceCall], reads: [], natives: [f.native] })
    Expect(analysis.effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['Denied'], open: true },
    })
    const finding = analysis.findings.find(value => value.kind === 'violation')!
    Expect(finding.node === f.source).toBe(true)
    Expect(finding.path.some(edge => edge.site === f.argument && edge.target === f.sourceSite)).toBe(true)
  })

  Test('keeps known explicit argument and target effects under incomplete correspondence', async () => {
    const f = await fixture()
    const row: ResolvedCallExecution = {
      ...f.rootCall,
      pairs: [],
      kind: 'unknown',
      reason: 'incomplete-fact',
      contract: { purity: { violations: ['suspend'], open: false }, failures: { cases: ['Local'], open: false } },
      body: undefined,
    }
    const analysis = analyze(f.root, { calls: [row, f.sourceCall], reads: [], natives: [f.native] })
    Expect(analysis.effects.purity.open).toBe(true)
    Expect(analysis.effects.purity.violations).toEqual(['suspend', 'io'])
    Expect(new Set(analysis.effects.failures.cases)).toEqual(new Set(['Local', 'Denied']))
    Expect(analysis.effects.failures.open).toBe(true)
  })

  Test('evaluates only independently published defaults and keeps them outside callee handling', async () => {
    const f = await fixture()
    const row: ResolvedCallExecution = {
      ...f.rootCall,
      defaults: [{ parameter: f.parameter, expression: f.defaultSite }],
      failureTransfer: { handlesAll: true },
    }
    const defaultCall = call(f.defaultSite, f.defaultTarget, {
      contract: {
        purity: { violations: ['suspend'], open: false },
        failures: { cases: ['DefaultFailed'], open: false },
      },
    })
    const inputs = { calls: [row, f.sourceCall, defaultCall], reads: [], natives: [f.native] }
    const analysis = analyze(f.root, inputs)
    Expect(analysis.effects.purity).toEqual({ violations: ['io', 'suspend'], open: false })
    Expect(new Set(analysis.effects.failures.cases)).toEqual(new Set(['Denied', 'DefaultFailed']))
    const witness = analysis.findings.find(value => value.kind === 'violation' && value.node === f.defaultTarget)!
    Expect(witness.path.some(edge => edge.site === f.parameter && edge.target === f.defaultSite)).toBe(true)
    const unselected = analyze(f.root, { ...inputs, calls: [f.rootCall, f.sourceCall, defaultCall] })
    Expect(unselected.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(
      discoverCallableEffectFacts(f.root, { ...inputs, calls: [f.rootCall, f.sourceCall, defaultCall] })
        .some(fact => fact.node === f.defaultSite),
    ).toBe(false)
  })

  Test('retains native declaration along transitive named bodies without executing publication origins', async () => {
    const f = await fixture()
    const unknown: NativeEffectPublication = { ...f.native, kind: 'unknown', reason: 'unclassified-native' }
    const analysis = analyze(f.middle, {
      calls: [call(f.middleSite, f.root, { body: f.root.block }), f.rootCall, f.sourceCall],
      reads: [],
      natives: [unknown],
    })
    Expect(analysis.effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['Denied'], open: true },
    })
    const witness = analysis.findings.find(value => value.kind === 'violation')!
    Expect(witness.node === f.source).toBe(true)
    Expect(witness.path.some(edge => edge.site === f.middleSite && edge.target === f.root)).toBe(true)
    Expect(witness.path.some(edge => edge.site === f.sourceSite && edge.target === f.source)).toBe(true)
    Expect(
      discoverCallableEffectFacts(f.middle, {
        calls: [call(f.middleSite, f.root, { body: f.root.block }), f.rootCall, f.sourceCall],
        reads: [],
        natives: [unknown],
      }).some(fact => fact.node === f.exportSource),
    ).toBe(false)
  })

  Test('keeps missing native publication open without trusting the target body or spelling', async () => {
    const f = await fixture()
    const result = analyze(f.root, { calls: [f.rootCall, f.sourceCall], reads: [], natives: [] })
    Expect(result.effects.purity.open).toBe(true)
    Expect(result.effects.failures.open).toBe(true)
    Expect(result.findings.some(value => value.node === f.source && value.kind === 'unknown')).toBe(true)
  })

  Test('retains dynamic target uncertainty while evaluating known arguments', async () => {
    const f = await fixture()
    const row: ResolvedCallExecution = {
      ...f.rootCall,
      target: undefined,
      body: undefined,
      operation: 'unknown',
      kind: 'unknown',
      reason: 'dynamic-target',
    }
    const analysis = analyze(f.root, { calls: [row, f.sourceCall], reads: [], natives: [f.native] })
    Expect(analysis.effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['Denied'], open: true },
    })
    Expect(analysis.findings.some(value =>
      value.kind === 'unknown' && value.reason === 'dynamic-target'
      && value.node === f.rootSite
    )).toBe(true)
  })

  Test(
    'evaluates live alias initializers and published reactive reads without inferring callable targets',
    async () => {
      const parsed = await parse(`
      view Example {
        state Counter = 1
        let Live = Counter
        function Root() returns number { return Live }
      }
    `)
      const root = namedFunction(parsed, 'Root')
      const alias = AST.streamAllContents(parsed).find(value => AST.isAliasDeclaration(value) && value.name === 'Live')
      Expect.Is(alias, AST.isAliasDeclaration)
      const reference = returned(root)
      const inputs: CallableEffectFactInputs = {
        calls: [],
        natives: [],
        reads: [
          { reference, classification: 'immutable', initializer: alias.value, kind: 'complete' },
          { reference: alias.value, classification: 'reactive', kind: 'complete' },
        ],
      }
      const analysis = analyze(root, inputs)
      Expect(analysis.effects).toEqual({
        purity: { violations: ['reactive-state'], open: false },
        failures: { cases: [], open: false },
      })
      const witness = analysis.findings[0]!
      Expect(witness.node === alias.value).toBe(true)
      Expect(witness.path.some(edge => edge.site === reference && edge.target === alias.value)).toBe(true)
      Expect(analyze(root, { ...inputs, reads: [] }).effects.purity.open).toBe(true)
    },
  )

  Test('carries actions without executing their body and separates invoke, schedule and detach', async () => {
    const parsed = await parse(`
      let Saved = action { do Work() }
      function Carry() { return Saved }
      action Work() { }
      action Invoke() { do Work() }
      action Detached() { async { do Work() } }
    `)
    const carry = namedFunction(parsed, 'Carry')
    const saved = parsed.statements.find(value => AST.isAliasDeclaration(value) && value.name === 'Saved')
    const work = namedAction(parsed, 'Work')
    const invoke = namedAction(parsed, 'Invoke')
    const detached = namedAction(parsed, 'Detached')
    Expect.Is(saved, AST.isAliasDeclaration)
    Expect.Is(saved.value, AST.isActionExpression)
    const savedAction = saved.value
    const invocation = invoke.block!.statements[0]!
    Expect.Is(invocation, AST.isDoStatement)
    const detachedSite = AST.streamAllContents(detached).find(AST.isDoStatement)!
    Expect.Is(detachedSite, AST.isDoStatement)
    const contract = {
      purity: { violations: ['io'] as const, open: false },
      failures: { cases: ['Denied'], open: false },
    }
    const carryInputs: CallableEffectFactInputs = {
      calls: [],
      natives: [],
      reads: [{
        reference: returned(carry),
        initializer: saved.value,
        classification: 'immutable',
        kind: 'complete',
      }],
    }
    Expect(analyze(carry, carryInputs).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: false },
    })
    Expect(discoverCallableEffectFacts(carry, carryInputs).some(fact => fact.node === savedAction.block)).toBe(false)
    const actionCall = call(invocation, work, { operation: 'action', contract })
    Expect(analyze(invoke, { calls: [actionCall], reads: [], natives: [] }).effects).toEqual({
      purity: { violations: ['action', 'io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(analyze(invoke, { calls: [{ ...actionCall, operation: 'schedule' }], reads: [], natives: [] }).effects)
      .toEqual({ purity: { violations: ['action', 'io'], open: false }, failures: { cases: [], open: false } })
    Expect(
      analyze(detached, {
        calls: [call(detachedSite, work, { operation: 'action', contract })],
        reads: [],
        natives: [],
      }).effects,
    ).toEqual({ purity: { violations: ['action', 'io'], open: false }, failures: { cases: [], open: false } })
  })

  Test('keeps an unmaterialized invoked action expression open even though carrying it is pure', async () => {
    const parsed = await parse('action Root() { do action { }() }')
    const root = namedAction(parsed, 'Root')
    const site = root.block!.statements[0]!
    Expect.Is(site, AST.isDoStatement)
    Expect.Is(site.action, AST.isActionExpression)
    Expect(
      analyze(root, {
        calls: [call(site, site.action, { operation: 'action' })],
        reads: [],
        natives: [],
      }).effects.purity,
    ).toEqual({ violations: ['action'], open: true })
  })

  Test('walks conditions, returns, construction operands and unsupported receivers conservatively', async () => {
    const parsed = await parse(`
      function Native() returns boolean { return true }
      function Root() { if Native() { return [Native(), number 2] } return (Native()).Result }
    `)
    const root = namedFunction(parsed, 'Root')
    const target = namedFunction(parsed, 'Native')
    const sites = AST.streamAllContents(root).filter(AST.isFunctionCallExpression)
    Expect(sites).toHaveLength(3)
    const contract = {
      purity: { violations: ['io'] as const, open: false },
      failures: { cases: ['Denied'], open: false },
    }
    const result = analyze(root, { calls: sites.map(site => call(site, target, { contract })), reads: [], natives: [] })
    Expect(result.effects).toEqual({
      purity: { violations: ['io'], open: true },
      failures: { cases: ['Denied'], open: true },
    })
    const facts = discoverCallableEffectFacts(root, {
      calls: sites.map(site => call(site, target, { contract })),
      reads: [],
      natives: [],
    })
    Expect(sites.every(site => facts.some(fact => fact.node === site))).toBe(true)
  })

  Test('converges recursive target and alias graphs with one fact per witness', async () => {
    const parsed = await parse('function Root() returns number { return Root() }')
    const root = namedFunction(parsed, 'Root')
    const site = returned(root)
    const inputs = { calls: [call(site, root, { body: root.block })], reads: [], natives: [] }
    const facts = discoverCallableEffectFacts(root, inputs)
    Expect(new Set(facts.map(fact => fact.node)).size).toBe(facts.length)
    Expect(analyzeCallableEffects(root, facts).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
    const aliases = await parse('let First = Second let Second = First function Root() { return First }')
    const first = aliases.statements.find(value => AST.isAliasDeclaration(value) && value.name === 'First')
    const second = aliases.statements.find(value => AST.isAliasDeclaration(value) && value.name === 'Second')
    Expect.Is(first, AST.isAliasDeclaration)
    Expect.Is(second, AST.isAliasDeclaration)
    const reference = returned(namedFunction(aliases, 'Root'))
    const cyclic = discoverCallableEffectFacts(reference, {
      calls: [],
      natives: [],
      reads: [
        { reference, initializer: first.value, classification: 'immutable', kind: 'complete' },
        { reference: first.value, initializer: second.value, classification: 'immutable', kind: 'complete' },
        { reference: second.value, initializer: first.value, classification: 'immutable', kind: 'complete' },
      ],
    })
    Expect(cyclic).toHaveLength(3)
    Expect(new Set(cyclic.map(fact => fact.node)).size).toBe(3)
    Expect(analyzeCallableEffects(reference, cyclic).effects).toEqual({
      purity: { violations: [], open: false },
      failures: { cases: [], open: true },
    })
  })

  Test('accepts frozen snapshots and reanalyzes changed published contracts without stale state', async () => {
    const f = await fixture()
    const row = Object.freeze({
      ...f.rootCall,
      pairs: Object.freeze([...f.rootCall.pairs]),
      defaults: Object.freeze([]),
    })
    const inputs = Object.freeze({
      calls: Object.freeze([row, Object.freeze(f.sourceCall)]),
      reads: Object.freeze([]),
      natives: Object.freeze([Object.freeze({
        ...f.native,
        purity: Object.freeze({ violations: Object.freeze(['io'] as const), open: false }),
        failures: Object.freeze({ cases: Object.freeze(['Denied']), open: false }),
      })]),
    })
    const first = analyze(f.root, inputs)
    const second = analyze(f.root, {
      ...inputs,
      natives: [{ ...f.native, purity: { violations: [], open: false }, failures: { cases: [], open: false } }],
    })
    Expect(first.effects).toEqual({
      purity: { violations: ['io'], open: false },
      failures: { cases: ['Denied'], open: false },
    })
    Expect(second.effects).toEqual({ purity: { violations: [], open: false }, failures: { cases: [], open: false } })
    Expect(analyze(f.root, inputs).effects).toEqual(first.effects)
    Expect(inputs.calls[0] === row).toBe(true)
    Expect(inputs.natives[0]!.purity.violations).toEqual(['io'])
  })

  Test('rejects duplicate call, read and native publications as internal invariants', async () => {
    const f = await fixture()
    const read = { reference: f.rootSite, classification: 'immutable' as const, kind: 'complete' as const }
    for (
      const inputs of [
        { calls: [f.rootCall, f.rootCall], reads: [], natives: [] },
        { calls: [], reads: [read, read], natives: [] },
        { calls: [], reads: [], natives: [f.native, f.native] },
      ]
    ) {
      Expect(() => discoverCallableEffectFacts(f.root, inputs)).toThrow(Errors.UnexpectedBehaviorError)
    }
  })

  Test('rejects contradictory target bodies and native export contracts', async () => {
    const f = await fixture()
    Expect(() =>
      discoverCallableEffectFacts(f.root, {
        calls: [f.rootCall, { ...f.sourceCall, target: f.sink, body: f.source.block }],
        reads: [],
        natives: [],
      })
    ).toThrow(Errors.UnexpectedBehaviorError)
    Expect(() =>
      discoverCallableEffectFacts(f.root, {
        calls: [],
        reads: [],
        natives: [f.native, { ...f.native, declaration: f.sink, purity: { violations: [], open: false } }],
      })
    ).toThrow(Errors.UnexpectedBehaviorError)
  })
})

function analyze(owner: AST.Node, inputs: CallableEffectFactInputs) {
  return analyzeCallableEffects(owner, discoverCallableEffectFacts(owner, inputs))
}

function call(site: AST.Node, target: AST.Node, extra: Partial<ResolvedCallExecution> = {}): ResolvedCallExecution {
  return {
    site,
    target,
    operation: 'function',
    pairs: [],
    defaults: [],
    kind: 'complete',
    ...extra,
  } as ResolvedCallExecution
}

async function parse(source: string) {
  const parsed = await Parser.parseCode(source)
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function namedFunction(file: AST.TaoFile, name: string): AST.FunctionDeclaration {
  const result = AST.streamAllContents(file).find(value => AST.isFunctionDeclaration(value) && value.name === name)
  Expect.Is(result, AST.isFunctionDeclaration)
  return result
}

function namedAction(file: AST.TaoFile, name: string): AST.ActionDeclaration {
  const result = file.statements.find(value => AST.isActionDeclaration(value) && value.name === name)
  Expect.Is(result, AST.isActionDeclaration)
  return result
}

function returned(function_: AST.FunctionDeclaration): AST.Expression {
  const statement = function_.block.statements[0]
  Expect.Is(statement, AST.isReturnStatement)
  return statement.value
}

async function fixture() {
  const file = await parse(`
    function Root() returns number { return Sink(Source()) }
    function Sink(Value number default Default()) returns number { return 1 }
    function Source() returns number { return 2 }
    function Default() returns number { return 3 }
    function Middle() returns number { return Root() }
  `)
  const root = namedFunction(file, 'Root')
  const sink = namedFunction(file, 'Sink')
  const source = namedFunction(file, 'Source')
  const defaultTarget = namedFunction(file, 'Default')
  const middle = namedFunction(file, 'Middle')
  const rootSite = returned(root)
  Expect.Is(rootSite, AST.isFunctionCallExpression)
  const argument = rootSite.argumentList!.arguments[0]!
  const sourceSite = argument.value
  Expect.Is(sourceSite, AST.isFunctionCallExpression)
  const parameter = sink.parameterList.parameters[0]!
  const defaultSite = parameter.defaultValue!
  Expect.Is(defaultSite, AST.isFunctionCallExpression)
  const exportSource = returned(source)
  const rootCall = call(rootSite, sink, { body: sink.block, pairs: [{ argument, parameter }] })
  const sourceCall = call(sourceSite, source)
  const native: NativeEffectPublication = {
    phase: 'invocation',
    declaration: source,
    exportSource,
    kind: 'complete',
    purity: { violations: ['io'], open: false },
    failures: { cases: ['Denied'], open: false },
  }
  return {
    root,
    sink,
    source,
    defaultTarget,
    middle,
    middleSite: returned(middle),
    rootSite,
    argument,
    sourceSite,
    parameter,
    defaultSite,
    exportSource,
    rootCall,
    sourceCall,
    native,
  }
}
