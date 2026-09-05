import { CLI, Errors, FS, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { createServer } from 'node:net'
import { OutputText } from '../dev-src/cli/OutputText'
import { DevLoopTUI } from '../dev-src/expo-dev-loop/DevLoopTUI'
import { createDevLoopExpoSession } from '../dev-src/expo-dev-loop/expo-dev-loop'
import { createExpoConfig } from '../dev-src/expo-dev-loop/expo-runner/expo-config'
import { ExpoServer, formatExpoExitFailure } from '../dev-src/expo-dev-loop/expo-runner/expo-server'
import { ExpoRunner } from '../dev-src/expo-dev-loop/expo-runner/ExpoRunner'
import { parseIfconfigIPv4, preferredLanIPv4 } from '../dev-src/expo-dev-loop/expo-runner/lan-host'
import { type ExpoFetch, expoRuntimeLink, fetchExpoOpenEndpoint } from '../dev-src/expo-dev-loop/expo-runner/metro'
import {
  devicectlFailure,
  expoGoUrl,
  iosPhysicalDevicesFromDevicectl,
  runDevicectlJson,
} from '../dev-src/expo-dev-loop/expo-runner/physical-device'
import { simulatorOpenFailure } from '../dev-src/expo-dev-loop/expo-runner/run-targets'
import { handleCommandKey } from '../dev-src/expo-dev-loop/keyboard-input/CommandKeys'
import Commands from '../dev-src/expo-dev-loop/keyboard-input/Commands'
import Run from '../dev-src/expo-dev-loop/Run'

Describe('Expo dev-loop output severity', () => {
  Test('reads a child process line by its text, not by the stream it chose', () => {
    // Expo announces this on stderr on every start. Painted red it reads as a broken build.
    Expect(DevLoopTUI.devLoopOutputKind('stderr', 'Experimental Expo Autolinking module resolver is enabled.'))
      .toBe('info')
    Expect(DevLoopTUI.devLoopOutputKind('stderr', 'Starting Metro Bundler')).toBe('info')
    Expect(DevLoopTUI.devLoopOutputKind('stderr', 'warning: package.json is deprecated')).toBe('warn')
    Expect(DevLoopTUI.devLoopOutputKind('stderr', 'Error: listen EADDRINUSE: address already in use')).toBe('error')
    Expect(DevLoopTUI.devLoopOutputKind('stderr', 'Metro bundling failed')).toBe('error')
    Expect(DevLoopTUI.devLoopOutputKind('stdout', 'Error: this one already went to stdout')).toBe('info')
  })

  Test('turns a LaunchServices refusal into the one sentence that names a remedy', () => {
    const stderr = [
      'An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=115):',
      'Simulator device failed to open exp://192.168.50.107:8081.',
      'Underlying error (domain=LSApplicationWorkspaceErrorDomain, code=115):',
      "\tThe operation couldn't be completed. (LSApplicationWorkspaceErrorDomain error 115)",
    ].join('\n')
    const message = simulatorOpenFailure('iPhone 17 Pro', 'exp://192.168.50.107:8081', { stderr })

    Expect(message).toBe(
      'iPhone 17 Pro did not open exp://192.168.50.107:8081: no app installed on it handles that URL'
        + ' — install the development build or Expo Go there first',
    )
    Expect(message.includes('\n')).toBe(false)
  })

  Test('keeps an unrecognized simulator refusal readable without reprinting the whole dump', () => {
    const message = simulatorOpenFailure('iPhone 17 Pro', 'exp://host:8081', {
      stderr: 'An error was encountered processing the command:\n  Invalid device state\n',
    })

    Expect(message).toBe('iPhone 17 Pro did not open exp://host:8081: Invalid device state')
  })
})

Describe('Expo dev-loop command helpers', () => {
  Test('recognizes the verify and device shortcut keys', () => {
    Expect(Commands.isCommandKey('v')).toBe(true)
    Expect(Commands.isCommandKey('d')).toBe(true)
    Expect(Commands.isCommandKey('p')).toBe(true)
    Expect(Commands.isCommandKey('x')).toBe(false)
  })

  Test('quits on q and opens app selection only on s', async () => {
    const actions: string[] = []
    const context = {
      appPath: '/repo/App.tao',
      expo: ExpoRunner.createSession(49_152),
      finish: async (exitCode: number) => {
        actions.push(`finish:${exitCode}`)
      },
      repoRoot: '/repo',
      restart: async () => {},
      selectApp: async () => {
        actions.push('select-app')
      },
      stopServices: async () => {},
    }

    await handleCommandKey('q', context)
    await handleCommandKey('s', context)

    Expect(actions).toEqual(['finish:0', 'select-app'])
  })

  Test('routes target-opening shortcuts through the selected Expo session', async () => {
    const actions: string[] = []
    const expo = {
      ...ExpoRunner.createSession(49_152),
      openAndroid: async () => {
        actions.push('android')
        return true
      },
      openIosSimulator: async () => {
        actions.push('ios')
        return true
      },
      openPhysicalDevice: async () => {
        actions.push('device')
        return true
      },
      openWeb: async () => {
        actions.push('web')
        return true
      },
    }
    const context = {
      appPath: '/repo/App.tao',
      expo,
      finish: async () => {},
      repoRoot: '/repo',
      restart: async () => {},
      selectApp: async () => {},
      stopServices: async () => {},
    }

    await withCapturedOutput(async () => {
      await handleCommandKey('d', context)
      await handleCommandKey('w', context)
      await handleCommandKey('i', context)
      await handleCommandKey('a', context)
    })

    Expect(actions).toEqual(['device', 'web', 'ios', 'android'])
  })

  Test('keeps child-process output as the useful dev-loop failure', () => {
    const error = new Errors.CommandExecutionError({
      args: ['compile', 'App.tao'],
      command: './tao',
      exitCode: 1,
      signal: null,
      stderr: '\u001B[31mactual compiler error\u001B[39m\n',
      stdout: 'compiler context\n',
    })

    Expect(Run.formatFailure(error)).toBe('actual compiler error\ncompiler context')
  })

  Test('keeps Expo output with an unexpected-exit summary', () => {
    Expect(formatExpoExitFailure(
      'Starting project\n\u001B[31mError: Cannot find module ./publicFolder\u001B[39m\n',
      'Expo exited with code=1.',
    )).toBe([
      'Starting project',
      'Error: Cannot find module ./publicFolder',
      'Expo exited with code=1.',
    ].join('\n'))
  })

  Test('stops the complete Expo subprocess tree when Metro outlives its launcher', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-expo-process-tree-', FS.tmpdir()))
    const descendantPidPath = FS.resolvePath('descendant.pid', root)
    const shellScript = [
      '(trap "" TERM; while :; do sleep 1; done) &',
      'descendant=$!;',
      'echo "$descendant" > "$0";',
      'wait "$descendant"',
    ].join(' ')
    const server = new ExpoServer(root, createExpoConfig(49_153), async () => {}, {
      command: { argsPrefix: ['-c', shellScript, descendantPidPath], executable: '/bin/sh' },
      logRoot: root,
      runtimeToolchainSourceRoot: root,
      stopTimeoutMs: 25,
    })
    let descendantPid: number | undefined
    try {
      await server.start()
      for (let attempt = 0; attempt < 100 && descendantPid === undefined; attempt += 1) {
        if (await FS.isFile(descendantPidPath)) {
          const candidate = Number((await FS.readText(descendantPidPath)).trim())
          descendantPid = Number.isInteger(candidate) && candidate > 0 ? candidate : undefined
        }
        await Time.sleep(10)
      }
      if (descendantPid === undefined) {
        Errors.throwHostEnvironment('The fake Expo launcher did not start its descendant process.')
      }

      await server.stop()

      for (let attempt = 0; attempt < 100 && await processExists(descendantPid); attempt += 1) {
        await Time.sleep(10)
      }
      Expect(await processExists(descendantPid)).toBe(false)
    } finally {
      await server.stop().catch(() => undefined)
      if (descendantPid !== undefined) {
        await CLI.run('/bin/kill', { args: ['-KILL', String(descendantPid)] })
      }
      await FS.remove(root)
    }
  })
})

