import { FS, Repo, Time } from '@shared'
import type { CLI, Platform } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { StudioClientAssets } from '@studio'
import { startStudioClientDevReload } from '../dev-src/studio/StudioClientDevReload'
import { createRecentProjectStore, StudioDev } from '../dev-src/studio/StudioDev'
import { StudioNative } from '../dev-src/studio/StudioNative'
import { packagedExpoCommand } from '../dev-src/studio/StudioPackagedService'
import { StudioPreviewRuntime } from '../dev-src/studio/StudioPreviewRuntime'
import { stopStudioProcessTree, type StudioProcessTree } from '../dev-src/studio/StudioProcessTree'
import { StudioSmoke } from '../dev-src/studio/StudioSmoke'
import { StudioTestProcessOutput, StudioTestProcessRunner } from '../dev-src/studio/StudioTestProcessRunner'

Describe('Studio test process output', () => {
  Test('bounds displayed output while retaining structured failure locations', () => {
    const output = new StudioTestProcessOutput(48)
    output.write(Buffer.from(`${'discarded '.repeat(12)}\n`))
    output.write(Buffer.from('Tao check failed: saves a note\n'))
    output.write(Buffer.from('  Source: /projects/My Notes/Notes.test.tao:12:7\n'))
    output.write(Buffer.from('Expected one saved note.\nlatest output\n'))

    Expect(Buffer.byteLength(output.text())).toBeLessThan(150)
    Expect(output.text()).toContain('Earlier test output truncated')
    Expect(output.parseText()).toContain('Tao check failed: saves a note')
    Expect(output.parseText()).toContain('Source: /projects/My Notes/Notes.test.tao:12:7')
    Expect(output.parseText()).toContain('Expected one saved note.')
  })

  Test('truncates on UTF-8 boundaries and parses ANSI failure output idempotently', () => {
    const output = new StudioTestProcessOutput(11)
    output.write(Buffer.from('old 😀😀 tail\n\u001b[31mTao check failed: unicode\u001b[0m\n'))
    output.write(Buffer.from('  \u001b[33mSource: /tmp/Unicode.test.tao:2:3\u001b[0m\nExpected 😀.'))

    Expect(output.text()).not.toContain('�')
    const first = output.parseText()
    Expect(first).toContain('Tao check failed: unicode')
    Expect(first).toContain('Source: /tmp/Unicode.test.tao:2:3')
    Expect(first).toContain('Expected 😀.')
    Expect(output.parseText()).toBe(first)
  })

  Test('bounds shutdown of a stubborn test subprocess tree', async () => {
    const runner = new StudioTestProcessRunner({
      args: ['-c', "trap '' TERM; while :; do sleep 1; done"],
      command: '/bin/sh',
      cwd: FS.tmpdir(),
      stopTimeoutMs: 20,
    })
    const running = runner.run()
    await Time.sleep(30)

    const startedAt = Date.now()
    await runner.close()
    const result = await running

    Expect(Date.now() - startedAt).toBeLessThan(1_000)
    Expect(result.status).toBe('cancelled')
    Expect(runner.status().running).toBe(false)
  })
})

