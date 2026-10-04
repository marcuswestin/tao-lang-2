import { Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

Test('tao ship --no-wait reaches the ship command as noWait', async () => {
  await withTaoFixture({
    '.tao/.gitkeep': '',
    'App.tao': `app Notes { id "notes" version "1.2.3" name "Notes" view Main }
view Main() { render inject \`\`\`ts return null \`\`\` }
`,
  }, async root => {
    const result = await runTaoCliForTest(['ship', root, '--dry-run', '--no-wait'])

    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toContain('Return after upload without waiting for Apple processing')
  })
})
