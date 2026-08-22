import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

Describe('tao test CLI', () => {
  Test('reports no discovered tests without failing', async () => {
    await withTaoFixture({ 'Main.tao': '' }, async (rootDir) => {
      const result = await runTaoCliForTest(['test', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('No Tao tests found under')
    })
  })

  Test('rejects empty Tao test suites', async () => {
    await withTaoFixture({ 'Empty.test.tao': 'test "Empty" { }\n' }, async (rootDir) => {
      const result = await runTaoCliForTest(['test', rootDir])
      const output = `${result.stdout}${result.stderr}`

      Expect(result.exitCode).not.toBe(0)
      Expect(output).toContain("Test 'Empty' must start exactly one app with run.")
      Expect(output).toContain('Empty.test.tao')
      Expect(output).toContain('Validating Tao test files')
      Expect(output).not.toContain('Compiling apps')
      Expect(output).not.toContain('Running Tao tests')
      Expect(output).not.toContain('runtime-toolchain-tests/tao-test-command.jest.tsx')
      Expect(output).not.toContain('Test Suites:')
    })
  })
})