Describe('Expo dev-loop port helpers', () => {
  Test('derives every Expo endpoint and start argument from the session port', () => {
    const config = createExpoConfig(49_152)

    Expect(config.EXPO_PORT).toBe(49_152)
    Expect(config.EXPO_ORIGIN).toBe('http://127.0.0.1:49152')
    Expect(config.EXPO_GO_URL).toBe('exp://127.0.0.1:49152')
    Expect(config.EXPO_LOG_PATH).toBe('.artifacts/dev/expo-49152.log')
    Expect(config.EXPO_OPEN_URL).toBe('http://127.0.0.1:49152/_expo/open')
    Expect(config.EXPO_STATUS_URL).toBe('http://127.0.0.1:49152/status')
    Expect(config.EXPO_START_ARGS).toEqual([
      'expo',
      'start',
      '--host',
      'lan',
      '--port',
      '49152',
    ])
    Expect(config.EXPO_START_ENV.__UNSAFE_EXPO_HOME_DIRECTORY).toBe(Repo.resolvePath('.artifacts/cache/expo'))
  })

  Test('prefers 8081 when it is free', async () => {
    const selected = await ExpoRunner.portDiagnostics.selectAvailable(8081, async port => port)

    Expect(selected).toBe(8081)
  })

  Test('allocates another Expo port when 8081 is occupied', async () => {
    const selected = await ExpoRunner.portDiagnostics.selectAvailable(
      8081,
      async port => port === 8081 ? undefined : 49_152,
    )

    Expect(selected).toBe(49_152)
  })

  Test('reserves a different dev-loop port when Expo sees the preferred port as occupied', async () => {
    const blocker = createServer()
    blocker.unref()
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject)
      // Expo probes a wildcard listener. On macOS, an IPv4-loopback-only probe can
      // otherwise miss this IPv6 wildcard socket and hand Expo an occupied port.
      blocker.listen({ port: 0 }, resolve)
    })
    const address = blocker.address()
    const blockedPort = typeof address === 'object' && address !== null ? address.port : undefined
    try {
      if (blockedPort === undefined) {
        Errors.throwHostEnvironment('Expected the test listener to have a TCP port.')
      }
      const session = await createDevLoopExpoSession(blockedPort)
      try {
        Expect(session.config.EXPO_PORT).not.toBe(blockedPort)
        Expect(session.config.EXPO_PORT).toBeGreaterThan(0)
      } finally {
        await session.releasePortReservation()
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close(error => error ? reject(error) : resolve())
      })
    }
  })

  Test('explains environments that prohibit local TCP listeners', () => {
    const error = Object.assign(new Error('listen blocked'), { code: 'EPERM' })
    const normalized = ExpoRunner.portDiagnostics.normalizeReservationError(error)

    Expect(Errors.formatForUser(normalized)).toBe(
      'This environment does not allow a local development server to bind a TCP port. '
        + 'Run it in a terminal or development environment that permits local TCP listeners.',
    )
  })

  Test('formats lsof field output for listening processes', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 0,
      stderr: '',
      stdout: [
        'p1234',
        'cnode',
        'n127.0.0.1:8081',
        'p5678',
        'cexpo',
        'n*:8081',
        'p1234',
        'cnode',
        'n127.0.0.1:8081',
      ].join('\n'),
    })

    Expect(listeners).toEqual([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
      { command: 'expo', name: '*:8081', pid: 5678 },
    ])
  })

  Test('formats port listeners for prompts', () => {
    Expect(ExpoRunner.portDiagnostics.formatListeners([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
      { command: 'expo', pid: 5678 },
    ])).toBe('node pid 1234 (127.0.0.1:8081), expo pid 5678')
  })

  Test('formats the copy-pasteable graceful port-release command', () => {
    Expect(ExpoRunner.portDiagnostics.formatKillCommand([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
      { command: 'expo', pid: 5678 },
    ])).toBe('kill -TERM 1234 5678')
  })

  Test('uses parsed lsof listeners even when lsof exits nonzero with warnings', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 1,
      stderr: 'lsof: warning: incomplete information',
      stdout: ['p1234', 'cnode', 'n127.0.0.1:8081'].join('\n'),
    })

    Expect(listeners).toEqual([
      { command: 'node', name: '127.0.0.1:8081', pid: 1234 },
    ])
  })

  Test('treats blank nonzero lsof output as no listeners', () => {
    const listeners = ExpoRunner.portDiagnostics.formatLsofListeners({
      exitCode: 1,
      stderr: '',
      stdout: '',
    })

    Expect(listeners).toEqual([])
  })
})

