import { Describe, Expect, Test } from '@shared/test'
import { ExpoRunner } from '../dev-src/expo-dev-loop/expo-runner/ExpoRunner'
import { handleCommandKey } from '../dev-src/expo-dev-loop/keyboard-input/CommandKeys'
import Commands from '../dev-src/expo-dev-loop/keyboard-input/Commands'

Describe('Expo dev-loop command helpers', () => {
  Test('recognizes the verify dev-loop shortcut key', () => {
    Expect(Commands.isCommandKey('v')).toBe(true)
    Expect(Commands.isCommandKey('p')).toBe(false)
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
