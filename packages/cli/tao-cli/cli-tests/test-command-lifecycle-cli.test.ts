import { FS, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'
import { outputText } from './test-command-fixtures'

Describe('tao test leaked resources', () => {
  for (const outcome of ['passing leak', 'failed leak', 'clean'] as const) {
    const fails = outcome === 'failed leak'
    const closes = outcome === 'clean'
    Test(`finishes a Tao journey with ${outcome}`, async () => {
      await withTaoFixture({
        '.tao/.gitkeep': '',
        'App.tao': `
          use Text from @tao/ui
          app Leaked { id "leaked" version "1.0.0" name "Leaked" view Main }
          function ResourceText() returns text { return OpenPort() from ./Leak.ts }
          view Main() { render Text(ResourceText()) }
        `,
        'Leak.ts': `
          import { MessageChannel } from 'node:worker_threads'
          export function OpenPort(): string {
            const { port1 } = new MessageChannel()
            port1.on('message', () => {})
            ${closes ? 'port1.close()' : ''}
            console['log']('leaked fixture pid: ' + process['pid'])
            return 'Resource ready'
          }
        `,
        'App.test.tao': `
          use Leaked from ./
          test "Resource cleanup" {
            test "retains a MessagePort" {
              run Leaked
              expect text "${fails ? 'Deliberate original failure' : 'Resource ready'}"
            }
          }
        `,
      }, async root => {
        const result = await runTaoCliForTest(['test', root, '--output', closes ? 'lines' : 'quiet'])
        const output = outputText(result)
        Expect(result.exitCode).toBe(closes ? 0 : 1)
        Expect(output).toContain(`Tao test runner completed (exit ${fails ? 1 : 0})`)
        if (closes) {
          Expect(output).toContain('Tao tests finished')
          Expect(output).not.toContain('Jest did not terminate')
        } else {
          Expect(output).toContain('Jest did not terminate within 3000ms after reporting its verdict')
          Expect(output).toContain('MessagePort')
          Expect(output).toContain('log: ')
        }
        Expect(output).toContain(fails ? '1 failed, 1 total' : '1 passed, 1 total')
        if (fails) {
          Expect(output).toContain('Deliberate original failure')
        }
        const logPath = /^log: (.+)$/m.exec(output)?.[1]
        const logged = closes ? output : await FS.readText(logPath!)
        const pid = Number(/leaked fixture pid: (\d+)/.exec(logged)?.[1])
        Expect(pid).toBeGreaterThan(1)
        Expect(Platform.processIsAlive(pid)).toBe(false)
      })
    }, 60_000)
  }
})
