import { CLI, FS, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import { parseManagedLoopAcceptanceRecoveryArgs } from '../agent-cli-src/agent-config/ManagedLoopAcceptanceRecoveryArgs'

Test('managed borrowing recovery accepts only an invocation UUID without host selectors', () => {
  const invocation = 'bb7ab550-7b1e-4215-96e0-84a1866bccf1'
  Expect(parseManagedLoopAcceptanceRecoveryArgs(['--invocation', invocation])).toEqual({ invocation })
  for (
    const args of [
      [],
      ['--invocation'],
      ['--invocation', '../foreign'],
      ['--invocation', '/tmp/foreign'],
      ['--case', 'android-recovery'],
      ['--pid', '123'],
      ['--avd', 'Foreign'],
      ['--invocation', invocation, '--invocation', invocation],
      ['--invocation', invocation, '--generation', '123-foreign'],
      ['--invocation', invocation, '--endpoint', 'http://127.0.0.1:1'],
      ['--invocation', invocation, '--command', 'sh'],
      ['--invocation', invocation, '--app', 'hnreader'],
    ]
  ) {
    Expect(() => parseManagedLoopAcceptanceRecoveryArgs(args)).toThrow('Usage: test-host managed-loop-recover')
  }
})

Test(
  'the actual host-testing Just route preserves literal argument boundaries before recovery UUID rejection',
  async () => {
    const root = await mkTestDir('managed-recovery-argv-')
    const marker = FS.resolvePath('literal payload marker', root)
    const payload = `$(touch '${marker}'); touch '${marker}'; --pid 123`
    try {
      for (
        const args of [
          ['--invocation', payload],
          ['--invocation', ''],
          ['--invocation'],
          ['--invocation', 'bb7ab550-7b1e-4215-96e0-84a1866bccf1', '--invocation', payload],
          ['--invocation', 'bb7ab550-7b1e-4215-96e0-84a1866bccf1', '--app', 'hnreader'],
        ]
      ) {
        const result = await CLI.run('just', {
          args: ['test-host', 'managed-loop-recover', ...args],
          cwd: Repo.getRoot(),
          processPolicy: 'test',
          timeoutMs: 30_000,
        })
        Expect(result.exitCode).not.toBe(0)
        Expect(result.stdout + result.stderr).toMatch(
          /Usage: test-host managed-loop-recover|argument missing|requires.*argument/iu,
        )
        Expect(await FS.exists(marker)).toBe(false)
      }
    } finally {
      await FS.remove(root)
    }
  },
)
