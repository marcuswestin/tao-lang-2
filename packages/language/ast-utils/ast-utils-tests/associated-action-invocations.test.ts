import { ASTUtils } from '@ast-utils'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { invocationFailureContract } from '../ast-utils-src/effect-outcomes'
import {
  resolveActionInvocation,
  resolveActionTarget,
  resolveAssociatedActionTarget,
} from '../ast-utils-src/invocations'
import { Type } from '../ast-utils-src/Type'

Describe('Associated data action invocations', () => {
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
      const selected = ASTUtils.resolveAssociatedActionTarget(call.action)
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
    const selectedTarget = resolveAssociatedActionTarget(selected.value)
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
    const selectedTarget = resolveAssociatedActionTarget(selected.value, receiver => {
      inspected++
      Expect(receiver.kind === 'expression' && receiver.expression).toBe(receiverExpression)
      return context.receiverType(receiver)
    })
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
      const selected = resolveAssociatedActionTarget(calls[0]!.action, receiver => {
        inspected++
        Expect(receiver.kind).toBe('member-path')
        Expect(receiver.kind === 'member-path' && receiver.site).toBe(calls[0]!.action)
        Expect(receiver.kind === 'member-path' && receiver.members).toEqual(['Book'])
        return context.receiverType(receiver)
      })
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

function action(file: AST.TaoFile, name: string): AST.ActionDeclaration {
  const found = file.statements.find(statement => AST.isActionDeclaration(statement) && statement.name === name)
  Expect.Is(found, AST.isActionDeclaration)
  return found
}

function invocations(action: AST.ActionDeclaration): AST.DoStatement[] {
  return AST.streamAllContents(action).filter(AST.isDoStatement)
}
