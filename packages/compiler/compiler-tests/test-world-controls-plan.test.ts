import { Describe, Expect, Test } from '@shared/test'
import { withCompiledTestPlan } from './test-compile'

Describe('compiler: test world controls', () => {
  Test('compiles provider controls as ordered source-linked steps', async () => {
    await withCompiledTestPlan('tao-test-world-plan-', {
      'Main.tao': `app Demo { view Main } view Main() { render inject \`\`\`ts return null \`\`\` }`,
      'Main.test.tao': `
        use Demo from ./
        test "Demo" { test "controls" {
          run Demo
          network offline
          datasource fails after create Note "rejected"
          network online
          wait for sync
        } }
      `,
    }, plan => {
      Expect(plan.suites[0]?.checks[0]?.steps.map(step => step.kind)).toEqual([
        'network',
        'datasourceFailure',
        'network',
        'waitForSync',
      ])
      Expect(plan.suites[0]?.checks[0]?.steps[1]).toMatchObject({
        entity: 'Note',
        kind: 'datasourceFailure',
        message: 'rejected',
        operation: 'create',
      })
    })
  })
})
