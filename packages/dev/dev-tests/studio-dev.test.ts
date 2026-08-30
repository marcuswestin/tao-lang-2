import { FS } from '@shared'
import type { CLI, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioNative } from '../dev-src/studio/StudioNative'
import { StudioSmoke } from '../dev-src/studio/StudioSmoke'

Describe('Studio native wrapper foundation', () => {
  Test('generates a sandboxed local-only Electron main process', () => {
    const source = StudioNative.testing.mainScriptSource()

    Expect(source).toContain("require('electron')")
    Expect(source).toContain("app.setPath('userData', userDataPath)")
    Expect(source).toContain("app.commandLine.appendSwitch('remote-debugging-port'")
    Expect(source).toContain("['127.0.0.1', 'localhost', '[::1]']")
    Expect(source).toContain('contextIsolation: true')
    Expect(source).toContain('nodeIntegration: false')
    Expect(source).toContain('sandbox: true')
    Expect(source).toContain("externalUrl.protocol === 'http:' || externalUrl.protocol === 'https:'")
    Expect(source).toContain("return { action: 'deny' }")
    Expect(source).toContain("mainWindow.webContents.on('will-navigate'")
  })

  Test('requires the installed Electron executable instead of accepting an orphaned shim', async () => {
    const packageRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-electron-', FS.tmpdir()))
    try {
      await FS.writeText(FS.resolvePath('path.txt', packageRoot), 'Electron.app/Contents/MacOS/Electron')
      await Expect(StudioNative.testing.installedElectronExecutablePath([packageRoot])).resolves.toBe(undefined)

      const executablePath = FS.resolvePath('dist/Electron.app/Contents/MacOS/Electron', packageRoot)
      await FS.mkdir(FS.dirname(executablePath))
      await FS.writeText(executablePath, '#!/bin/sh\n')

      await Expect(StudioNative.testing.installedElectronExecutablePath([packageRoot])).resolves.toBe(executablePath)
    } finally {
      await FS.remove(packageRoot)
    }
  })

  Test('stops Electron gracefully and closes process resources', async () => {
    const fake = fakeCommand(true)

    await StudioNative.testing.stopCommand(fake.command, async () => {})

    Expect(fake.events).toEqual(['kill SIGTERM', 'close-output', 'dispose'])
  })

  Test('forces Electron closed after the graceful timeout and closes process resources', async () => {
    const fake = fakeCommand(false)

    await StudioNative.testing.stopCommand(fake.command, async () => {})

    Expect(fake.events).toEqual(['kill SIGTERM', 'kill SIGKILL', 'close-output', 'dispose'])
  })

  Test('packages an installed macOS Electron app as a local Tao Studio bundle', async () => {
    if (await StudioNative.testing.installedElectronAppPath() === undefined) {
      return
    }
    const outputRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-native-package-', FS.tmpdir()))
    try {
      const packaged = await StudioNative.packageApp({
        appName: 'Tao Studio Test',
        bundleIdentifier: 'dev.tao-lang.studio.test',
        outputRoot,
      })

      Expect(packaged.appPath).toBe(FS.resolvePath('Tao Studio Test.app', outputRoot))
      Expect(await FS.isDirectory(packaged.appPath)).toBe(true)
      Expect(await FS.isFile(packaged.executablePath)).toBe(true)
      Expect(await FS.readText(packaged.mainPath)).toContain('sandbox: true')
      Expect(await FS.readJson(packaged.packageJsonPath)).toMatchObject({
        main: 'main.cjs',
        name: 'tao-studio-native',
        productName: 'Tao Studio Test',
      })
      const infoPlist = await FS.readText(FS.resolvePath('Contents/Info.plist', packaged.appPath))
      Expect(infoPlist).toContain('<string>Tao Studio Test</string>')
      Expect(infoPlist).toContain('<string>dev.tao-lang.studio.test</string>')
    } finally {
      await FS.remove(outputRoot)
    }
  })
})

Describe('Studio smoke resource isolation', () => {
  Test('allocates deterministic disjoint artifacts and ports by run, shard, and worker', () => {
    const first = StudioSmoke.resources({ runId: 'run-17', shardIndex: 2, workerIndex: 3 })
    const same = StudioSmoke.resources({ runId: 'run-17', shardIndex: 2, workerIndex: 3 })
    const otherWorker = StudioSmoke.resources({ runId: 'run-17', shardIndex: 2, workerIndex: 4 })
    const otherShard = StudioSmoke.resources({ runId: 'run-17', shardIndex: 3, workerIndex: 3 })

    Expect(same).toEqual(first)
    Expect(first.artifactRoot).toEndWith('.artifacts/tests/studio-smoke/run-17/shard-2/worker-3')
    Expect(
      new Set([
        first.serverPort,
        first.previewPort,
        first.electronDebuggingPort,
        otherWorker.serverPort,
        otherWorker.previewPort,
        otherWorker.electronDebuggingPort,
        otherShard.serverPort,
        otherShard.previewPort,
        otherShard.electronDebuggingPort,
      ]).size,
    ).toBe(9)
  })

  Test('rejects unsafe artifact ids and out-of-range lanes', () => {
    Expect(() => StudioSmoke.resources({ runId: '../escape', shardIndex: 0, workerIndex: 0 })).toThrow(
      'run id must use only',
    )
    Expect(() => StudioSmoke.resources({ runId: 'run', shardIndex: 16, workerIndex: 0 })).toThrow(
      'shard index must be an integer from 0 through 15',
    )
    Expect(() => StudioSmoke.resources({ runId: 'run', shardIndex: 0, workerIndex: 64 })).toThrow(
      'worker index must be an integer from 0 through 63',
    )
  })
})

function fakeCommand(graceful: boolean): {
  command: Pick<CLI.StartedCommand, 'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'signalCode' | 'waitForClose'>
  events: string[]
} {
  const events: string[] = []
  let exitCode: number | null = null
  let signalCode: Platform.ProcessSignal | null = null
  let resolveClose!: (result: CLI.CommandCloseResult) => void
  const close = new Promise<CLI.CommandCloseResult>(resolve => {
    resolveClose = resolve
  })
  return {
    command: {
      closeOutput: async () => {
        events.push('close-output')
      },
      dispose: () => {
        events.push('dispose')
      },
      get exitCode() {
        return exitCode
      },
      kill(signal = 'SIGTERM') {
        events.push(`kill ${signal}`)
        if (graceful && signal === 'SIGTERM') {
          exitCode = 0
          resolveClose({ exitCode, signal: null })
        } else if (signal === 'SIGKILL') {
          signalCode = signal
          resolveClose({ exitCode: null, signal })
        }
        return true
      },
      get signalCode() {
        return signalCode
      },
      waitForClose: () => close,
    },
    events,
  }
}
