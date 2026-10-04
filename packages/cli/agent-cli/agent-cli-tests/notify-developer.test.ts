import { Assert, CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { notifyDeveloper } from '../agent-cli-src/attention/NotifyDeveloper'

Describe('developer attention', () => {
  Test('sounds immediately and every five seconds, then acknowledgement stops only its own alert', async () => {
    const root = await mkTestDir('notify-developer-')
    let now = 0
    const soundedAt: number[] = []
    try {
      const other = FS.resolvePath('.artifacts/notify-developer/other.txt', root)
      await FS.writeText(other, 'another alert')
      await notifyDeveloper({ id: 'question' }, {
        root,
        now: () => now,
        sleep: async ms => {
          now += ms
        },
        play: async () => {
          soundedAt.push(now)
          now += 300 // Playback duration must not add drift to the five-second interval.
          if (soundedAt.length === 3) {
            await notifyDeveloper({ id: 'question', stop: true }, { root })
          }
        },
      })
      Expect(soundedAt).toEqual([0, 5_000, 10_000])
      Expect(await FS.exists(FS.resolvePath('.artifacts/notify-developer/question.txt', root))).toBe(false)
      Expect(await FS.readText(other)).toBe('another alert')
      await notifyDeveloper({ id: 'question', stop: true }, { root })
    } finally {
      await FS.remove(root)
    }
  })

  Test('cancellation cleans up and does not play again', async () => {
    const root = await mkTestDir('notify-cancel-')
    const signals = new Map<Platform.ProcessSignal, () => void>()
    let plays = 0
    try {
      await notifyDeveloper({}, {
        root,
        play: async () => {
          plays++
        },
        sleep: async () => {
          signals.get('SIGTERM')?.()
        },
        onSignal: (signal, listener) => {
          signals.set(signal, listener)
          return () => {
            signals.delete(signal)
          }
        },
      })
      Expect(plays).toBe(1)
      Expect(signals.size).toBe(0)
      Expect(await FS.exists(FS.resolvePath('.artifacts/notify-developer/default.txt', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports playback failure and removes its alert', async () => {
    const root = await mkTestDir('notify-failure-')
    try {
      await Expect(notifyDeveloper({}, {
        root,
        play: async () => {
          Errors.throwHostEnvironment('audio unavailable')
        },
      })).rejects.toThrow('audio unavailable')
      Expect(await FS.exists(FS.resolvePath('.artifacts/notify-developer/default.txt', root))).toBe(false)
      await Expect(notifyDeveloper({ id: '../foreign', stop: true }, { root })).rejects.toThrow('Alert ID')
    } finally {
      await FS.remove(root)
    }
  })

  Test('host dispatcher rejects arbitrary arguments before starting a notification', async () => {
    const root = await mkTestDir('notify-host-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      await FS.writeJson(source, { agentHostCommands: ['notify-developer'] })
      for (
        const args of [['--id', '../foreign'], ['--id', 'a;b'], ['--stop', '--stop'], ['--sound', 'foreign'], ['--id']]
      ) {
        const result = await CLI.run(Platform.runtimeProcess.execPath, {
          args: [
            Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts'),
            source,
            'notify-developer',
            ...args,
          ],
          cwd: root,
        })
        Expect(result.exitCode).toBe(2)
        Expect(result.stderr).toContain('Usage:')
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('cancelling only the host dispatcher stops its notification child', async () => {
    const root = await mkTestDir('notify-host-cancel-')
    const source = FS.resolvePath('permissions.jsonc', root)
    const bin = FS.resolvePath('bin', root)
    const ready = FS.resolvePath('ready.txt', root)
    await FS.writeJson(source, { agentHostCommands: ['notify-developer'] })
    const just = FS.resolvePath('just', bin)
    await FS.writeText(just, '#!/bin/sh\nprintf "%s" "$$" > "$TAO_NOTIFY_TEST_READY"\nwhile :; do sleep 1; done\n')
    await FS.chmod(just, 0o755)
    const child = CLI.start(Platform.runtimeProcess.execPath, {
      args: [
        Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts'),
        source,
        'notify-developer',
      ],
      env: { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_NOTIFY_TEST_READY: ready },
    })
    try {
      const notificationPid = await Time.pollUntil(async () => {
        if (!await FS.exists(ready)) {
          return undefined
        }
        const pid = Number(await FS.readText(ready))
        return pid > 0 ? pid : undefined
      }, { intervalMs: 10, timeoutMs: 30_000 })
      Assert.defined(notificationPid, 'Expected the notification child to start.')
      Assert.defined(child.pid, 'Expected a host dispatcher process.')
      Platform.signalProcess(child.pid, 'SIGTERM')
      Expect((await child.waitForClose()).exitCode).toBe(143)
      Expect(Platform.processIsAlive(notificationPid)).toBe(false)
    } finally {
      child.kill()
      await child.waitForClose()
      await FS.remove(root)
    }
  })
})
