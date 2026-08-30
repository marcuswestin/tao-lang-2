import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { OutputText } from '../dev-src/cli/OutputText'
import { DevLoopTUI } from '../dev-src/expo-dev-loop/DevLoopTUI'
import { formatExpoExitFailure } from '../dev-src/expo-dev-loop/expo-runner/expo-server'
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
})

Describe('Expo dev-loop port helpers', () => {
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