Describe('Expo session scheme', () => {
  Test('passes a custom scheme to Expo only when one is requested', () => {
    Expect(createExpoConfig(8_099).EXPO_START_ARGS).not.toContain('--scheme')
    Expect(createExpoConfig(8_099, { scheme: 'taostudiocompanion' }).EXPO_START_ARGS).toEqual([
      'expo',
      'start',
      '--host',
      'lan',
      '--port',
      '8099',
      '--scheme',
      'taostudiocompanion',
    ])
  })
})

Describe('Expo physical-device host and device listing', () => {
  Test('prefers an active USB link-local address over Wi-Fi', () => {
    const interfaces = parseIfconfigIPv4(`
en0: flags=8863
	inet 192.168.1.20 netmask 0xffffff00
	status: active
en7: flags=8863
	inet 169.254.37.4 netmask 0xffff0000
	status: active
`)

    Expect(preferredLanIPv4(interfaces, '192.168.1.20')).toBe('169.254.37.4')
  })

  Test('falls back to the default-route address when USB is absent', () => {
    Expect(preferredLanIPv4([
      { active: true, address: '192.168.1.20', iface: 'en0' },
    ], '192.168.1.20')).toBe('192.168.1.20')
  })

  Test('keeps physical iPhones from devicectl output', () => {
    Expect(iosPhysicalDevicesFromDevicectl({
      result: {
        devices: [
          {
            deviceProperties: { name: 'roPhone' },
            hardwareProperties: { deviceType: 'iPhone', reality: 'physical', udid: 'UDID-1' },
            identifier: 'ID-1',
          },
          {
            deviceProperties: { name: 'Simulator' },
            hardwareProperties: { deviceType: 'iPhone', reality: 'virtual', udid: 'SIM-1' },
          },
          {
            deviceProperties: { name: 'Watch' },
            hardwareProperties: { deviceType: 'appleWatch', reality: 'physical', udid: 'WATCH-1' },
          },
        ],
      },
    })).toEqual([{ id: 'UDID-1', name: 'roPhone' }])
  })

  Test('keeps a physical device whose Xcode 26 report omits reality', () => {
    Expect(iosPhysicalDevicesFromDevicectl({
      result: {
        devices: [{
          deviceProperties: { name: 'roPhone' },
          hardwareProperties: { deviceType: 'iPhone', udid: '00008140-00163CD81481801C' },
          identifier: 'E4795A5B-C1B6-55BB-A855-1E96A66F15CF',
        }],
      },
    })).toEqual([{ id: '00008140-00163CD81481801C', name: 'roPhone' }])
  })

  Test('builds an Expo Go URL for the detected host', () => {
    Expect(expoGoUrl('169.254.37.4')).toBe('exp://169.254.37.4:8081')
  })

  Test('reads a devicectl JSON report through a temporary file and removes the file afterwards', async () => {
    const tmpRoot = await mkTestDir('tao-devicectl-json-')
    try {
      const seen: string[][] = []
      const run: typeof CLI.run = async (command, spec = {}) => {
        const args = [...(spec.args ?? [])]
        seen.push([command, ...args])
        await FS.writeJson(args[args.indexOf('--json-output') + 1] ?? '', { result: { devices: [] } })
        return { args, command, exitCode: 0, signal: null, stderr: '', stdout: '' }
      }

      const outcome = await runDevicectlJson<{ result?: { devices?: unknown[] } }>(['list', 'devices'], {
        run,
        tmpRoot,
      })

      Expect(outcome.failure).toBeUndefined()
      Expect(outcome.payload?.result?.devices).toEqual([])
      Expect(seen[0]?.slice(0, 4)).toEqual(['xcrun', 'devicectl', 'list', 'devices'])
      Expect(seen[0]?.[4]).toBe('--json-output')
      Expect(await FS.listDir(tmpRoot)).toEqual([])
    } finally {
      await FS.remove(tmpRoot)
    }
  })

  Test('names the devicectl failure from its JSON error block, else from the last stderr line', async () => {
    const tmpRoot = await mkTestDir('tao-devicectl-failure-')
    try {
      const reported = await runDevicectlJson(['list', 'devices'], {
        run: async (command, spec = {}) => {
          const args = [...(spec.args ?? [])]
          await FS.writeJson(args[args.indexOf('--json-output') + 1] ?? '', {
            error: {
              code: 1,
              domain: 'com.apple.coredevice.devicectl',
              userInfo: { NSLocalizedDescription: { string: 'Timed out waiting for CoreDeviceService.' } },
            },
            info: { outcome: 'failed' },
          })
          return { args, command, exitCode: 1, signal: null, stderr: 'ERROR: Timed out\n', stdout: '' }
        },
        tmpRoot,
      })
      Expect(reported.failure).toEqual({
        code: 1,
        domain: 'com.apple.coredevice.devicectl',
        message: 'Timed out waiting for CoreDeviceService.',
      })

      const silent = await runDevicectlJson(['list', 'devices'], {
        run: async (command, spec = {}) => ({
          args: [...(spec.args ?? [])],
          command,
          exitCode: 72,
          signal: null,
          stderr: 'xcrun: error: unable to find utility "devicectl", not a developer tool or in PATH\n',
          stdout: '',
        }),
        tmpRoot,
      })
      Expect(silent.payload).toBeUndefined()
      Expect(silent.failure?.message).toBe(
        'xcrun: error: unable to find utility "devicectl", not a developer tool or in PATH',
      )

      Expect(devicectlFailure({ result: {} })).toBeUndefined()
      Expect(devicectlFailure({ error: { code: 7 } })?.message).toBe(
        'devicectl reported a failure without a description.',
      )
    } finally {
      await FS.remove(tmpRoot)
    }
  })
})