Describe('Studio native wrapper foundation', () => {
  Test('serves the prebuilt browser asset installed by packaged Studio', async () => {
    StudioClientAssets.usePrebuiltBundle('globalThis.__TAO_STUDIO_PACKAGED__ = true')
    try {
      await Expect(StudioClientAssets.bundle()).resolves.toBe('globalThis.__TAO_STUDIO_PACKAGED__ = true')
    } finally {
      StudioClientAssets.testing.resetBundle()
    }
  })

  Test('builds a nonempty Studio browser artifact for the native payload', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-studio-browser-bundle-', FS.tmpdir()))
    const path = FS.resolvePath('studio.js', root)
    try {
      await StudioNative.testing.stageStudioClientBundle(path)
      const source = await FS.readText(path)
      Expect(source.length).toBeGreaterThan(1_000)
      Expect(source).toContain('Loading Studio files')
      Expect(source).toContain('tao-studio-product-host')
      Expect(source).toContain('/api/data/fill')
      Expect(source).not.toContain('sourceMappingURL=data:')
      Expect(source).not.toContain(Repo.getRoot())
    } finally {
      await FS.remove(root)
    }
  })

  Test('builds the packaged Studio service with the prebuilt browser asset boundary', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-studio-service-bundle-', FS.tmpdir()))
    const path = FS.resolvePath('service.js', root)
    try {
      await StudioNative.testing.stageStudioPackagedServiceBundle(path)
      const source = await FS.readText(path)
      Expect(source.length).toBeGreaterThan(1_000)
      Expect(source).toContain('The packaged Tao Studio service requires its prebuilt browser bundle.')
    } finally {
      await FS.remove(root)
    }
  })

  Test('runs packaged Expo through the shipped Node runtime instead of host bunx', () => {
    Expect(packagedExpoCommand({
      runtimeToolchainRoot: '/Applications/Tao Studio.app/Contents/Resources/service/packages/runtime-toolchain',
      testNodePath: '/Applications/Tao Studio.app/Contents/Resources/service/bin/node',
    })).toEqual({
      argsPrefix: ['/Applications/Tao Studio.app/Contents/Resources/service/node_modules/expo/bin/cli'],
      executable: '/Applications/Tao Studio.app/Contents/Resources/service/bin/node',
    })
  })

  Test('recognizes an explicit Hutch executable instead of accepting a missing candidate', async () => {
    const packageRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-electrobun-', FS.tmpdir()))
    try {
      const executablePath = FS.resolvePath('hutch', packageRoot)
      await Expect(StudioNative.testing.installedHutchExecutablePath([executablePath])).resolves.toBe(undefined)

      await FS.writeText(executablePath, '#!/bin/sh\n')

      await Expect(StudioNative.testing.installedHutchExecutablePath([executablePath])).resolves.toBe(
        executablePath,
      )
    } finally {
      await FS.remove(packageRoot)
    }
  })

  Test('resolves Hutch from PATH before the installer home fallback', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-studio-hutch-resolution-', FS.tmpdir()))
    const pathRoot = FS.resolvePath('path-bin', root)
    const homeRoot = FS.resolvePath('home', root)
    const pathHutch = FS.resolvePath('hutch', pathRoot)
    const homeHutch = FS.resolvePath('.hutch/bin/hutch', homeRoot)
    try {
      await FS.mkdir(pathRoot)
      await FS.mkdir(FS.dirname(homeHutch))
      await FS.writeText(pathHutch, '#!/bin/sh\n')
      await FS.writeText(homeHutch, '#!/bin/sh\n')

      await Expect(StudioNative.testing.resolveHutchExecutablePath('hutch', {
        homeDirectory: homeRoot,
        path: pathRoot,
      })).resolves.toBe(pathHutch)
    } finally {
      await FS.remove(root)
    }
  })

  Test('uses an installed Hutch launcher before a refreshed shell PATH is available', async () => {
    const homeRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-hutch-home-', FS.tmpdir()))
    const homeHutch = FS.resolvePath('.hutch/bin/hutch', homeRoot)
    try {
      await FS.mkdir(FS.dirname(homeHutch))
      await FS.writeText(homeHutch, '#!/bin/sh\n')

      await Expect(StudioNative.testing.resolveHutchExecutablePath('hutch', {
        homeDirectory: homeRoot,
        path: '',
      })).resolves.toBe(homeHutch)
    } finally {
      await FS.remove(homeRoot)
    }
  })

  Test('gives exact Hutch installation and browser fallback guidance when the launcher is absent', async () => {
    const homeRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-no-hutch-', FS.tmpdir()))
    try {
      await Expect(StudioNative.testing.resolveHutchExecutablePath('hutch', {
        homeDirectory: homeRoot,
        path: '',
      })).rejects.toThrow(
        /Hutch is not installed[\s\S]*curl -fsSL https:\/\/hutch\.blackboard\.sh\/hutch\/install\.sh \| sh[\s\S]*--hutch[\s\S]*\.\/dev studio/,
      )
    } finally {
      await FS.remove(homeRoot)
    }
  })

  Test('rejects a missing explicit Hutch path with the resolved location', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-studio-explicit-hutch-', FS.tmpdir()))
    const missing = FS.resolvePath('missing-hutch', root)
    try {
      await Expect(StudioNative.testing.resolveHutchExecutablePath(missing)).rejects.toThrow(
        `The Hutch executable specified by --hutch was not found: ${missing}`,
      )
    } finally {
      await FS.remove(root)
    }
  })

  Test('preflights Hutch before generating native artifacts', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-studio-native-preflight-', FS.tmpdir()))
    const artifactRoot = FS.resolvePath('native-artifacts', root)
    const missingHutch = FS.resolvePath('missing-hutch', root)
    try {
      await Expect(StudioNative.start({
        artifactRoot,
        hutchPath: missingHutch,
        previewUrl: 'http://127.0.0.1:8081',
        projectUrl: 'http://127.0.0.1:55101/sessions/test',
        studioUrl: 'http://127.0.0.1:55101',
      })).rejects.toThrow('The Hutch executable specified by --hutch was not found')
      Expect(await FS.exists(artifactRoot)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('recognizes fatal native child exits without treating watch rebuilds as failures', () => {
    Expect(StudioNative.testing.nativeRuntimeCloseResult('Child process exited with code: 7')).toEqual({
      exitCode: 7,
      message: 'Native Studio runtime exited with code 7.',
    })
    Expect(StudioNative.testing.nativeRuntimeCloseResult('Child process terminated by signal: 6')).toEqual({
      exitCode: 1,
      message: 'Native Studio runtime terminated by signal 6.',
    })
    Expect(StudioNative.testing.nativeRuntimeCloseResult('Child process terminated by signal: 15')).toBeUndefined()
    Expect(StudioNative.testing.nativeRuntimeCloseResult('Watching for changes...')).toBeUndefined()
  })

  Test('installs and prepares the generated project through the selected Hutch launcher', async () => {
    const calls: Array<{ args: readonly string[] | undefined; command: string; cwd: string | undefined }> = []
    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/native', async (command, spec) => {
      calls.push({ args: spec.args, command, cwd: spec.cwd })
      return commandResult(command, spec, 0)
    })

    Expect(calls).toEqual([
      {
        args: ['install'],
        command: '/tools/hutch',
        cwd: '/workspace/native',
      },
      {
        args: ['electrobun', 'prepare'],
        command: '/tools/hutch',
        cwd: '/workspace/native',
      },
    ])
  })

  Test('surfaces Electrobun preparation failures', async () => {
    await Expect(StudioNative.testing.prepareElectrobun(
      '/tools/hutch',
      '/workspace/native',
      async (command, spec) => commandResult(command, spec, spec.args?.[0] === 'install' ? 0 : 7),
    )).rejects.toThrow('Command failed: /tools/hutch electrobun prepare')
  })

  Test('reads and validates the native shell runtime probe result', async () => {
    const outputRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-probe-', FS.tmpdir()))
    const resultPath = FS.resolvePath('result.json', outputRoot)
    try {
      await FS.writeJson(resultPath, {
        capabilities: { iframe: { passed: true }, websocket: { message: 'connected', passed: true } },
        manualChecks: ['Open the directory picker.'],
        passed: true,
      })

      await Expect(StudioNative.testing.waitForProbeResult(
        resultPath,
        { exitCode: null, signalCode: null },
      )).resolves.toEqual({
        capabilities: {
          iframe: { message: undefined, passed: true },
          websocket: { message: 'connected', passed: true },
        },
        manualChecks: ['Open the directory picker.'],
        passed: true,
      })
    } finally {
      await FS.remove(outputRoot)
    }
  })

  Test('stops Electrobun gracefully and closes process resources', async () => {
    const fake = fakeCommand(true)

    await StudioNative.testing.stopCommand(fake.command, async () => {})

    Expect(fake.events).toEqual(['kill SIGTERM', 'close-output', 'dispose'])
  })

  Test('forces Electrobun closed after the graceful timeout and closes process resources', async () => {
    const fake = fakeCommand(false)

    await StudioNative.testing.stopCommand(fake.command, async () => {})

    Expect(fake.events).toEqual(['kill SIGTERM', 'kill SIGKILL', 'close-output', 'dispose'])
  })

  Test('forces surviving descendants closed after their process-group leader exits', async () => {
    const events: string[] = []
    let running = true
    let resolveClose!: (result: CLI.CommandCloseResult) => void
    const close = new Promise<CLI.CommandCloseResult>(resolve => {
      resolveClose = resolve
    })
    const command: StudioProcessTree = {
      closeOutput: async () => {
        events.push('close-output')
      },
      dispose: () => events.push('dispose'),
      exitCode: null,
      isRunning: () => running,
      kill(signal = 'SIGTERM') {
        events.push(`kill ${signal}`)
        if (signal === 'SIGTERM') {
          resolveClose({ exitCode: 0, signal: null })
        } else {
          running = false
        }
        return true
      },
      onceClose() {},
      onceError() {},
      signalCode: null,
      waitForClose: () => close,
    }

    await stopStudioProcessTree(command, { sleep: async () => {} })

    Expect(events[0]).toBe('kill SIGTERM')
    Expect(events).toContain('kill SIGKILL')
    Expect(events).toContain('close-output')
    Expect(events).toContain('dispose')
  })

  Test('signals the complete detached native process group', () => {
    Expect(StudioNative.testing.processGroupKillSpec(4312, 'SIGKILL')).toEqual({
      args: ['-KILL', '--', '-4312'],
      command: '/bin/kill',
    })
  })

  Test('requires HTTPS release hosting before invoking Hutch packaging', async () => {
    await Expect(StudioNative.packageApp({
      releaseBaseUrl: 'http://releases.example.com/tao-studio',
    })).rejects.toThrow('Studio release base URL must be a valid HTTPS URL.')
  })

  Test('validates the executable Studio client with targeted release gates before native packaging', async () => {
    await Expect(StudioNative.testing.validateStudioRelease()).resolves.toBeUndefined()
  })

  Test('installs the packaged service closure from the frozen repository lock', async () => {
    const payloadRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-payload-', FS.tmpdir()))
    const calls: Array<{ args: readonly string[] | undefined; command: string; cwd: string | undefined }> = []
    try {
      await StudioNative.testing.installStudioServicePayload(payloadRoot, async (command, spec) => {
        calls.push({ args: spec.args, command, cwd: spec.cwd })
        return commandResult(command, spec, 0)
      })
      Expect(calls).toEqual([{
        args: [
          'install',
          '--production',
          '--frozen-lockfile',
          '--filter=tao-runtime-toolchain',
          '--linker=hoisted',
          '--backend=copyfile',
        ],
        command: 'bun',
        cwd: payloadRoot,
      }])
    } finally {
      await FS.remove(payloadRoot)
    }
  })
})

