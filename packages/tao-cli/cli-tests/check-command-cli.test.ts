import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

Describe('tao check CLI', () => {
  Test('exits zero when files are canonical', async () => {
    await withTaoFixture({
      'canonical.tao': 'view MainView { }\n',
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('0 noncanonical, 1 unchanged')
    })
  })

  Test('exits nonzero on drift without writing', async () => {
    await withTaoFixture({
      'drift.tao': 'view   MainView { }',
    }, async (rootDir) => {
      const path = FS.resolvePath('drift.tao', rootDir)
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Needs fixes')
      Expect(result.stderr).toContain('1 noncanonical, 0 unchanged')
      Expect(await FS.readText(path)).toBe('view   MainView { }')
    })
  })

  Test('exits nonzero on check errors', async () => {
    await withTaoFixture({
      'broken.tao': 'view Broken {',
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Failed to check')
      Expect(result.stderr).toContain('1 failed')
    })
  })

  Test('accepts source produced by tao fix as canonical', async () => {
    await withTaoFixture({
      'app.tao':
        'app MyApp { view MainView }\nuse Text, Button from @tao/ui\nview MainView { render Text(Greeting) let Greeting = "hi" }\n',
    }, async (rootDir) => {
      const fix = await runTaoCliForTest(['fix', rootDir])
      const check = await runTaoCliForTest(['check', rootDir])

      Expect(fix.exitCode).toBe(0)
      Expect(check.exitCode).toBe(0)
      Expect(check.stdout).toContain('0 noncanonical, 1 unchanged')
    })
  })
})
