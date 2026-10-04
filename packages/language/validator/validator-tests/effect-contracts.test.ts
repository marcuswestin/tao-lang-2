import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Diagnostics } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { testValidateCode } from './test-validate'

const declarations = `
  type Failure is one of Offline, Full
  action Closed()
    fails Offline "A connection is needed."
    fails Full "The disk is full."
    from ./Bindings.ts
  action Unknown() from ./Bindings.ts
  action Read() returns text from ./Bindings.ts
  action ReadClosed() returns text fails Offline "A connection is needed." from ./Bindings.ts
  action Quiet() { }
`

async function actions(source: string): Promise<Map<string, AST.ActionDeclaration>> {
  const result = await testValidateCode(`${declarations}\n${source}`)
  return new Map(
    AST.streamAllContents(result.entry.ast)
      .filter(AST.isActionDeclaration)
      .map(action => [action.name, action]),
  )
}

function contract(named: Map<string, AST.ActionDeclaration>, name: string): ASTUtils.FailureContract {
  const action = named.get(name)
  Expect(action).toBeDefined()
  return ASTUtils.effectFailureContract(action!)
}

Describe('validator: failure contracts', () => {
  Test('distinguishes closed native and declared foreign contracts from unbounded foreign contracts', async () => {
    const named = await actions('')
    Expect(contract(named, 'Quiet')).toEqual({ cases: [], open: false })
    Expect(contract(named, 'Closed')).toEqual({ cases: ['Offline', 'Full'], open: false })
    Expect(contract(named, 'Unknown')).toEqual({ cases: [], open: true })
  })

  Test('retains known cases and openness through named and bound calls', async () => {
    const named = await actions(`
      action Mixed(Callback action()) { do Closed() do Callback() }
      action Named(Callback action()) { do Mixed(Callback) }
      action Bound() { let Value = do Read() }
      action BoundClosed() { let Value = do ReadClosed() }
      action ForeignWrapper() { do Unknown() }
    `)
    Expect(contract(named, 'Mixed')).toEqual({ cases: ['Offline', 'Full'], open: true })
    Expect(contract(named, 'Named')).toEqual({ cases: ['Offline', 'Full'], open: true })
    Expect(contract(named, 'Bound')).toEqual({ cases: [], open: true })
    Expect(contract(named, 'BoundClosed')).toEqual({ cases: ['Offline'], open: false })
    Expect(contract(named, 'ForeignWrapper')).toEqual({ cases: [], open: true })
  })

  Test('keeps the unknown remainder after known-case and partial generic handling', async () => {
    const named = await actions(`
      action Mixed(Callback action()) { do Closed() do Callback() }
      action Partial(Callback action()) { when do Mixed(Callback) { Offline -> { } } }
      action Rejected(Callback action()) { when do Mixed(Callback) { rejected -> { } } }
      action Errors(Callback action()) { when do Mixed(Callback) { error -> { } } }
      action Both(Callback action()) { when do Mixed(Callback) { rejected -> { } error -> { } } }
      action Otherwise(Callback action()) { when do Mixed(Callback) | otherwise -> { } }
    `)
    Expect(contract(named, 'Partial')).toEqual({ cases: ['Full'], open: true })
    Expect(contract(named, 'Rejected')).toEqual({ cases: [], open: true })
    Expect(contract(named, 'Errors')).toEqual({ cases: ['Offline', 'Full'], open: true })
    Expect(contract(named, 'Both')).toEqual({ cases: [], open: false })
    Expect(contract(named, 'Otherwise')).toEqual({ cases: [], open: false })
  })

  Test('includes failures in recovery blocks while keeping closed containment precise', async () => {
    const named = await actions(`
      action Handled() { when do Closed() { rejected -> { } } }
      action Recovery() { when do Closed() { rejected -> { do Unknown() } } }
    `)
    Expect(contract(named, 'Handled')).toEqual({ cases: [], open: false })
    Expect(contract(named, 'Recovery')).toEqual({ cases: [], open: true })
  })

  Test('does not infer a closed contract merely by encountering a recursive cycle', async () => {
    const named = await actions(`
      action First() { do Second() }
      action Second() { do First() fail Full "Full." }
      action Self() { do Self() }
      action RecursiveHandled() { when do Self() { rejected -> { } error -> { } } }
    `)
    Expect(contract(named, 'First')).toEqual({ cases: ['Full'], open: true })
    Expect(contract(named, 'Second')).toEqual({ cases: ['Full'], open: true })
    Expect(contract(named, 'Self')).toEqual({ cases: [], open: true })
    Expect(contract(named, 'RecursiveHandled')).toEqual({ cases: [], open: false })
  })

  Test('retains a detached root contract without adding it to the parent', async () => {
    const named = await actions('action Detached(Callback action()) { async { do Closed() do Callback() } }')
    const detached = named.get('Detached')!
    const calls = AST.streamAllContents(detached).filter(AST.isDoStatement)
    Expect(contract(named, 'Detached')).toEqual({ cases: [], open: false })
    Expect(calls).toHaveLength(2)
    Expect(ASTUtils.invocationFailureContract(calls[0]!)).toEqual({ cases: ['Offline', 'Full'], open: false })
    Expect(ASTUtils.invocationFailureContract(calls[1]!)).toEqual({ cases: [], open: true })
    Expect(calls.map(call => ASTUtils.isRootEffectInvocation(call))).toEqual([true, true])
  })

  Test('unions openness and rejects open actual effects against a closed bound', () => {
    const open = ASTUtils.unionFailureContracts([
      { cases: ['Offline'], open: false },
      { cases: ['Full', 'Offline'], open: true },
    ])
    Expect(open).toEqual({ cases: ['Offline', 'Full'], open: true })
    Expect(ASTUtils.failureContractSatisfiesBound(open, { cases: ['Offline', 'Full'], open: false })).toBe(false)
    Expect(ASTUtils.failureContractSatisfiesBound({ cases: ['Offline'], open: false }, {
      cases: ['Offline', 'Full'],
      open: false,
    })).toBe(true)
    Expect(ASTUtils.failureContractSatisfiesBound({ cases: ['Full'], open: false }, {
      cases: ['Offline'],
      open: false,
    })).toBe(false)
    Expect(ASTUtils.failureContractSatisfiesBound(open, { cases: [], open: true })).toBe(true)
  })

  Test('preserves the root warning policy for open contracts before app guard coverage', async () => {
    const result = await testValidateCode(`
      ${declarations}
      command Run() { Title "Run" do Unknown() }
    `)
    Expect(Diagnostics.messages(result.diagnostics.filter(diagnostic => diagnostic.severity === 'warning'))).toEqual([])
    const command = AST.streamAllContents(result.entry.ast).find(AST.isCommandDeclaration)!
    Expect(ASTUtils.effectFailureContract(command)).toEqual({ cases: [], open: true })
  })
})
