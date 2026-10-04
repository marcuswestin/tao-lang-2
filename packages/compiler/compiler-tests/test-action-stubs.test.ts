import { Workspace } from '@compiler/workspace'
import { Expect, Test, withTaoFiles } from '@shared/test'

Test('compiler: a foreign failure stub belongs to its check, outside ordered UI steps', async () => {
  await withTaoFiles('tao-test-action-stubs-', {
    'Main.tao': `
      app Demo { id "com.tao.test.demo" version "1.0.0" name "Demo"  view Main }
      view Main() { render inject \`\`\`ts return null \`\`\` }
      type Failure is one of Offline
      folder action Export() fails Offline "Offline." from ./Export.ts
    `,
    'Export.ts': 'export function Export() {}',
    'Main.test.tao': `
      use Demo, Export from ./
      test "Suite" {
        test "offline" { action Export fails Offline run Demo expect text "Offline" }
        test "online" { run Demo expect text "Online" }
      }
    `,
  }, async paths => {
    const plan = await Workspace.compileTestPlan(paths['Main.test.tao']!)
    const [offline, online] = plan.suites[0]!.checks
    Expect(offline?.actionFailureStubs).toMatchObject([{ caseName: 'Offline' }])
    Expect(offline?.actionFailureStubs?.[0]?.actionKey).toMatch(/^[0-9a-f]{64}$/)
    Expect(offline?.steps).toMatchObject([{ kind: 'expect', text: 'Offline' }])
    Expect(online?.actionFailureStubs).toEqual([])
  })
})
