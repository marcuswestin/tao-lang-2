import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { invocationFailureContract } from '../ast-utils-src/effect-outcomes'
import {
  resolveActionInvocation,
  resolveActionTarget,
  resolveAssociatedActionTarget,
} from '../ast-utils-src/invocations'
import { Type } from '../ast-utils-src/Type'

Describe('Associated data action invocations', () => {
  Test('transports only action contracts and preserves failure, writable and Self domains', async () => {
    const file = await parse(`
      can Readable { action Read() -> text }
      can PureReadable { Read() -> text }
      can Closed { action Read() fails never -> text }
      can OrdinaryInput { action Read(Value text) -> text }
      can Reusable { action Read(Value type) -> type }
      type Handle is { Path text } with { action Read() returns text from ./Native.ts }
      type Pure is { Path text } with { func Read() -> text { return "ok" } }
      type Clean is { Path text } with { action Read() -> text { return "ok" } }
      type MutableInput is { Path text } with { action Read(mutable Value text) returns text from ./Native.ts }
      type ReusableHandle is { Path text } with { action Read(Value type) returns type from ./Native.ts }
      view ReadView where type T is Reusable (Value T) {
        action Run() { let Again = do Value.Read(Value) return Again }
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    const types = new Map(file.statements.filter(AST.isTypeDeclaration).map(type => [type.name, type]))
    const domain = (name: string) => Type.ofDefinition(types.get(name)!)
    const effects = ASTUtils.createAssociatedEffects([file])
    ASTUtils.withAssociatedEffects(effects, () => {
      Expect(ASTUtils.planCapabilityTransport(domain('Handle'), domain('Readable')).kind).toBe('ready')
      Expect(ASTUtils.planCapabilityTransport(domain('Pure'), domain('Readable')).kind).toBe('unsupported')
      Expect(ASTUtils.planCapabilityTransport(domain('Handle'), domain('PureReadable')).kind).toBe('unsupported')
      Expect(ASTUtils.planCapabilityTransport(domain('Handle'), domain('Closed')).kind).toBe('unsupported')
      Expect(ASTUtils.planCapabilityTransport(domain('Clean'), domain('Closed')).kind).toBe('ready')
      Expect(ASTUtils.planCapabilityTransport(domain('MutableInput'), domain('OrdinaryInput')).kind).toBe('unsupported')
      const reusable = ASTUtils.planCapabilityTransport(domain('ReusableHandle'), domain('Reusable'))
      Expect(reusable.kind).toBe('ready')
      if (reusable.kind === 'ready' && reusable.plan.kind === 'attach') {
        const witness = reusable.plan.methods[0]!
        Expect(Type.identityKey(witness.required.result)).toBe(Type.identityKey(domain('ReusableHandle')))
        Expect(Type.identityKey(witness.required.signature.inputs[0]!.type)).toBe(
          Type.identityKey(domain('ReusableHandle')),
        )
      }
      const view = file.statements.find(AST.isViewDeclaration)
      Expect.Is(view, AST.isViewDeclaration)
      Assert.defined(view.block, 'the generic view has an authored block')
      const run = view.block.statements.find(AST.isActionDeclaration)
      Expect.Is(run, AST.isActionDeclaration)
      const invocation = invocations(run)[0]!
      const target = resolveAssociatedActionTarget(invocation.action)
      Expect(target?.kind).toBe('capability')
      if (target?.kind === 'capability') {
        Expect(target.result.genericParameter).toBe(view.genericParameters[0])
        Expect(target.signature.inputs[0]!.type.genericParameter).toBe(view.genericParameters[0])
      }
      const alias = run.block?.statements.find(AST.isActionResultStatement)
      Expect.Is(alias, AST.isActionResultStatement)
      Expect(Type.ofValueDeclaration(alias).genericParameter).toBe(view.genericParameters[0])
      Expect(resolveActionInvocation(invocation).diagnostics).toEqual([])
    })
  })
  Test('selects same-named row and collection declarations and binds only their authored parameters', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        action Book.Return(Count number, Label text) { },
        action Books.Return(Label text, Count number) { }
      }
      action Caller(Single Book, Many Books) {
        do Single.Return("label", 3)
        do Many.Return(3, "label")
      }
    `)
    const entity = file.statements.find(AST.isEntityDataDeclaration)
    Expect.Is(entity, AST.isEntityDataDeclaration)
    const [singleAction, manyAction] = entity.block.entries.filter(AST.isActionDeclaration)
    Expect.Is(singleAction, AST.isActionDeclaration)
    Expect.Is(manyAction, AST.isActionDeclaration)
    const [singleCall, manyCall] = invocations(action(file, 'Caller'))
    Expect.Is(singleCall, AST.isDoStatement)
    Expect.Is(manyCall, AST.isDoStatement)
    for (
      const [call, declaration, cardinality, kind] of [
        [singleCall, singleAction, 'one', 'entity'],
        [manyCall, manyAction, 'many', 'list'],
      ] as const
    ) {
      const target = resolveActionTarget(call.action)
      Expect(target.kind).toBe('named')
      const selected = nominalTarget(ASTUtils.resolveAssociatedActionTarget(call.action))
      Expect(selected?.action).toBe(declaration)
      Expect(selected?.associated.cardinality).toBe(cardinality)
      const resolved = resolveActionInvocation(call)
      Expect(resolved.action).toBe(declaration)
      Expect(resolved.associated?.owner).toBe(entity)
      Expect(resolved.associated?.cardinality).toBe(cardinality)
      Expect(resolved.associated?.domain.kind).toBe(kind)
      Expect(resolved.associated?.receiver.kind).toBe('member-path')
      const receiver = resolved.associated?.receiver
      Expect(receiver?.kind === 'member-path' && receiver.site).toBe(call.action)
      Expect(receiver?.kind === 'member-path' && receiver.members).toEqual([])
      const parameters = AST.parametersOf(declaration)
      Expect(resolved.pairs).toHaveLength(parameters.length)
      resolved.pairs.forEach((pair, index) => Expect(pair.parameter).toBe(parameters[index]))
      Expect(resolved.pairs.map(pair => pair.argument.value.$type)).toEqual(
        cardinality === 'one' ? ['NumberLiteral', 'StringLiteral'] : ['StringLiteral', 'NumberLiteral'],
      )
      Expect(resolved.diagnostics).toEqual([])
    }
  })

  Test('selects nominal instance and static actions with distinct dispatch metadata', async () => {
    const file = await parse(`
      type File is item with {
        action Read(Length number) { },
        static action Construct(Path text) { }
      }
      action Caller(Handle File, Path text) {
        do Handle.Read(3)
        do File.Construct(Path)
      }
    `)
    const owner = file.statements.find(statement => AST.isTypeDeclaration(statement) && statement.name === 'File')
    Expect.Is(owner, AST.isTypeDeclaration)
    const actions = ASTUtils.ownAssociatedActions(owner)
    const [read, construct] = actions
    Expect.Is(read, AST.isActionDeclaration)
    Expect.Is(construct, AST.isActionDeclaration)
    const calls = invocations(action(file, 'Caller'))
    const selected = calls.map(call => nominalTarget(ASTUtils.resolveAssociatedActionTarget(call.action)))
    Expect(selected.map(value => value?.action.name)).toEqual([read.name, construct.name])
    Expect(selected.map(value => value?.associated.owner.name)).toEqual([owner.name, owner.name])
    Expect(selected.map(value => value?.associated.dispatch)).toEqual(['instance', 'static'])
    Expect(selected.map(value => value?.associated.cardinality)).toEqual(['one', 'one'])
  })

  Test('resolves capability actions separately while preserving their failure and result contracts', async () => {
    const file = await parse(`
      can Readable { action Read(Length number) fails ReadError -> text }
      view ReadView where type T is Readable (Value T) {
        action Run() { do Value.Read(3) }
        render inject \`\`\`ts return null \`\`\`
      }
    `)
    const view = file.statements.find(AST.isViewDeclaration)
    Expect.Is(view, AST.isViewDeclaration)
    Assert.defined(view.block, 'the generic view has an authored block')
    const run = view.block.statements.find(AST.isActionDeclaration)
    Expect.Is(run, AST.isActionDeclaration)
    const call = run.block?.statements.find(AST.isDoStatement)
    Expect.Is(call, AST.isDoStatement)

    const target = resolveAssociatedActionTarget(call.action)
    Expect(target?.kind).toBe('capability')
    if (target?.kind !== 'capability') {
      return
    }
    Expect(target.requirement.name).toBe('Read')
    Expect(target.associated.owner.name).toBe('Readable')
    Expect(target.associated.dispatch).toBe('instance')
    Expect(target.associated.domain.genericParameter?.name).toBe('T')
    Expect(target.signature.failures).toEqual({ cases: ['ReadError'], open: false })
    Expect(target.result).toEqual({ kind: 'primitive', primitive: 'text' })

    const invocation = resolveActionInvocation(call)
    Expect(invocation.capability?.requirement).toBe(target.requirement)
    Expect(invocation.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Length'])
    Expect(invocation.diagnostics).toEqual([])
  })

  Test('retains nested real member paths through repeated action aliases', async () => {
    const file = await parse(`
      data Books / Book { Title text, action Book.Return(Label text) { } }
      type Revision is { Book }
      action Caller(Value Revision) {
        let Selected = Value.Book.Return
        let Again = Selected
        do Again("label")
      }
    `)
    const caller = action(file, 'Caller')
    const selected = caller.block?.statements.find(AST.isAliasDeclaration)
    Expect.Is(selected, AST.isAliasDeclaration)
    Expect.Is(selected.value, AST.isMemberAccessExpression)
    const call = invocations(caller)[0]
    Expect.Is(call, AST.isDoStatement)
    const resolved = resolveActionInvocation(call)
    Expect(resolved.action?.name).toBe('Return')
    Expect(resolved.associated?.cardinality).toBe('one')
    const receiver = resolved.associated?.receiver
    Expect(receiver?.kind === 'member-path' && receiver.site).toBe(selected.value)
    Expect(receiver?.kind === 'member-path' && receiver.members).toEqual(['Book'])
    const selectedTarget = nominalTarget(resolveAssociatedActionTarget(selected.value))
    Expect(selectedTarget?.action).toBe(resolved.action)
    Expect(selectedTarget?.associated.receiver.kind === 'member-path' && selectedTarget.associated.receiver.site).toBe(
      selected.value,
    )
    Expect(resolved.pairs.map(pair => Type.parameterName(pair.parameter))).toEqual(['Label'])
    Expect(resolved.diagnostics).toEqual([])
  })

  Test('retains a real postfix receiver expression when an alias selects an action', async () => {
    const file = await parse(`
      data Books / Book { Title text, action Book.Return() { } }
      func Identity(Value Book) -> Book { return Value }
      action Caller(Value Book) {
        let Selected = Identity(Value).Return
        do Selected()
      }
    `)
    const caller = action(file, 'Caller')
    const selected = caller.block?.statements.find(AST.isAliasDeclaration)
    Expect.Is(selected, AST.isAliasDeclaration)
    Expect.Is(selected.value, AST.isPostfixMemberAccess)
    const receiverExpression = selected.value.receiver
    const call = invocations(caller)[0]
    Expect.Is(call, AST.isDoStatement)
    const resolved = resolveActionInvocation(call)
    Expect(resolved.action?.name).toBe('Return')
    Expect(resolved.associated?.domain.kind).toBe('entity')
    const receiver = resolved.associated?.receiver
    Expect(receiver?.kind === 'expression' && receiver.expression).toBe(selected.value.receiver)
    const context = Type.correspondenceResolver(new Map())
    let inspected = 0
    const selectedTarget = nominalTarget(resolveAssociatedActionTarget(selected.value, receiver => {
      inspected++
      Expect(receiver.kind === 'expression' && receiver.expression).toBe(receiverExpression)
      return context.receiverType(receiver)
    }))
    Expect(inspected).toBe(1)
    Expect(selectedTarget?.action).toBe(resolved.action)
    Expect(resolved.diagnostics).toEqual([])
  })

  Test('selects by entity identity and refuses wrong cardinality, scalar and invalid qualifiers', async () => {
    const file = await parse(`
      data Books / Book {
        Title text,
        action Book.Return() { },
        action Books.Collect() { },
        action Wrong.Invalid() { }
      }
      data Magazines / Magazine { Title text, action Magazine.Return() { } }
      action Caller(Row Book, Rows Books, Other Magazine, Scalar text) {
        do Row.Collect()
        do Rows.Return()
        do Scalar.Return()
        do Row.Invalid()
        do Other.Return()
      }
    `)
    const calls = invocations(action(file, 'Caller'))
    Expect(calls).toHaveLength(5)
    for (const call of calls.slice(0, 4)) {
      Expect(resolveAssociatedActionTarget(call.action)).toBeUndefined()
      Expect(resolveActionTarget(call.action).kind).toBe('unresolved')
      Expect(resolveActionInvocation(call).action).toBeUndefined()
      Expect(resolveActionInvocation(call).associated).toBeUndefined()
    }
    const other = file.statements.filter(AST.isEntityDataDeclaration)[1]
    Expect.Is(other, AST.isEntityDataDeclaration)
    const selected = resolveActionInvocation(calls[4]!)
    Expect(selected.action).toBe(other.block.entries.find(AST.isActionDeclaration))
    Expect(selected.associated?.owner).toBe(other)
  })

  Test(
    'selection-only contextual lookup preserves real nested anchors and leaves pending domains unresolved',
    async () => {
      const file = await parse(`
      data Books / Book { Title text, action Book.Return() { } }
      type Revision is { Book }
      action Caller(Value Revision, Pending MissingType) {
        do Value.Book.Return()
        do Pending.Return()
        do Value.Book.Missing()
      }
    `)
      const calls = invocations(action(file, 'Caller'))
      const context = Type.correspondenceResolver(new Map())
      let inspected = 0
      const selected = nominalTarget(resolveAssociatedActionTarget(calls[0]!.action, receiver => {
        inspected++
        Expect(receiver.kind).toBe('member-path')
        Expect(receiver.kind === 'member-path' && receiver.site).toBe(calls[0]!.action)
        Expect(receiver.kind === 'member-path' && receiver.members).toEqual(['Book'])
        return context.receiverType(receiver)
      }))
      Expect(inspected).toBe(1)
      Expect(selected?.associated.domain.kind).toBe('entity')
      Expect(selected?.action.name).toBe('Return')
      for (const call of calls.slice(1)) {
        Expect(resolveAssociatedActionTarget(call.action, receiver => context.receiverType(receiver))).toBeUndefined()
      }
      Expect(resolveAssociatedActionTarget(calls[0]!.action, receiver => {
        const domain = context.receiverType(receiver)
        return Type.atMemberPath(domain, ['Missing'])
      })).toBeUndefined()
    },
  )

  Test('preserves source action results, failure contracts and argument mismatch diagnostics', async () => {
    const file = await parse(`
      type ReturnFailure is one of Full
      data Books / Book {
        Title text,
        action Book.Return(Label text) -> text {
          if false { fail Full "Cannot return." }
          return Book.Title
        },
        action Books.Return() -> Books { return Books }
      }
      action Caller(Row Book, Rows Books) {
        let Title = do Row.Return("label")
        let Result = do Rows.Return()
        do Row.Return(4)
        return Title
      }
    `)
    const caller = action(file, 'Caller')
    const calls = invocations(caller)
    Expect(calls).toHaveLength(3)
    Expect(invocationFailureContract(calls[0]!)).toEqual({ cases: ['Full'], open: false })
    Expect(invocationFailureContract(calls[1]!)).toEqual({ cases: [], open: false })
    const returned = caller.block?.statements.find(AST.isReturnStatement)?.value
    Expect.Is(returned, AST.isValueReference)
    Expect(Type.ofExpression(returned)).toEqual({ kind: 'primitive', primitive: 'text' })
    const result = caller.block?.statements.filter(AST.isActionResultStatement)[1]
    Expect.Is(result, AST.isActionResultStatement)
    const domain = Type.ofValueDeclaration(result)
    Expect(domain.kind).toBe('list')
    Expect(domain.kind === 'list' && domain.element?.kind).toBe('entity')
    Expect(resolveActionInvocation(calls[2]!).diagnostics.map(diagnostic => diagnostic.kind)).toEqual([
      'unmatched-argument',
      'missing-argument',
    ])
  })

  Test(
    'keeps ordinary named actions and dynamic action parameters compatible and terminates alias cycles',
    async () => {
      const file = await parse(`
      action Save() { }
      let First = Second
      let Second = First
      action Caller(Callback action()) {
        do Save()
        do Callback()
        do First()
      }
    `)
      const calls = invocations(action(file, 'Caller'))
      Expect(calls.map(call => resolveAssociatedActionTarget(call.action))).toEqual([undefined, undefined, undefined])
      Expect(calls.map(call => resolveActionTarget(call.action).kind)).toEqual(['named', 'dynamic', 'unresolved'])
      Expect(resolveActionInvocation(calls[0]!).action).toBe(action(file, 'Save'))
      Expect(resolveActionInvocation(calls[0]!).associated).toBeUndefined()
    },
  )
})

async function parse(code: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(code, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  Expect(parsed.diagnostics).toEqual([])
  return parsed.entry.ast
}

function nominalTarget(target: ReturnType<typeof resolveAssociatedActionTarget>) {
  Assert(target?.kind === 'named' && target.associated, 'the selected nominal action retains its receiver')
  return { ...target, associated: target.associated }
}

function action(file: AST.TaoFile, name: string): AST.ActionDeclaration {
  const found = file.statements.find(statement => AST.isActionDeclaration(statement) && statement.name === name)
  Expect.Is(found, AST.isActionDeclaration)
  return found
}

function invocations(action: AST.ActionDeclaration): AST.DoStatement[] {
  return AST.streamAllContents(action).filter(AST.isDoStatement)
}
