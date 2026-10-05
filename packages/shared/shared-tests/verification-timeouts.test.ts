import { CLI, FS, Platform, VerificationTimeouts } from '@shared'
import { Deferred, Describe, Expect, mkTestDir, Test, testOverrideSlot, until } from '@shared/test'

const diagnosticMode = testOverrideSlot<string | undefined>({
  read: () => Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS'],
  write: value => {
    if (value === undefined) {
      delete Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS']
    } else {
      Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS'] = value
    }
  },
})
const clock = testOverrideSlot({
  read: () => Date.now,
  write: value => {
    Date.now = value
  },
})
type SetTimeoutCall = (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>
const timers = testOverrideSlot<SetTimeoutCall>({
  read: () => globalThis.setTimeout,
  write: value => {
    globalThis.setTimeout = value as typeof globalThis.setTimeout
  },
})

Describe('verification execution timeouts', () => {
  Test('requires the exact opt-in and preserves explicitly bounded execution', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE']) {
      Expect(VerificationTimeouts.resolve(4_913, 'environment', { TAO_VERIFY_NO_TIMEOUTS: value })).toBe(4_913)
    }
    Expect(VerificationTimeouts.resolve(4_913, 'environment', { TAO_VERIFY_NO_TIMEOUTS: 'true' })).toBe(undefined)
    Expect(VerificationTimeouts.resolve(undefined, 'environment', {})).toBe(undefined)
    Expect(VerificationTimeouts.resolve(4_913, 'bounded', { TAO_VERIFY_NO_TIMEOUTS: 'true' })).toBe(4_913)
  })

  Test('diagnostic children schedule neither wall nor idle watchdogs and still accept cancellation', async () => {
    const restoreMode = diagnosticMode.install('true')
    const originalTimer = globalThis.setTimeout
    const requestedBounds: number[] = []
    const restoreTimers = timers.install((...args) => {
      if (args[1] === 4_913 || args[1] === 7_829) {
        requestedBounds.push(args[1])
      }
      return originalTimer(...args)
    })
    let command: CLI.StartedCommand | undefined
    let output = ''
    try {
      command = CLI.start('/bin/sh', {
        args: ['-c', 'printf ready; read line'],
        idleOutputMs: 7_829,
        onOutput: (_stream, chunk) => {
          output += chunk.toString('utf8')
        },
        processPolicy: 'test',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeoutMs: 4_913, // budget-ok: watchdog scheduling under test, not a performance ceiling.
      })
      await until(() => output === 'ready', { description: 'the diagnostic child to publish readiness' })
      Expect(requestedBounds).toEqual([])
      Expect(command.kill('SIGTERM')).toBe(true)
      Expect((await command.waitForClose()).signal).toBe('SIGTERM')
      Expect(command.error).toBe(undefined)
      Expect(output).toBe('ready')
    } finally {
      command?.kill('SIGKILL')
      await command?.waitForClose()
      await command?.closeOutput()
      restoreTimers()
      restoreMode()
    }
  })

  for (const policy of ['environment', 'bounded'] as const) {
    Test(
      `diagnostic mutation lock ${
        policy === 'bounded'
          ? 'preserves an explicit wait deadline'
          : 'waits past its execution deadline for the live owner'
      }`,
      async () => {
        const root = await mkTestDir('verification-mutation-lock')
        const target = FS.resolvePath('target', root)
        await FS.mkdir(target)
        const lock = `${await FS.realPath(target)}.tao-file-mutation.lock`
        await FS.writeJson(lock, { pid: Platform.runtimeProcess.pid, token: 'live-owner' })
        const restoreMode = diagnosticMode.install('true')
        let now = 1_000
        const restoreClock = clock.install(() => now)
        const observedPastDeadline = Deferred()
        let inspections = 0
        let entered = false
        const waiting = FS.withFileMutationLock(target, root, async () => {
          entered = true
          return 'acquired'
        }, {
          inspectProcessIdentity: async () => {
            inspections++
            if (inspections === 2) {
              now += 300_001
            }
            if (inspections === 3) {
              observedPastDeadline.resolve()
            }
            return { evidence: 'alive' }
          },
          timeoutPolicy: policy,
        })
        try {
          if (policy === 'bounded') {
            await Expect(waiting).rejects.toThrow('Timed out waiting for the file mutation lock')
            Expect(entered).toBe(false)
            Expect((await FS.readJson<{ token: string }>(lock)).token).toBe('live-owner')
          } else {
            // A premature rejection is observed immediately rather than hanging on the owner probe.
            await Promise.race([observedPastDeadline.promise, waiting])
            Expect(entered).toBe(false)
            Expect(inspections).toBe(3)
            Expect((await FS.readJson<{ token: string }>(lock)).token).toBe('live-owner')
            await FS.remove(lock)
            Expect(await waiting).toBe('acquired')
            Expect(entered).toBe(true)
            Expect(await FS.exists(lock)).toBe(false)
          }
        } finally {
          await FS.remove(lock)
          await waiting.catch(() => {})
          restoreClock()
          restoreMode()
          await FS.remove(root)
        }
      },
    )
  }
})
