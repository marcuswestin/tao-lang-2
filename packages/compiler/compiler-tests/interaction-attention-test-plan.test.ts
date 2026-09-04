import { Packages } from '@ast-utils'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: interaction attention test-plan IR', () => {
  Test('lowers the five keyboard journey operations without stringly typed step kinds', async () => {
    await withTaoFiles(
      'tao-interaction-attention-plan-',
      {
        'Main.test.tao': `
          use Demo from ./
          test "Keyboard" {
            test "discovers commands" {
              run Demo
              press key "primary+k"
              narrow "draft"
              expect target "Draft document"
              expect focus region "Document list"
              expect verbs "Open", "Rename", "Delete"
            }
          }
        `,
        'Main.tao': `
          app Demo { view Home }
          view Home() { render inject \`\`\`ts return null \`\`\` }
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

        Expect(steps).toMatchObject([
          { key: 'primary+k', kind: 'pressKey' },
          { kind: 'narrow', text: 'draft' },
          { kind: 'expectTarget', label: 'Draft document' },
          { kind: 'expectFocusRegion', label: 'Document list' },
          { kind: 'expectVerbs', labels: ['Open', 'Rename', 'Delete'] },
        ])
        Expect(steps.every(step => step.source.range !== undefined)).toBe(true)
      },
    )
  })
})
