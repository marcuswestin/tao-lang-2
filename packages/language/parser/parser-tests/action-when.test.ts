import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { parseCodeWithErrors, testParseSyntax } from './test-parse'

Describe('parser: action when', () => {
  Test('parses action when as an atomic event handler', async () => {
    const parsed = await testParseSyntax(`
      view Main {
        Button("Group") {
          on press -> when GroupMode {
            yes -> { do Enable() }
            no -> { do Disable() }
          }
        }
      }
    `)
    const handler = AST.streamAllContents(parsed.entry.ast).find(AST.isEventHandler)
    Expect.Is(handler, AST.isEventHandler)
    Expect.Is(handler.block?.statements[0], AST.isWhenActionStatement)
  })

  Test('parses action when branches and branch-local payload nodes', async () => {
    const parsed = await testParseSyntax(`
      view Main {
        Button("Group") {
          on press -> {
            when GroupMode {
              yes -> { do Enable() }
              Offline Problem -> { do Report(Problem) }
              no -> { do Disable() }
              otherwise -> { do Reset() }
            }
          }
        }
      }
    `)
    const statement = AST.streamAllContents(parsed.entry.ast).find(AST.isWhenActionStatement)
    Expect.Is(statement, AST.isWhenActionStatement)
    Expect(statement.branches.map(branch => [branch.case, branch.payload?.name])).toEqual([
      ['yes', undefined],
      ['Offline', 'Problem'],
      ['no', undefined],
    ])
    Expect(statement.otherwise).toBeDefined()
    Expect(statement.branches[1]?.payload?.$container).toBe(statement.branches[1])
  })

  Test('rejects right-bound action when payloads', async () => {
    const parsed = await parseCodeWithErrors(`
      action Run() {
        when Status {
          error -> Problem { do Report(Problem) }
        }
      }
    `)
    Expect(parsed.entry.document.parseResult.parserErrors.length).toBeGreaterThan(0)
  })
})
