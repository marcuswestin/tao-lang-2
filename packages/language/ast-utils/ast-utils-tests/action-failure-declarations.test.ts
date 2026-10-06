import { Workspace } from '@compiler/workspace'
import { AST, Parser } from '@parser'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import {
  effectFailureContract,
  invocationFailureContract,
  resolveInvocationFailureDeclaration,
} from '../ast-utils-src/effect-outcomes'

Describe('Action failure declaration identity', () => {
  Test('retains real source and foreign enum declarations through joined invocations', async () => {
    const file = await parse(`
      type Problems is one of InvalidInput, Offline
      action Source() { fail InvalidInput "Invalid input." }
      action Native() fails Offline "Offline." from ./Native.ts
      action Joined() { do Source() do Native() do Source() }
      action Caller() { do Joined() }
    `)
    const cases = AST.caseSetCasesOf(file.statements.find(AST.isTypeDeclaration)!)
    Expect(cases).toHaveLength(2)
    const call = calls(action(file, 'Caller'))[0]!
    Expect(invocationFailureContract(call)).toEqual({ cases: ['InvalidInput', 'Offline'], open: false })
    for (const [name, declaration] of [['InvalidInput', cases[0]], ['Offline', cases[1]]] as const) {
      const result = resolveInvocationFailureDeclaration(call, name)
      Expect(result.kind).toBe('resolved')
      Expect(result.kind === 'resolved' && result.declaration).toBe(declaration)
    }
  })

  Test('resolves the actual associated action through an alias rather than caller declarations', async () => {
    const file = await parse(`
      type Problems is one of InvalidInput
      action Reject() { fail InvalidInput "Invalid input." }
      data Books / Book { Title text, action Book.Return() { do Reject() } }
      action Caller(Row Book) {
        let Selected = Row.Return
        let Again = Selected
        do Again() then { InvalidInput Problem -> { } }
      }
    `)
    const problem = AST.caseSetCasesOf(file.statements.find(AST.isTypeDeclaration)!)[0]
    Expect.Is(problem, AST.isCaseSetCase)
    const result = resolveInvocationFailureDeclaration(calls(action(file, 'Caller'))[0]!, 'InvalidInput')
    Expect(result.kind).toBe('resolved')
    Expect(result.kind === 'resolved' && result.declaration).toBe(problem)
  })

  Test('keeps contract subtraction and excludes detached and nested action failures from identity', async () => {
    const file = await parse(`
      type Problems is one of InvalidInput, Offline, Detached, Nested
      action Source() { fail InvalidInput "Invalid." fail Offline "Offline." }
      action Handled() {
        when do Source() { InvalidInput -> { } }
        async { fail Detached "Detached." }
        let Inline = action { fail Nested "Nested." }
      }
      action Closed() { do Source() then { error Problem -> { } } }
      action Rejected() { when do Source() { rejected -> { } } }
      action Otherwise() { do Source() then { otherwise -> { } } }
      action Caller() { do Handled() do Closed() do Rejected() do Otherwise() }
    `)
    const callerCalls = calls(action(file, 'Caller'))
    Expect(effectFailureContract(action(file, 'Handled'))).toEqual({ cases: ['Offline'], open: false })
    Expect(resolveInvocationFailureDeclaration(callerCalls[0]!, 'Offline').kind).toBe('resolved')
    for (const name of ['InvalidInput', 'Detached', 'Nested']) {
      const result = resolveInvocationFailureDeclaration(callerCalls[0]!, name)
      Expect(result.kind).toBe('unresolved')
      Expect(result.kind === 'unresolved' && result.candidates.length).toBe(0)
      Expect(result.kind === 'unresolved' && result.open).toBe(false)
    }
    for (const call of callerCalls.slice(1)) {
      Expect(invocationFailureContract(call)).toEqual({ cases: [], open: false })
      const result = resolveInvocationFailureDeclaration(call, 'Offline')
      Expect(result.kind === 'unresolved' && result.candidates.length).toBe(0)
    }
  })

  Test('retains unknown targets, missing links and cycles without guessing a payload declaration', async () => {
    const file = await parse(`
      type Problems is one of InvalidInput
      action Known() { fail InvalidInput "Invalid." }
      action Unlinked() { fail Missing "Missing." }
      action Recursive() { do Known() do Recursive() }
      action Mixed(Callback action()) { do Known() do Callback() }
      action Caller(Callback action()) {
        do Callback()
        do MissingAction()
        do Unlinked()
        do Recursive()
        do Mixed(Callback)
      }
    `)
    const unlinked = AST.streamAllContents(action(file, 'Unlinked')).find(AST.isFailStatement)
    Expect.Is(unlinked, AST.isFailStatement)
    Expect(unlinked.case.ref).toBeUndefined()
    const callerCalls = calls(action(file, 'Caller'))
    Expect(callerCalls).toHaveLength(5)
    for (const call of callerCalls) {
      const result = resolveInvocationFailureDeclaration(call, call === callerCalls[2] ? 'Missing' : 'InvalidInput')
      Expect(result.kind).toBe('unresolved')
      Expect(result.kind === 'unresolved' && result.open).toBe(true)
    }
    Expect(callerCalls.map((call, index) => {
      const result = resolveInvocationFailureDeclaration(call, index === 2 ? 'Missing' : 'InvalidInput')
      return result.kind === 'unresolved' ? result.candidates.length : -1
    })).toEqual([0, 0, 0, 1, 1])
    Expect(invocationFailureContract(callerCalls[2]!)).toEqual({ cases: ['Missing'], open: false })
    Expect(invocationFailureContract(callerCalls[3]!)).toEqual({ cases: ['InvalidInput'], open: true })
  })

  Test('retains conflicting same-named declarations from distinct joined actions', async () => {
    await withTaoFiles('tao-action-failure-identities-', {
      'First.tao': `
        type FirstProblems is one of InvalidInput
        public action First() { fail InvalidInput "First." }
      `,
      'Second.tao': `
        type SecondProblems is one of InvalidInput
        public action Second() { fail InvalidInput "Second." }
      `,
      'Main.tao': `
        use First from ./First
        use Second from ./Second
        action Joined() { do First() do Second() }
        action Caller() { do Joined() }
      `,
    }, async paths => {
      const parsed = await Workspace.parse(paths['Main.tao'])
      Expect(parsed.diagnostics).toEqual([])
      const file = parsed.entry.ast
      const result = resolveInvocationFailureDeclaration(calls(action(file, 'Caller'))[0]!, 'InvalidInput')
      Expect(result.kind).toBe('unresolved')
      Expect(result.kind === 'unresolved' && result.open).toBe(false)
      Expect(result.kind === 'unresolved' && result.candidates.length).toBe(2)
      if (result.kind === 'unresolved') {
        Expect(result.candidates[0] === result.candidates[1]).toBe(false)
        Expect(result.candidates.every(AST.isCaseSetCase)).toBe(true)
        Expect(result.candidates.map(candidate => AST.findRoot(candidate) === file)).toEqual([false, false])
      }
      Expect(invocationFailureContract(calls(action(file, 'Caller'))[0]!)).toEqual({
        cases: ['InvalidInput'],
        open: false,
      })
    }, { location: 'worktree' })
  })
})

async function parse(code: string): Promise<AST.TaoFile> {
  const parsed = await Parser.parseCode(code, { validation: false })
  Expect(parsed.entry.document.parseResult.lexerErrors).toEqual([])
  Expect(parsed.entry.document.parseResult.parserErrors).toEqual([])
  return parsed.entry.ast
}

function action(file: AST.TaoFile, name: string): AST.ActionDeclaration {
  const declaration = file.statements.find(statement => AST.isActionDeclaration(statement) && statement.name === name)
  Expect.Is(declaration, AST.isActionDeclaration)
  return declaration
}

function calls(action: AST.ActionDeclaration): AST.DoStatement[] {
  return AST.streamAllContents(action).filter(AST.isDoStatement)
}
