import { type CLI, Time } from '@shared'
import type { TrackedProcess } from '@shared/ProcessTree'
import { Deferred, Expect, Test } from '@shared/test'
import { mobileAppiumPreflight } from '../appium-driver-src/AppiumMobilePreflight'

Test('an unreadable newly started discovery process reports launch intent and never claims owned cleanup', async () => {
  let attempted = false
  let proved = false
  await Expect(mobileAppiumPreflight({
    command: 'fixed-pinned-appium',
    environment: {},
    onStartAttempt: () => {
      attempted = true
    },
    onOwnedCleanup: () => {
      proved = true
    },
  }, {
    start: () => ({ pid: 100 }) as unknown as CLI.StartedCommand,
    tree: {
      identities: () => new Map(),
      descendants: () => [],
      signalTracked: () => {},
      groupMembers: () => [],
      isGroupAlive: () => false,
      processGroupOf: () => undefined,
    },
  })).rejects.toThrow('identity is unproved')
  Expect(attempted).toBe(true)
  Expect(proved).toBe(false)
})

for (const cancellation of ['abort', 'budget'] as const) {
  Test(
    `fixed Appium discovery ${cancellation} stops only its recorded child identities and proves their group gone`,
    async () => {
      const closed = Deferred<CLI.CommandCloseResult>()
      const abort = new AbortController()
      const root = { command: 'owned preflight', pid: 100, startedAt: 'root' }
      const child = { command: 'owned descendant', pid: 101, startedAt: 'child' }
      const stranger = { command: 'unrelated', pid: 102, startedAt: 'stranger' }
      const live = new Map<number, TrackedProcess>([root, child, stranger].map(process => [process.pid, process]))
      const signalled: number[] = []
      let attempted = false
      let proved = false
      const process = {
        pid: 100,
        error: undefined,
        waitForClose: () => closed.promise,
        closeOutput: async () => {},
        dispose: () => {},
      } as unknown as CLI.StartedCommand
      const pending = mobileAppiumPreflight({
        command: 'fixed-pinned-appium',
        environment: {},
        signal: abort.signal,
        // budget-ok: The injected hung discovery process must exhaust its cancellation budget.
        timeoutMs: 10,
        onStarted: async () => {
          if (cancellation === 'abort') {
            abort.abort()
          }
        },
        onStartAttempt: () => {
          attempted = true
        },
        onOwnedCleanup: () => {
          proved = true
        },
      }, {
        processIsAlive: pid => live.has(pid),
        start: (_command, spec) => {
          Expect(spec?.args).toEqual(['driver', 'list', '--installed', '--json'])
          Expect(spec?.detached).toBe(true)
          return process
        },
        tree: {
          identities: pids => new Map(pids.flatMap(pid => live.has(pid) ? [[pid, live.get(pid)!] as const] : [])),
          descendants: () => live.has(101) ? [child] : [],
          processGroupOf: () => 100,
          signalTracked: processes => {
            for (const owned of processes) {
              if (live.get(owned.pid)?.startedAt === owned.startedAt) {
                signalled.push(owned.pid)
                live.delete(owned.pid)
              }
            }
            closed.resolve({ exitCode: 0, signal: 'SIGTERM' })
          },
          groupMembers: () => [...live.values()].filter(owned => owned.pid !== stranger.pid),
          isGroupAlive: () => live.has(root.pid) || live.has(child.pid),
        },
      }).then(() => 'success', () => 'cancelled')
      // budget-ok: This finite guard detects an unbounded cancellation contract; it is not a speed assertion.
      const result = await Promise.race([pending, Time.sleep(200).then(() => 'unbounded')])
      closed.resolve({ exitCode: 0, signal: null })
      await pending
      Expect(result).toBe('cancelled')
      Expect(signalled).toEqual([101, 100])
      Expect(attempted).toBe(true)
      Expect(proved).toBe(true)
      Expect(live.get(102)).toEqual(stranger)
    },
  )
}