Describe('Studio smoke resource isolation', () => {
  Test('publishes only complete rebuilt Studio browser clients', async () => {
    let changed: (() => Promise<void>) | undefined
    let closed = 0
    const errors: string[] = []
    const reload = await startStudioClientDevReload({
      async loadAssets(attempt) {
        return {
          async bundle() {
            if (attempt === 2) {
              throw new Error('client does not compile yet')
            }
            return `bundle-${attempt}`
          },
          html(config) {
            return `html-${attempt}-${config.previewUrl}`
          },
        }
      },
      onError(error) {
        errors.push(String(error))
      },
      async subscribe(listener) {
        changed = listener
        return async () => {
          closed += 1
        }
      },
    })

    Expect(reload.revision()).toBe(0)
    await changed!()
    Expect(reload.revision()).toBe(1)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-1')
    Expect(reload.clientAssets.html({ previewUrl: 'preview' })).toBe('html-1-preview')

    await changed!()
    Expect(errors).toEqual(['Error: client does not compile yet'])
    Expect(reload.revision()).toBe(1)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-1')

    await changed!()
    Expect(reload.revision()).toBe(3)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-3')
    await reload.close()
    Expect(closed).toBe(1)
  })

  Test('allocates every Studio preview server from an ephemeral port', () => {
    Expect(StudioDev.testing.preferredExpoPort()).toBe(0)
  })

  Test('cleans up Studio resources when its terminal hangs up', () => {
    const handlers = new Map<Platform.ProcessSignal, () => void>()
    const removed: Platform.ProcessSignal[] = []
    const stops: number[] = []
    const remove = StudioDev.testing.addStopSignalHandlers(
      exitCode => stops.push(exitCode),
      (signal, listener) => {
        handlers.set(signal, listener)
        return () => removed.push(signal)
      },
    )

    handlers.get('SIGHUP')?.()
    handlers.get('SIGINT')?.()
    handlers.get('SIGTERM')?.()
    remove()

    Expect(stops).toEqual([129, 130, 143])
    Expect(removed).toEqual(['SIGHUP', 'SIGINT', 'SIGTERM'])
  })

  Test('persists and reloads validated recent projects in device-local Studio state', async () => {
    const stateRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-state-', FS.tmpdir()))
    const statePath = FS.resolvePath('recent-projects.json', stateRoot)
    const store = createRecentProjectStore(statePath)
    const recent = [
      { appName: 'First', lastOpenedAt: '2026-08-30T12:00:00.000Z', project: '/projects/first' },
      { appName: 'Second', lastOpenedAt: '2026-08-29T12:00:00.000Z', project: '/projects/second' },
    ]
    try {
      await Expect(store.load()).resolves.toEqual([])
      await store.save(recent)
      await store.flush()

      await Expect(createRecentProjectStore(statePath).load()).resolves.toEqual(recent)
      Expect(await FS.readJson(statePath)).toEqual({ recent, version: 1 })
    } finally {
      await FS.remove(stateRoot)
    }
  })

  Test('ignores malformed or unsupported recent-project state', async () => {
    const stateRoot = await FS.mkTmpDir(FS.resolvePath('tao-studio-state-', FS.tmpdir()))
    const statePath = FS.resolvePath('recent-projects.json', stateRoot)
    const store = createRecentProjectStore(statePath)
    try {
      await FS.writeText(statePath, '{not json')
      await Expect(store.load()).resolves.toEqual([])

      await FS.writeJson(statePath, {
        recent: [{ appName: '', lastOpenedAt: 'never', project: 42 }],
        version: 1,
      })
      await Expect(store.load()).resolves.toEqual([])
    } finally {
      await FS.remove(stateRoot)
    }
  })

  Test('uses the CLI entry only for the initial project and defaults shell-opened projects', async () => {
    const calls: Array<{ entryPath: string | undefined; projectPath: string }> = []
    const projects = StudioDev.testing.createProjectOpeners('App.tao', async (request, entryPath) => {
      calls.push({ entryPath, projectPath: request.projectPath })
      return request.projectPath
    })

    await Expect(projects.initial({ projectPath: '/workspace/first' })).resolves.toBe('/workspace/first')
    await Expect(projects.additional({ projectPath: '/workspace/second' })).resolves.toBe('/workspace/second')
    Expect(calls).toEqual([
      { entryPath: 'App.tao', projectPath: '/workspace/first' },
      { entryPath: undefined, projectPath: '/workspace/second' },
    ])
  })

  Test('closes each owned project resource once even when close is requested twice', async () => {
    const cleaned: string[] = []
    const resource = StudioDev.testing.withCleanup({ previewUrl: 'http://127.0.0.1:8081' }, [
      () => cleaned.push('watcher'),
      () => cleaned.push('metro'),
      () => cleaned.push('preview'),
    ])

    await Promise.all([resource.close(), resource.close()])

    Expect(cleaned).toEqual(['watcher', 'metro', 'preview'])
  })

  Test('attempts every session cleanup after an earlier resource fails to close', async () => {
    const cleaned: string[] = []

    await Expect(StudioDev.testing.cleanup([
      () => {
        cleaned.push('watcher')
        throw new Error('watcher close failed')
      },
      () => {
        cleaned.push('metro')
      },
      () => {
        cleaned.push('runtime')
      },
    ])).rejects.toThrow('watcher close failed')

    Expect(cleaned).toEqual(['watcher', 'metro', 'runtime'])
  })

  Test('creates disjoint preview runtime roots backed by the installed toolchain', async () => {
    const sourceRoot = Repo.resolvePath('packages/runtime-toolchain')
    const first = await StudioPreviewRuntime.create(sourceRoot)
    const second = await StudioPreviewRuntime.create(sourceRoot)
    try {
      Expect(first.root === second.root).toBe(false)
      Expect(await FS.readText(FS.resolvePath('index.ts', first.root))).toBe(
        await FS.readText(FS.resolvePath('index.ts', sourceRoot)),
      )
      Expect(await FS.realPath(FS.resolvePath('node_modules', first.root))).toBe(
        await FS.realPath(FS.resolvePath('node_modules', sourceRoot)),
      )
      Expect(await FS.readText(FS.resolvePath('metro.config.cjs', first.root))).toContain(
        'TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT',
      )
    } finally {
      await first.close()
      await second.close()
    }
  })

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
        otherWorker.serverPort,
        otherWorker.previewPort,
        otherShard.serverPort,
        otherShard.previewPort,
      ]).size,
    ).toBe(6)
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

function commandResult(command: string, spec: CLI.CommandSpec, exitCode: number): CLI.CommandResult {
  return {
    args: [...(spec.args ?? [])],
    command,
    cwd: spec.cwd,
    exitCode,
    signal: null,
    stderr: exitCode === 0 ? '' : 'failed',
    stdout: '',
  }
}

function fakeCommand(graceful: boolean): {
  command:
    & Pick<
      CLI.StartedCommand,
      'closeOutput' | 'dispose' | 'exitCode' | 'kill' | 'onceClose' | 'onceError' | 'signalCode' | 'waitForClose'
    >
    & { isRunning: () => boolean }
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
      isRunning() {
        return exitCode === null && signalCode === null
      },
      onceClose() {},
      onceError() {},
      get signalCode() {
        return signalCode
      },
      waitForClose: () => close,
    },
    events,
  }
}
