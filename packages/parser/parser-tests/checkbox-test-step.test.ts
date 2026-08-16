import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { rejectsParser, testParseCode } from './test-parse'

Describe('parser: checkbox test expectations', () => {
  Test('parses tag-only checked and unchecked assertions', async () => {
    const result = await testParseCode(`
      app CheckboxApp { view MainView }
      view MainView() {
        render inject \`\`\`ts return null \`\`\`
      }

      test "Checkbox state" {
        check "exposes both states" {
          run CheckboxApp
          expect checkbox #markFinal checked
          expect checkbox #marketingOptIn unchecked
        }
      }
    `)

    const check = AST.streamAllContents(result.entry.ast).find(AST.isCheckDeclaration)
    Expect.Is(check, AST.isCheckDeclaration)
    const expectations = check.block.statements.filter(AST.isExpectCheckboxStateStep)
    Expect(expectations.map(expectation => ({ tag: expectation.tag, state: expectation.state }))).toEqual([
      { tag: '#markFinal', state: 'checked' },
      { tag: '#marketingOptIn', state: 'unchecked' },
    ])
  })

  Test(
    'does not accept an unrepresented checkbox text selector',
    rejectsParser(`
      test "Checkbox state" {
        check "requires a tag" {
          run CheckboxApp
          expect checkbox "Final" checked
        }
      }
    `),
  )
})
