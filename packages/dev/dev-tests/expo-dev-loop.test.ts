import { CLI, Errors, FS, Repo, Time } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { OutputText } from '../dev-src/cli/OutputText'
import { DevLoopTUI } from '../dev-src/expo-dev-loop/DevLoopTUI'
import { createExpoConfig } from '../dev-src/expo-dev-loop/expo-runner/expo-config'
import { ExpoServer, formatExpoExitFailure } from '../dev-src/expo-dev-loop/expo-runner/expo-server'
import { ExpoRunner } from '../dev-src/expo-dev-loop/expo-runner/ExpoRunner'
import { parseIfconfigIPv4, preferredLanIPv4 } from '../dev-src/expo-dev-loop/expo-runner/lan-host'
import {
  expoGoUrl,
  iosPhysicalDevicesFromDevicectl,
} from '../dev-src/expo-dev-loop/expo-runner/physical-device'
import { handleCommandKey } from '../dev-src/expo-dev-loop/keyboard-input/CommandKeys'
import Commands from '../dev-src/expo-dev-loop/keyboard-input/Commands'
import Run from '../dev-src/expo-dev-loop/Run'

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

  Test('explains environments that prohibit local TCP listeners', () => {
    const error = Object.assign(new Error('listen blocked'), { code: 'EPERM' })
    const normalized = ExpoRunner.portDiagnostics.normalizeReservationError(error)

    Expect(Errors.formatForUser(normalized)).toBe(
      'This environment does not allow Studio to bind a local TCP port. '
        + 'Run Studio in a terminal or development environment that permits listeners on 127.0.0.1.',
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

  Test('builds an Expo Go URL for the detected host', () => {
    Expect(expoGoUrl('169.254.37.4')).toBe('exp://169.254.37.4:8081')
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
