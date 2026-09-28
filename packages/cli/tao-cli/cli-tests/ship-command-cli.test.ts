import { Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

Test('tao ship --no-wait reaches the ship command as noWait', async () => {
  await withTaoFixture({
    'App.tao': `project {
  id "notes"
  name "Notes"
  version "1.2.3"
  app Notes
}
app Notes { view Main }
view Main() { }
`,
  }, async root => {
    const result = await runTaoCliForTest(['ship', root, '--dry-run', '--no-wait'])

    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toContain('Return after upload without waiting for Apple processing')
  })
})
