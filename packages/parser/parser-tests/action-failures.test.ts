import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: action failures', () => {
  Test('parses inferred native failures and repeated foreign failure cases', async () => {
    const parsed = await testParseCode(`
      type SaveFailure is one of Offline, Rejected
      action Save() {
        fail Offline "Could not save this draft."
      }
      action Publish(Value text) runs latest
        fails Offline "Publishing is unavailable."
        fails Offline "Publishing timed out."
        from ./Api.ts
    `)
    const actions = parsed.entry.ast.statements.filter(AST.isActionDeclaration)

    Expect(AST.actionFailuresOf(actions[0]!).map(failure => failure.sentence)).toEqual([
      'Could not save this draft.',
    ])
    Expect(actions[1]?.foreign?.failures.map(failure => failure.sentence)).toEqual([
      'Publishing is unavailable.',
      'Publishing timed out.',
    ])
    Expect(actions[1]?.runsLatest).toBe(true)
  })
})
