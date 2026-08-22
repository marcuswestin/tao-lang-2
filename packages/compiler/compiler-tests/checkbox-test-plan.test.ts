import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: checkbox test-plan IR', () => {
  Test('lowers tag-only checked state without inventing selector variants', async () => {
    await withTaoFiles(
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
          app CheckboxApp { view MainView }
          view MainView() { render inject \`\`\`ts return null \`\`\` }
        `,
      },
      async paths => {
        const testPath = paths['Main.test.tao']!
        const validation = await Workspace.validate(testPath)
        const plan = Compiler.compileTestPlan(
          validation,
          Compiler.createContext(await Packages.createContext(FS.dirname(testPath)), FS.dirname(testPath)),
        )
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
