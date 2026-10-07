import type { createAndroid } from '@expo-host/dev-loop/expo-runner/android'
import { createExpoConfig } from '@expo-host/dev-loop/expo-runner/expo-config'
import type { FixedIosLaunchOperations } from '@expo-host/dev-loop/expo-runner/fixedIosLaunchCommand'
import type { SimulatorExpoGoDependencies } from '@expo-host/dev-loop/expo-runner/IosExpoGo'
import type { ExpoMetroSession } from '@expo-host/dev-loop/expo-runner/metro'
import { createExpoTargets } from '@expo-host/dev-loop/expo-runner/run-targets'
import { CLI, Errors, ReleaseCapabilities, type TrackedProcess } from '@shared'
import { Deferred, Describe, Expect, Test, testOverrideSlot, withCapturedOutput } from '@shared/test'

const udid = '01234567-89AB-CDEF-0123-456789ABCDEF'
const capabilitiesSlot = testOverrideSlot({
  read: () => ReleaseCapabilities.allows,
  write: value => Object.assign(ReleaseCapabilities, { allows: value }),
})

function fixture(options: { installed?: string; cached?: boolean; installFails?: boolean; offline?: boolean } = {}) {
  const events: string[] = []
  let stopped = false
  let cached = options.cached === true
  let download: (() => Promise<void>) | undefined
  const config = createExpoConfig(49_152, { stateRoot: '/fixture/project/.tao/cache/dev' })
  const appPath = '/fixture/project/.tao/cache/dev/expo-home/ios-simulator-app-cache/Expo-Go-2.35.1.app'
  const run = (async (command, spec = {}) => {
    const args = spec.args ?? []
    let stdout = ''
    let exitCode = 0
    if (command === 'xcrun' && args[1] === 'list') {
      stdout = JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid, name: 'iPhone 18 Pro', state: 'Booted' }],
        },
      })
    } else if (command === 'xcrun' && args[1] === 'get_app_container') {
      events.push(`inspect:${args[2]}`)
      stdout = options.installed === undefined ? '' : '/installed/ExpoGo.app'
      exitCode = options.installed === undefined ? 1 : 0
    } else if (command === 'plutil') {
      const installed = args[3]?.startsWith('/installed/')
      stdout = installed
        ? options.installed ?? ''
        : cached
        ? args[1] === 'CFBundleIdentifier' ? 'host.exp.Exponent' : '2.35.1'
        : ''
      exitCode = stdout ? 0 : 1
    } else {
      Errors.throwUnexpected(`Unexpected runtime fixture command: ${command} ${args.join(' ')}`)
    }
    return { command, args: [...args], stdout, stderr: '', exitCode, signal: null }
  }) as typeof CLI.run
  const iosExpoGo: SimulatorExpoGoDependencies = {
    run,
    loadDownloader: async () => ({
      getExpoGoVersionEntryAsync: async sdk => {
        events.push(`metadata:${sdk}`)
        if (options.offline === true) {
          Errors.throwHostEnvironment('fetch failed')
        }
        return { iosClientUrl: 'https://example.test/Expo-Go-2.35.1.tar.gz', iosClientVersion: '2.35.1' }
      },
      downloadAppAsync: async request => {
        Expect(request).toEqual({
          url: 'https://example.test/Expo-Go-2.35.1.tar.gz',
          outputPath: appPath,
          extract: true,
        })
        events.push('download')
        await download?.()
        cached = true
      },
    }),
  }
  const root: TrackedProcess = { pid: 45001, startedAt: 'owned-kernel', command: 'held launch' }
  let live = false
  const iosLaunch: FixedIosLaunchOperations = {
    start: (_command, spec = {}) => {
      live = true
      const closed = Deferred<CLI.CommandCloseResult>()
      const complete = (exitCode: number) => {
        live = false
        closed.resolve({ exitCode, signal: null })
      }
      return {
        args: [],
        command: '/bin/sh',
        pid: root.pid,
        exitCode: null,
        signalCode: null,
        closeOutput: async () => {},
        dispose: () => {},
        endStdin: () => complete(125),
        kill: () => {
          complete(0)
          return true
        },
        onceClose: () => {},
        onceError: () => {},
        waitForClose: () => closed.promise,
        writeStdin: () => {
          const args = spec.args!.slice(3)
          events.push(args.join(' '))
          const failed = args[1] === 'install' && options.installFails
          if (failed) {
            spec.onOutput?.('stderr', Buffer.from('fixture install refused'))
          }
          complete(failed ? 1 : 0)
          return true
        },
      }
    },
    tree: {
      identities: pids => new Map(live && pids.includes(root.pid) ? [[root.pid, root]] : []),
      descendants: () => [],
      sameProcess: (current, expected) => current?.startedAt === expected.startedAt,
      processGroupOf: () => 45000,
    },
    processIsAlive: () => live,
  }
  const targets = createExpoTargets(
    config,
    {
      expoOpenEndpoint: async () => {
        events.push('endpoint')
        return { url: 'exp://192.0.0.2:49152' }
      },
      endpointUrl: () => 'exp://192.0.0.2:49152',
    } as unknown as ExpoMetroSession,
    {} as ReturnType<typeof createAndroid>,
    {
      iosExpoGo,
      iosLaunch,
      iosSimulator: async () => ({ udid, name: 'iPhone 18 Pro', state: 'Booted' }),
    },
  )
  return {
    events,
    appPath,
    open: () => targets.openStartupTargets(['ios'], () => stopped),
    cancel: () => stopped = true,
    setDownload: (next: () => Promise<void>) => download = next,
    withOverrides: async <T>(body: () => Promise<T>) => {
      const restores = [
        capabilitiesSlot.install(capability => capability !== 'companion'),
      ]
      try {
        return await withCapturedOutput(body)
      } finally {
        for (const restore of restores.reverse()) {
          restore()
        }
      }
    },
  }
}