Describe('Expo Metro runtime link helpers', () => {
  Test('asks /_expo/link for the development-client link and follows its redirect', async () => {
    const requests: string[] = []
    const fetchImpl: ExpoFetch = async input => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      requests.push(url)
      return new Response(null, {
        headers: { location: 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081' },
        status: 307,
      })
    }

    const link = await expoRuntimeLink('http://127.0.0.1:8081', { devClient: true, fetch: fetchImpl, platform: 'ios' })

    Expect(link).toBe('taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081')
    Expect(requests).toEqual(['http://127.0.0.1:8081/_expo/link?platform=ios&choice=expo-dev-client'])
  })

  Test('asks for the Expo Go link by default and reads a 404 as no link', async () => {
    const requests: string[] = []
    const fetchImpl: ExpoFetch = async input => {
      requests.push(String(input))
      return new Response('', { status: 404 })
    }

    Expect(await expoRuntimeLink('http://127.0.0.1:8081', { fetch: fetchImpl, platform: 'android' })).toBeUndefined()
    Expect(requests).toEqual(['http://127.0.0.1:8081/_expo/link?platform=android'])
  })

  Test('reports the /_expo/open status and JSON body without interpreting them', async () => {
    const answers = new Map<string, Response>([
      [
        'http://127.0.0.1:8081/_expo/open?platform=ios',
        new Response(JSON.stringify({ url: 'exp://x' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ],
      ['http://127.0.0.1:8082/_expo/open?platform=ios', new Response('Not found', { status: 404 })],
    ])
    const fetchImpl: ExpoFetch = async input => answers.get(String(input)) ?? new Response('', { status: 500 })

    const present = await fetchExpoOpenEndpoint('http://127.0.0.1:8081', 'ios', fetchImpl)
    Expect(present.status).toBe(200)
    Expect(present.body?.url).toBe('exp://x')

    const absent = await fetchExpoOpenEndpoint('http://127.0.0.1:8082', 'ios', fetchImpl)
    Expect(absent).toEqual({ body: undefined, status: 404, text: 'Not found' })
  })
})

Describe('Expo dev-loop dashboard layout', () => {
  Test('wraps long output instead of clipping it', () => {
    Expect(OutputText.wrapLine('Compiled /Users/ro/code/tao-lang-2/Apps/Books/Books.tao', 20)).toEqual([
      'Compiled /Users/ro/c',
      'ode/tao-lang-2/Apps/',
      'Books/Books.tao',
    ])
  })

  Test('wraps output by terminal width without splitting Unicode graphemes', () => {
    Expect(OutputText.wrapLine('123456789😀界', 10)).toEqual([
      '123456789',
      '😀界',
    ])
  })

  Test('uses a two-by-two grid when four skinny columns would clip', () => {
    const layout = DevLoopTUI.dashboardLayout({ columns: 120, rows: 28 }, 4, 2)
    Expect(layout.columnsPerRow).toBe(2)
    Expect(layout.columnWidth).toBeGreaterThanOrEqual(48)
  })

  Test('keeps a two-column grid in a wide terminal instead of a four-column strip', () => {
    const layout = DevLoopTUI.dashboardLayout({ columns: 220, rows: 28 }, 5, 2)
    Expect(layout.columnsPerRow).toBe(2)
  })

  Test('keeps one full-width column in a narrow terminal', () => {
    const layout = DevLoopTUI.dashboardLayout({ columns: 72, rows: 28 }, 4, 2)
    Expect(layout.columnsPerRow).toBe(1)
  })
})

async function processExists(pid: number): Promise<boolean> {
  return (await CLI.run('/bin/kill', { args: ['-0', String(pid)] })).exitCode === 0
}
