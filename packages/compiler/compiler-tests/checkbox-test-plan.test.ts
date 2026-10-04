import { Describe, Expect, Test } from '@shared/test'
import { withCompiledTestPlan } from './test-compile'

Describe('compiler: checkbox test-plan IR', () => {
  Test('lowers tag-only checked state without inventing selector variants', async () => {
    await withCompiledTestPlan(
      'tao-checkbox-test-plan-',
      {
        'Main.test.tao': `
          use CheckboxApp from ./

          test "Checkbox state" {
            test "checks both states" {
              run CheckboxApp
              expect checkbox #markFinal checked
              expect checkbox #marketingOptIn unchecked
            }
          }
        `,
        'Main.tao': `
          app CheckboxApp { id "com.tao.test.checkboxapp" version "1.0.0" name "CheckboxApp"  view MainView }
          view MainView() { render inject \`\`\`ts return null \`\`\` }
        `,
      },
      plan => {
        const steps = plan.suites[0]?.checks[0]?.steps ?? []

        Expect(steps).toHaveLength(2)
        Expect(steps[0]).toMatchObject({
          checked: true,
          kind: 'expectCheckboxState',
          tag: 'markFinal',
        })
        Expect(steps[1]).toMatchObject({
          checked: false,
          kind: 'expectCheckboxState',
          tag: 'marketingOptIn',
        })
        Expect(steps[0]?.source.range).toBeDefined()
      },
    )
  })
})