Describe('automatic iOS simulator runtime preparation', () => {
  Test('requesting iOS installs its missing SDK runtime before opening this Metro session', async () => {
    const f = fixture()
    const captured = await f.withOverrides(f.open)
    Expect(captured.result).toEqual([{
      target: 'ios',
      dispatched: true,
      mobileDispatch: { kind: 'expo-go', appId: 'host.exp.Exponent', devUrl: 'exp://192.0.0.2:49152' },
    }])
    Expect(f.events).toEqual([
      `inspect:${udid}`,
      'metadata:57.0.0',
      'download',
      `simctl install ${udid} ${f.appPath}`,
      'endpoint',
      `simctl openurl ${udid} exp://192.0.0.2:49152`,
    ])
    Expect(captured.stdout + captured.stderr).toContain('Installing iOS runtime on iPhone 18 Pro.')
  })

  Test('an installed SDK-compatible runtime opens without a download or reinstall', async () => {
    const f = fixture({ installed: '2.35.1' })
    const captured = await f.withOverrides(f.open)
    Expect(captured.result[0]?.dispatched).toBe(true)
    Expect(f.events).toEqual([
      `inspect:${udid}`,
      'metadata:57.0.0',
      'endpoint',
      `simctl openurl ${udid} exp://192.0.0.2:49152`,
    ])
  })

  Test('offline, an installed runtime opens without the version check', async () => {
    const f = fixture({ installed: '56.0.4', offline: true })
    const captured = await f.withOverrides(f.open)
    Expect(captured.result[0]?.dispatched).toBe(true)
    Expect(f.events).toEqual([
      `inspect:${udid}`,
      'metadata:57.0.0',
      'endpoint',
      `simctl openurl ${udid} exp://192.0.0.2:49152`,
    ])
    Expect(captured.stdout + captured.stderr).toContain('using the installed Expo Go 56.0.4')
  })

  Test('offline, a missing runtime reports the failed version check', async () => {
    const f = fixture({ offline: true })
    const captured = await f.withOverrides(f.open)
    Expect(captured.result).toEqual([{ target: 'ios', dispatched: false }])
    Expect(f.events).toEqual([`inspect:${udid}`, 'metadata:57.0.0'])
  })

  Test('an incompatible installed runtime is replaced using its cached SDK-matched app', async () => {
    const f = fixture({ installed: '56.0.4', cached: true })
    const captured = await f.withOverrides(f.open)
    Expect(captured.result[0]?.dispatched).toBe(true)
    Expect(f.events).toEqual([
      `inspect:${udid}`,
      'metadata:57.0.0',
      `simctl install ${udid} ${f.appPath}`,
      'endpoint',
      `simctl openurl ${udid} exp://192.0.0.2:49152`,
    ])
  })

  Test('cancellation during runtime download prevents simulator installation and URL dispatch', async () => {
    const f = fixture()
    const downloading = Deferred<void>()
    const downloaded = Deferred<void>()
    f.setDownload(async () => {
      downloading.resolve()
      await downloaded.promise
    })
    const captured = await f.withOverrides(async () => {
      const opening = f.open()
      await downloading.promise
      f.cancel()
      downloaded.resolve()
      return await opening
    })
    Expect(captured.result).toEqual([{ target: 'ios', dispatched: false }])
    Expect(f.events).toEqual([`inspect:${udid}`, 'metadata:57.0.0', 'download'])
  })

  Test('a runtime install failure reports the cause and never opens the URL', async () => {
    const f = fixture({ installFails: true })
    const captured = await f.withOverrides(f.open)
    Expect(captured.result).toEqual([{ target: 'ios', dispatched: false }])
    Expect(f.events).toEqual([
      `inspect:${udid}`,
      'metadata:57.0.0',
      'download',
      `simctl install ${udid} ${f.appPath}`,
    ])
    Expect(captured.stdout + captured.stderr).toContain('fixture install refused')
  })
})
