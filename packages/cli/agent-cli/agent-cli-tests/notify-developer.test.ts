import { Assert, CLI, Errors, FS, Platform, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { notifyDeveloper } from '../agent-cli-src/attention/NotifyDeveloper'

Describe('developer attention', () => {
  Test('sounds immediately and every four seconds, then acknowledgement stops only its own alert', async () => {
    const root = await mkTestDir('notify-developer-')
    let now = 0
    const soundedAt: number[] = []
    try {
      const other = FS.resolvePath('.artifacts/notify-developer/other.txt', root)
      await FS.writeText(other, 'another alert')
      await notifyDeveloper({ shutdownId: 'question', sound: 'ping' }, {
        root,
        now: () => now,
        sleep: async ms => {
          now += ms
        },
        play: async sound => {
          Expect(sound).toBe('Ping')
          soundedAt.push(now)
          now += 300 // Playback duration must not add drift to the four-second interval.
          if (soundedAt.length === 3) {
            await notifyDeveloper({ shutdownId: 'question', stop: true }, { root })
          }
        },
      })
      Expect(soundedAt).toEqual([0, 4_000, 8_000])
      Expect(await FS.exists(FS.resolvePath('.artifacts/notify-developer/question.txt', root))).toBe(false)
      Expect(await FS.readText(other)).toBe('another alert')
      await notifyDeveloper({ shutdownId: 'question', stop: true }, { root })
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
        play: async sound => {
          Expect(sound).toBe('Bottle')
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
      await Expect(notifyDeveloper({ shutdownId: '../foreign', stop: true }, { root })).rejects.toThrow('Shutdown ID')
      await Expect(notifyDeveloper({ sound: '../foreign' }, { root })).rejects.toThrow('Choose a notification sound')
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
        const args of [
          ['--shutdown-id', '../foreign'],
          ['--shutdown-id', 'a;b'],
          ['--stop', '--stop'],
          ['--sound', 'foreign'],
          ['--shutdown-id'],
          ['--id', 'old'],
          ['--flash-screen', '--flash-screen'],
        ]
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

  Test('host dispatcher forwards supported sound and flash options without changing them', async () => {
    const root = await mkTestDir('notify-host-options-')
    try {
      const source = FS.resolvePath('permissions.jsonc', root)
      const bin = FS.resolvePath('bin', root)
      const log = FS.resolvePath('args.txt', root)
      await FS.writeJson(source, { agentHostCommands: ['notify-developer'] })
      const just = FS.resolvePath('just', bin)
      await FS.writeText(just, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TAO_NOTIFY_TEST_ARGS"\n')
      await FS.chmod(just, 0o755)
      const args = ['--shutdown-id', 'question', '--sound', 'ping', '--flash-screen']
      const result = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [
          Repo.resolvePath('packages/cli/agent-cli/agent-cli-src/cli/agent-host-dispatch.ts'),
          source,
          'notify-developer',
          ...args,
        ],
        env: { PATH: `${bin}:${Platform.runtimeProcess.env['PATH'] ?? ''}`, TAO_NOTIFY_TEST_ARGS: log },
      })
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(log)).trim().split('\n')).toEqual(['notify-developer', ...args])
    } finally {
      await FS.remove(root)
    }
  })

  Test('flashes first at thirty seconds and repeats every four seconds independently of sound ticks', async () => {
    const root = await mkTestDir('notify-flash-')
    let now = 0
    const flashes: number[] = []
    try {
      await notifyDeveloper({}, {
        root,
        now: () => now,
        sleep: async ms => {
          now += ms
        },
        play: async () => {},
        flash: async () => {
          flashes.push(now)
          if (flashes.length === 3) {
            await notifyDeveloper({ stop: true }, { root })
          }
        },
      })
      Expect(flashes).toEqual([30_000, 34_000, 38_000])
    } finally {
      await FS.remove(root)
    }
  })

  Test('starts flashing immediately with the option and stops before thirty seconds without it', async () => {
    const root = await mkTestDir('notify-no-flash-')
    try {
      for (const flashScreen of [false, true]) {
        let now = 0
        let flashes = 0
        await notifyDeveloper({ flashScreen }, {
          root,
          now: () => now,
          sleep: async ms => {
            now += ms
            if (now >= 28_000) {
              await notifyDeveloper({ stop: true }, { root })
            }
          },
          play: async () => {},
          flash: async () => {
            flashes++
          },
        })
        Expect(flashes).toBe(flashScreen ? 7 : 0)
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('slow sound and flash playback do not delay each other', async () => {
    const root = await mkTestDir('notify-independent-effects-')
    let now = 0
    let pending: { at: number; finish: () => void }[] = []
    const sounds: number[] = []
    const flashes: number[] = []
    const playForThreeSeconds = (): Promise<void> =>
      new Promise(finish => {
        pending.push({ at: now + 3_000, finish })
      })
    try {
      await notifyDeveloper({}, {
        root,
        now: () => now,
        play: async () => {
          sounds.push(now)
          await playForThreeSeconds()
        },
        flash: async () => {
          flashes.push(now)
          await playForThreeSeconds()
        },
        sleep: async ms => {
          now += ms
          const completed = pending.filter(effect => effect.at <= now)
          pending = pending.filter(effect => effect.at > now)
          for (const effect of completed) {
            effect.finish()
          }
          if (now >= 39_500) {
            await notifyDeveloper({ stop: true }, { root })
            for (const effect of pending) {
              effect.finish()
            }
            pending = []
          }
        },
      })
      Expect(sounds).toEqual([0, 4_000, 8_000, 12_000, 16_000, 20_000, 24_000, 28_000, 32_000, 36_000])
      Expect(flashes).toEqual([30_000, 34_000, 38_000])
    } finally {
      for (const effect of pending) {
        effect.finish()
      }
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
