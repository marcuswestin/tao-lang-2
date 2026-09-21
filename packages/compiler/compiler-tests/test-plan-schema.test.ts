import { Workspace } from '@compiler/workspace'
import { Expect, Test } from '@shared/test'
import { withTaoFiles } from '@shared/test'

Test('compiler: test-plan schema exposes a versioned public discriminated IR', async () => {
  await withTaoFiles(
    'tao-test-plan-schema-',
    {
      'Main.tao': `
        app Demo { view Main }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
      'Main.test.tao': `
        use Demo from ./

        test "Journey" {
          test "relaunches" {
            run Demo
            relaunch
            select #rows[2] {
              expect text "Second"
            }
          }
        }
      `,
    },
    async paths => {
      const plan = await Workspace.compileTestPlan(paths['Main.test.tao']!)
      const check = plan.suites[0]?.checks[0]
      const select = check?.steps[1]

      Expect(plan.version).toBe(1)
      Expect(plan.sourcePath).toBe(paths['Main.test.tao'])
      Expect(check).toMatchObject({
        name: 'relaunches',
        run: { appName: 'Demo' },
        steps: [
          { fresh: false, kind: 'relaunch' },
          { index: 2, kind: 'select', tag: 'rows' },
        ],
      })
      Expect(check?.source.range?.start.line).toBe(3)
      Expect(check?.run.source.range?.start.line).toBe(4)
      Expect(select).toMatchObject({
        kind: 'select',
        steps: [{ kind: 'expect', selector: 'text', text: 'Second' }],
      })
    },
  )
})
