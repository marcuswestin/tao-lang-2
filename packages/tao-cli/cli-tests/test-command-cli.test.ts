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

  Test('stops every compiler worker after testing separate source directories', async () => {
    const app = (name: string) => `
      use Text from @tao/ui
      app ${name} { view Main }
      view Main() { render Text("${name}") }
    `
    const test = (name: string) => `
      use ${name} from ./
      test "${name}" {
        test "runs" {
          run ${name}
          expect text "${name}"
        }
      }
    `
    await withTaoFixture({
      'Project.tao': 'project { id "worker-lifecycle-test" name "Worker lifecycle test" }',
      'One/App.tao': app('One'),
      'One/App.test.tao': test('One'),
      'Two/App.tao': app('Two'),
      'Two/App.test.tao': test('Two'),
    }, async rootDir => {
      const result = await runTaoCliForTest(['test', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Found 2 Tao test files')
      Expect(result.stdout).toContain('Tao tests finished')
    })
  })
})
