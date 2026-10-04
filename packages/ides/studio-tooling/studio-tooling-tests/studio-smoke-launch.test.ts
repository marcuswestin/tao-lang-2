import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { launchDirectory, writeManifestAtomically } from '../studio-tooling-src/StudioLaunchManifest'
import { readinessFromOutput, startStudioSmokeLaunch } from '../studio-tooling-src/StudioSmokeLaunch'

const readinessLine = JSON.stringify({
  appName: 'HNReader',
  artifactRoot: '/w/.artifacts/user/studio/launches/browser',
  launchId: 'browser-42',
  lifecycleLogPath: '/w/.artifacts/user/studio/launches/browser/logs/lifecycle.jsonl',
  manifestPath: '/w/.artifacts/user/studio/launches/browser-42.json',
  mode: 'browser',
  previewUrl: 'http://127.0.0.1:42001',
  projectRoot: '/w/Apps/HNReader',
  sessionId: 'abc',
  sessionUrl: 'http://127.0.0.1:42000/sessions/abc',
  studioUrl: 'http://127.0.0.1:42000',
  version: 1,
})

/** A stand-in for a started Studio, so the harness is tested without Metro or a browser. */
function fakeCommand(
  options: { exitCode?: number; exitsOnTerm?: boolean } = {},
): CLI.StartedCommand & { killed: string[] } {
  const killed: string[] = []
  let exitCode: number | null = options.exitCode ?? null
  return {
    args: [],
    closeOutput: async () => {},
    command: './dev',
    dispose: () => {},
    endStdin: () => {},
    get exitCode() {
      return exitCode
    },
    killed,
    kill: (signal = 'SIGTERM') => {
      killed.push(signal)
      if (signal === 'SIGTERM' && options.exitsOnTerm !== false) {
        exitCode = 0
      }
      return true
    },
    onceClose: () => {},
    onceError: () => {},
    signalCode: null,
    waitForClose: async () => ({ exitCode: 0, signal: null }),
    writeStdin: () => true,
  } as CLI.StartedCommand & { killed: string[] }
}

Describe('Studio smoke launch', () => {
  Test('reads readiness from output without scraping log lines', () => {
    const readiness = readinessFromOutput(
      ['[studio]: Project: /w/Apps/HNReader', '{"not":"readiness"}', readinessLine, '[studio]: Press Ctrl+C'].join(
        '\n',
      ),
    )

    Expect(readiness?.launchId).toBe('browser-42')
    Expect(readiness?.sessionUrl).toBe('http://127.0.0.1:42000/sessions/abc')
    Expect(readinessFromOutput('[studio]: starting')).toBeUndefined()
  })

  Test('starts Studio with --json and --no-browser and returns its readiness', async () => {
    const root = await mkTestDir('tao-smoke-launch-')
    let launch: Awaited<ReturnType<typeof startStudioSmokeLaunch>> | undefined
    try {
      let started: readonly string[] = []
      launch = await startStudioSmokeLaunch({
        appName: 'HNReader',
        port: 42_000,
        projectRoot: '/w/Apps/HNReader',
        repositoryRoot: root,
        start: (_command, args, onOutput) => {
          started = args
          onOutput(Buffer.from(`${readinessLine}\n`))
          return fakeCommand()
        },
      })

      Expect(started).toEqual([
        'studio',
        '/w/Apps/HNReader',
        '--no-browser',
        '--json',
        '--app',
        'HNReader',
        '--port',
        '42000',
      ])
      Expect(launch.readiness.launchId).toBe('browser-42')
      Expect(launch.output()).toContain('"sessionUrl"')
    } finally {
      await launch?.stop()
      await FS.remove(root)
    }
  })

  Test('stops the launch through its manifest and closes the spawned command', async () => {
    const root = await mkTestDir('tao-smoke-launch-stop-')
    try {
      await writeManifestAtomically(FS.resolvePath('browser-42.json', launchDirectory(root)), {
        artifactRoot: FS.resolvePath('.artifacts', root),
        generation: 1,
        launchId: 'browser-42',
        mode: 'browser',
        ownerPid: 4242,
        processes: [],
        repositoryRoot: root,
        startedAt: '2026-01-01T00:00:00.000Z',
        state: 'ready',
        version: 1,
      })
      const command = fakeCommand()
      const launch = await startStudioSmokeLaunch({
        projectRoot: '/w/Apps/HNReader',
        repositoryRoot: root,
        start: (_command, _args, onOutput) => {
          onOutput(Buffer.from(`${readinessLine}\n`))
          return command
        },
      })

      await launch.stop()
      await launch.stop()

      Expect(command.killed).toEqual(['SIGTERM'])
      Expect(await FS.exists(FS.resolvePath('browser-42.json', launchDirectory(root)))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('stops the launch when readiness never arrives, instead of leaking it', async () => {
    const root = await mkTestDir('tao-smoke-launch-timeout-')
    try {
      const command = fakeCommand()
      let thrown: unknown
      try {
        // This selects one readiness attempt. The helper still performs its poll wait;
        // the assertion proves timeout cleanup and output retention, not elapsed time.
        await startStudioSmokeLaunch({
          projectRoot: '/w/Apps/HNReader',
          repositoryRoot: root,
          start: (_command, _args, onOutput) => {
            onOutput(Buffer.from('[studio]: Expo exited with code=1\n'))
            return command
          },
          timeoutMs: 1, // budget-ok: Select one readiness attempt; no elapsed-time assertion.
        })
      } catch (error) {
        thrown = error
      }

      Expect((thrown as Error).message).toContain('never reported readiness')
      Expect((thrown as Error).message).toContain('Expo exited')
      Expect(command.killed).toEqual(['SIGTERM'])
    } finally {
      await FS.remove(root)
    }
  })

  Test('fails immediately when Studio exits before readiness', async () => {
    const root = await mkTestDir('tao-smoke-launch-exit-')
    try {
      const command = fakeCommand({ exitCode: 1 })

      await Expect(startStudioSmokeLaunch({
        projectRoot: '/w/Apps/HNReader',
        repositoryRoot: root,
        start: (_command, _args, onOutput) => {
          onOutput(Buffer.from('[studio]: Expo exited with code=1\n'))
          return command
        },
        timeoutMs: 60_000,
      })).rejects.toThrow('exited before reporting readiness (code=1 signal=null)')

      Expect(command.killed).toEqual([])
    } finally {
      await FS.remove(root)
    }
  })

  Test('escalates to SIGKILL when the launch ignores SIGTERM', async () => {
    const root = await mkTestDir('tao-smoke-launch-escalate-')
    try {
      const command = fakeCommand({ exitsOnTerm: false })
      const launch = await startStudioSmokeLaunch({
        projectRoot: '/w/Apps/HNReader',
        repositoryRoot: root,
        start: (_command, _args, onOutput) => {
          onOutput(Buffer.from(`${readinessLine}\n`))
          return command
        },
      })
      await launch.stop()

      Expect(command.killed).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      await FS.remove(root)
    }
  })
})
