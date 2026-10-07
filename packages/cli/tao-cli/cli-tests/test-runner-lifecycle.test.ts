import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { testRunnerCompletion } from '../cli-src/test-runner-lifecycle'

Describe('Jest completion lifecycle', () => {
  for (const fails of [false, true]) {
    Test(`stops a MessagePort left open after a ${fails ? 'failed' : 'passed'} suite`, async () => {
      const root = await mkTestDir('jest-completion-')
      try {
        await FS.writeText(
          FS.resolvePath('journey.test.cjs', root),
          `
          const { MessageChannel } = require('node:worker_threads')
          test('a fixture journey leaves its MessagePort open', () => {
            const { port1 } = new MessageChannel()
            port1.on('message', () => {})
            console['log']('fixture pid: ' + process['pid'])
            expect('original verdict').toBe(${JSON.stringify(fails ? 'deliberate failure' : 'original verdict')})
          })
        `,
        )
        await FS.writeJson(FS.resolvePath('jest.config.json', root), {
          rootDir: root,
          testMatch: ['<rootDir>/journey.test.cjs'],
          testEnvironment: 'node',
          reporters: ['default', Repo.resolvePath('packages/apps/expo-host/jest-completion-reporter.cjs')],
        })
        const result = await CLI.run('node', {
          args: [
            Repo.resolvePath('packages/apps/expo-host/node_modules/jest/bin/jest.js'),
            '--config',
            FS.resolvePath('jest.config.json', root),
            '--runInBand',
            '--no-watchman',
          ],
          // The grace under test is deliberately short; the outer guard protects a broken fixture.
          completion: testRunnerCompletion(100),
          processPolicy: 'test',
          timeoutMs: 30_000,
          timeoutPolicy: 'bounded',
        })
        Expect(result.exitCode).toBe(1)
        Expect(result.stderr).toContain(`Tao test runner completed (exit ${fails ? 1 : 0})`)
        Expect(result.stderr).toContain('Jest did not terminate within 100ms after reporting its verdict')
        Expect(result.stderr).toContain('MessagePort')
        Expect(result.stderr).not.toContain('timed out after 30s')
        if (fails) {
          Expect(result.stderr).toContain('deliberate failure')
          Expect(result.stderr).toContain('1 failed, 1 total')
        }
        const pid = Number(/fixture pid: (\d+)/.exec(result.stdout + result.stderr)?.[1])
        Expect(pid).toBeGreaterThan(1)
        Expect(Platform.processIsAlive(pid)).toBe(false)
      } finally {
        await FS.remove(root)
      }
    })
  }

  Test('reads a completion line split between chunks without treating an earlier failure as completion', () => {
    const completion = testRunnerCompletion()
    Expect(completion.read('stderr', Buffer.from('FAIL one suite\nTao test runner comp'))).toBeUndefined()
    Expect(completion.read('stdout', Buffer.from('other output\n'))).toBeUndefined()
    Expect(completion.read('stderr', Buffer.from('leted (exit 7); resource kinds: MessagePort\n'))).toBe(7)
    Expect(completion.diagnostic()).toContain('MessagePort')
  })

  for (const cleanupExit of [0, 9]) {
    Test(`keeps the reported failure when cleanup exits ${cleanupExit}`, async () => {
      const result = await CLI.run('/bin/sh', {
        args: [
          '-c',
          `trap 'exit ${cleanupExit}' TERM; printf 'Tao test runner completed (exit 7); resource kinds: Timeout\\n'; while :; do sleep 1; done`,
        ],
        completion: testRunnerCompletion(100),
        processPolicy: 'test',
        timeoutMs: 30_000,
        timeoutPolicy: 'bounded',
      })
      Expect(result.exitCode).toBe(7)
      Expect(result.stderr).toContain('Last observed resource kinds: Timeout')
      Expect(result.signal).not.toBe(null)
    })
  }
})
