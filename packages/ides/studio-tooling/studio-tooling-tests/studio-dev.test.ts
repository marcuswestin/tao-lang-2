import { DevDataServer } from '@expo-host/dev-loop/dev-data/DevDataServer'
import { stopStudioProcessTree, type StudioProcessTree } from '@expo-host/dev-loop/StudioProcessTree'
import { CLI, Errors, FS, Platform, ProjectDevSession, Repo, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import { StudioClientAssets, StudioDeviceGateway, StudioDeviceTrustStore } from '@studio'
import { startStudioClientDevReload, StudioClientDevReload } from '../studio-tooling-src/StudioClientDevReload'
import {
  createRecentProjectStore,
  openStudioProjectResource,
  runStudioDev,
  StudioDev,
} from '../studio-tooling-src/StudioDev'
import { StudioNative } from '../studio-tooling-src/StudioNative'
import { packagedExpoCommand, startStudioPackagedService } from '../studio-tooling-src/StudioPackagedService'
import { StudioPreviewRuntime } from '../studio-tooling-src/StudioPreviewRuntime'
import { StudioSmoke } from '../studio-tooling-src/StudioSmoke'
import { StudioTestProcessOutput, StudioTestProcessRunner } from '../studio-tooling-src/StudioTestProcessRunner'

Describe('Studio project ownership', () => {
  Test('refuses a project owned by a CLI session before starting Expo', async () => {
    const root = await mkTestDir('tao-studio-owned-project-')
    await FS.writeText(FS.resolvePath('Project.tao', root), 'project { id "owned" name "Owned" }')
    const owner = await ProjectDevSession.acquire(root, 'cli')
    try {
      await Expect(async () =>
        openStudioProjectResource({ projectPath: root }, {
          entryPath: undefined,
          isStopping: () => false,
          stop: () => {},
        })
      ).toThrow(`already owned by cli session ${owner.record.id}`)
    } finally {
      await owner.release()
      await FS.remove(root)
    }
  })
})

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
    const root = await mkTestDir('tao-studio-browser-bundle-')
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

  Test('removes repository roots only from generated Tao source metadata', () => {
    const repositoryPrefix = `${Repo.getRoot()}/`
    const source = [
      `const view={source:{path:"${repositoryPrefix}Apps/Example.tao",start:1}}`,
      `const userLiteral="${repositoryPrefix}keep-this-value"`,
    ].join(';')

    const portable = StudioNative.testing.portableStudioClientBundle(source)

    Expect(portable).toContain('source:{path:"Apps/Example.tao"')
    Expect(portable).toContain(`userLiteral="${repositoryPrefix}keep-this-value"`)
  })

  Test('builds the packaged Studio service with the prebuilt browser asset boundary', async () => {
    const root = await mkTestDir('tao-studio-service-bundle-')
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
      runtimeToolchainRoot: '/Applications/Tao Studio.app/Contents/Resources/service/packages/apps/expo-host',
      testNodePath: '/Applications/Tao Studio.app/Contents/Resources/service/bin/node',
    })).toEqual({
      argsPrefix: ['/Applications/Tao Studio.app/Contents/Resources/service/node_modules/expo/bin/cli'],
      executable: '/Applications/Tao Studio.app/Contents/Resources/service/bin/node',
    })
  })

  Test('starts and tears down the packaged Studio data and device authorities', async () => {
    const root = await mkTestDir('tao-studio-packaged-data-')
    const bundlePath = FS.resolvePath('studio.js', root)
    await FS.writeText(bundlePath, 'globalThis.__TAO_STUDIO_PACKAGED__ = true')
    const service = await startStudioPackagedService({
      runtimeToolchainRoot: root,
      stdlibRoot: root,
      studioClientBundlePath: bundlePath,
      testCommandPath: FS.resolvePath('tao', root),
      testNodePath: Platform.runtimeProcess.execPath,
      userStateRoot: FS.resolvePath('state', root),
    })
    const probe = `http://127.0.0.1:${service.devDataPort}/data/probe`
    const deviceProbe = `http://127.0.0.1:${service.deviceGatewayPort}/device/probe`
    try {
      Expect((await fetch(probe)).status).toBe(401)
      Expect(await (await fetch(deviceProbe)).json()).toEqual({ protocol: 'tao-studio-device-v1' })
    } finally {
      await service.stop()
    }
    await Expect(fetch(probe)).rejects.toThrow()
    await Expect(fetch(deviceProbe)).rejects.toThrow()
  })

  Test('rolls back every packaged authority when a later startup stage fails', async () => {
    const root = await mkTestDir('tao-studio-packaged-rollback-')
    const bundlePath = FS.resolvePath('studio.js', root)
    await FS.writeText(bundlePath, 'globalThis.__TAO_STUDIO_PACKAGED__ = true')
    const options = {
      runtimeToolchainRoot: root,
      stdlibRoot: root,
      studioClientBundlePath: bundlePath,
      testCommandPath: FS.resolvePath('tao', root),
      testNodePath: Platform.runtimeProcess.execPath,
      userStateRoot: FS.resolvePath('state', root),
    }
    try {
      for (const failedStage of ['trust', 'gateway', 'recent', 'server'] as const) {
        const events: string[] = []
        const devData = {
          capability: 'capability',
          port: 7001,
          stop: async () => {
            events.push('dev.stop')
          },
        } as unknown as Awaited<ReturnType<typeof DevDataServer.start>>
        const trust = {
          flush: async () => {
            events.push('trust.flush')
          },
        } as unknown as StudioDeviceTrustStore
        const gateway = {
          port: 7002,
          stop: () => {
            events.push('gateway.stop')
          },
        } as unknown as StudioDeviceGateway
        await Expect(startStudioPackagedService(options, {
          async loadRecentProjects() {
            events.push('recent.load')
            if (failedStage === 'recent') {
              return Errors.throwHostEnvironment('recent failed')
            }
            return []
          },
          async openTrustStore() {
            events.push('trust.open')
            if (failedStage === 'trust') {
              return Errors.throwHostEnvironment('trust failed')
            }
            return trust
          },
          async startDevDataServer() {
            events.push('dev.start')
            return devData
          },
          async startDeviceGateway() {
            events.push('gateway.start')
            if (failedStage === 'gateway') {
              return Errors.throwHostEnvironment('gateway failed')
            }
            return gateway
          },
          async startSessionServer() {
            events.push('server.start')
            return Errors.throwHostEnvironment('server failed')
          },
        })).rejects.toThrow(`${failedStage} failed`)
        Expect(events).toEqual(
          failedStage === 'trust'
            ? ['dev.start', 'trust.open', 'dev.stop']
            : failedStage === 'gateway'
            ? ['dev.start', 'trust.open', 'gateway.start', 'trust.flush', 'dev.stop']
            : failedStage === 'recent'
            ? [
              'dev.start',
              'trust.open',
              'gateway.start',
              'recent.load',
              'gateway.stop',
              'trust.flush',
              'dev.stop',
            ]
            : [
              'dev.start',
              'trust.open',
              'gateway.start',
              'recent.load',
              'server.start',
              'gateway.stop',
              'trust.flush',
              'dev.stop',
            ],
        )
      }
    } finally {
      await FS.remove(root)
    }
  })

  Test('recognizes an explicit Hutch executable instead of accepting a missing candidate', async () => {
    const packageRoot = await mkTestDir('tao-studio-electrobun-')
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
    const root = await mkTestDir('tao-studio-hutch-resolution-')
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
    const homeRoot = await mkTestDir('tao-studio-hutch-home-')
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
    const homeRoot = await mkTestDir('tao-studio-no-hutch-')
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
    const root = await mkTestDir('tao-studio-explicit-hutch-')
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
    const root = await mkTestDir('tao-studio-native-preflight-')
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

  Test('finds only prior native development processes from the selected artifact root', () => {
    const output = [
      'p4300',
      'chutch-engine',
      'fcwd',
      'n/workspace/native',
      'p4312',
      'clauncher',
      'fcwd',
      'n/workspace/native/build/dev-macos-arm64/Tao Studio-dev.app/Contents/MacOS',
      'p4313',
      'cbun',
      'fcwd',
      'n/workspace/native/build/dev-macos-arm64/Tao Studio-dev.app/Contents/MacOS (deleted)',
      'p9000',
      'cbun',
      'fcwd',
      'n/workspace/other/build/dev-macos-arm64/Tao Studio-dev.app/Contents/MacOS',
    ].join('\n')

    Expect(StudioNative.testing.nativeDevelopmentProcessIds(output, '/workspace/native')).toEqual([
      4300,
      4312,
      4313,
    ])
  })

  Test('stops prior native processes before launching another shell from the same artifact root', async () => {
    const calls: Array<{ args: readonly string[] | undefined; command: string }> = []
    let probes = 0
    const stopped = await StudioNative.testing.stopExistingNativeDevelopmentProcesses(
      '/workspace/native',
      async (command, spec) => {
        calls.push({ args: spec.args, command })
        if (command === '/usr/sbin/lsof') {
          return {
            ...commandResult(command, spec, 0),
            stdout: 'p4312\ncbun\nfcwd\nn/workspace/native/build/dev-macos-arm64/Tao Studio-dev.app/Contents/MacOS\n',
          }
        }
        if (spec.args?.[0] === '-0') {
          probes += 1
          return commandResult(command, spec, probes === 1 ? 0 : 1)
        }
        return commandResult(command, spec, 0)
      },
      async () => {},
    )

    Expect(stopped).toBe(1)
    Expect(calls).toEqual([
      { args: ['-nP', '-d', 'cwd', '-Fpcn'], command: '/usr/sbin/lsof' },
      { args: ['-TERM', '4312'], command: '/bin/kill' },
      { args: ['-0', '4312'], command: '/bin/kill' },
      { args: ['-0', '4312'], command: '/bin/kill' },
    ])
  })

  Test('fails clearly when a prior native process cannot be stopped', async () => {
    await Expect(StudioNative.testing.stopExistingNativeDevelopmentProcesses(
      '/workspace/native',
      async (command, spec) => {
        if (command === '/usr/sbin/lsof') {
          return {
            ...commandResult(command, spec, 0),
            stdout: 'p4312\ncbun\nfcwd\nn/workspace/native/build/dev-macos-arm64/Tao Studio-dev.app/Contents/MacOS\n',
          }
        }
        return { ...commandResult(command, spec, 1), stderr: 'kill: 4312: Operation not permitted' }
      },
    )).rejects.toThrow('Existing native Studio processes could not be stopped (4312)')
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
    const calls: Array<{
      args: readonly string[] | undefined
      command: string
      cwd: string | undefined
      stdio: CLI.CommandSpec['stdio']
    }> = []
    await StudioNative.testing.prepareElectrobun('/tools/hutch', '/workspace/native', async (command, spec) => {
      calls.push({ args: spec.args, command, cwd: spec.cwd, stdio: spec.stdio })
      return commandResult(command, spec, 0)
    })

    Expect(calls).toEqual([
      {
        args: ['install'],
        command: '/tools/hutch',
        cwd: '/workspace/native',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      {
        args: ['electrobun', 'prepare'],
        command: '/tools/hutch',
        cwd: '/workspace/native',
        stdio: ['ignore', 'pipe', 'pipe'],
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
    const outputRoot = await mkTestDir('tao-studio-probe-')
    const resultPath = FS.resolvePath('result.json', outputRoot)
    try {
      await FS.writeJson(resultPath, {
        capabilities: { iframe: { passed: true }, websocket: { message: 'connected', passed: true } },
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
    const payloadRoot = await mkTestDir('tao-studio-payload-')
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
          '--filter=tao-expo-host',
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

  Test('discovers a grouped workspace package and keeps its group segment', async () => {
    // Regression: a one-level `packages/` listing finds only the repository's few ungrouped
    // packages (`compiler`, `dev`, `shared`) and none of the grouped ones, and flattening a
    // grouped package's target path to its basename lands it where nothing else in the payload —
    // `validateStudioServicePayload`, the runtime's own `node_modules` hops — expects to find it.
    const packagesRoot = await mkTestDir('tao-studio-package-roots-')
    try {
      await FS.writeText(
        FS.resolvePath('compiler/package.json', packagesRoot),
        JSON.stringify({ name: 'tao-compiler' }),
      )
      await FS.writeText(
        FS.resolvePath('apps/expo-host/package.json', packagesRoot),
        JSON.stringify({ name: 'tao-expo-host' }),
      )
      await FS.writeText(
        FS.resolvePath('apps/stdlib/package.json', packagesRoot),
        JSON.stringify({ name: 'tao-stdlib' }),
      )

      const { packageRelativePaths, packageRoots } = await StudioNative.testing.discoverStudioServicePackageRoots(
        packagesRoot,
      )

      Expect(packageRelativePaths.get('tao-compiler')).toBe('compiler')
      Expect(packageRelativePaths.get('tao-expo-host')).toBe('apps/expo-host')
      Expect(packageRelativePaths.get('tao-stdlib')).toBe('apps/stdlib')
      Expect(packageRoots.get('tao-expo-host')).toBe(FS.resolvePath('apps/expo-host', packagesRoot))
    } finally {
      await FS.remove(packagesRoot)
    }
  })
})

Describe('Studio smoke resource isolation', () => {
  Test('injects preview configuration without interpreting replacement tokens', () => {
    const marker = JSON.stringify({ previewUrl: '__TAO_STUDIO_DEV_PREVIEW_URL__' })
    const assets = StudioClientDevReload.testing.studioClientAssetSnapshot({
      bundle: 'bundle',
      html: `<script>globalThis.config=${marker}</script>`,
    })
    const previewUrl = "http://127.0.0.1:8081/$&-$1-$`-$'"

    Expect(assets.html({ previewUrl })).toContain(JSON.stringify({ previewUrl }))
  })

  Test('tells a server source change apart from one the browser rebuild covers', () => {
    // Only the browser bundle is rebuilt on a change. A reloaded page calling an endpoint the running server
    // does not have yet fails confusingly, so anything the server loads has to say "restart" out loud.
    const { isStudioServerSource } = StudioClientDevReload.testing

    Expect(isStudioServerSource('packages/ides/studio/studio-src/StudioServer.ts')).toBe(true)
    Expect(isStudioServerSource('packages/ides/studio/studio-src/agent-chat/AgentChatServer.ts')).toBe(true)
    // The panel and everything under client/ are bundled into the page, so a rebuild is enough for them.
    Expect(isStudioServerSource('packages/ides/studio/studio-src/client/StudioApiClient.ts')).toBe(false)
    Expect(isStudioServerSource('packages/ides/studio/studio-src/agent-chat/StudioAgentChatPanel.ts')).toBe(false)
    // The editor package is not the Studio server.
    Expect(isStudioServerSource('packages/ides/studio/studio-src/code-editor/CodeEditor.tsx')).toBe(false)
  })

  Test('publishes only complete rebuilt Studio browser clients', async () => {
    let changed: ((change: { serverSourcesChanged: boolean }) => Promise<void>) | undefined
    let closed = 0
    const errors: string[] = []
    const reload = await startStudioClientDevReload({
      async loadAssets(attempt) {
        return {
          async bundle() {
            if (attempt === 2) {
              Errors.throwHostEnvironment('client does not compile yet')
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
    await changed!({ serverSourcesChanged: false })
    Expect(reload.revision()).toBe(1)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-1')
    Expect(reload.clientAssets.html({ previewUrl: 'preview' })).toBe('html-1-preview')

    await changed!({ serverSourcesChanged: false })
    Expect(errors).toEqual(['HostEnvironmentError: client does not compile yet'])
    Expect(reload.revision()).toBe(1)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-1')

    await changed!({ serverSourcesChanged: false })
    Expect(reload.revision()).toBe(3)
    Expect(await reload.clientAssets.bundle()).toBe('bundle-3')
    await reload.close()
    Expect(closed).toBe(1)
  })

  Test('allocates every Studio preview server from an ephemeral port', () => {
    Expect(StudioDev.testing.preferredExpoPort()).toBe(0)
  })

  Test('puts the verified pinned Watchman before Metro starts', async () => {
    const calls: CLI.CommandSpec[] = []
    const environment = await StudioDev.testing.studioWatchmanEnvironment({
      environment: { PATH: '/repo/.devenv/profile/bin:/usr/bin:/bin' },
      isFile: async path => path === '/repo/.devenv/profile/bin/watchman',
      repositoryRoot: '/repo',
      run: async (command, spec) => {
        calls.push(spec)
        return {
          args: [...(spec.args ?? [])],
          command,
          exitCode: 0,
          signal: null,
          stderr: '',
          stdout: spec.args?.[0] === 'watch-project'
            ? '{"watch":"/repo"}'
            : spec.args?.includes('get-sockname')
            ? '{"sockname":"/repo/.watchman.sock"}'
            : '{"version":"2026.01.19.00","capabilities":["field-content.sha1hex","relative_root","suffix-set","wildmatch"]}',
        }
      },
      watchRoot: '/repo/.artifacts/dev/studio-preview/runtime-test',
    })

    Expect(environment['PATH']).toBe('/repo/.devenv/profile/bin:/usr/bin:/bin')
    Expect(environment['WATCHMAN_SOCK']).toBe('/repo/.watchman.sock')
    Expect(calls[0]?.args).toEqual(['list-capabilities', '--output-encoding=json', '--no-pretty', '--no-spawn'])
    Expect(calls[1]?.args).toEqual(['--no-pretty', 'get-sockname', '--no-spawn'])
    Expect(calls[2]?.args).toEqual(['watch-project', '/repo/.artifacts/dev/studio-preview/runtime-test'])
  })

  Test('stops before Metro when pinned Watchman is unavailable', async () => {
    await Expect(StudioDev.testing.studioWatchmanEnvironment({
      isFile: async () => false,
      repositoryRoot: '/repo',
    })).rejects.toThrow('cannot start Metro safely')
  })

  Test('stops before Metro when pinned Watchman cannot establish a watch', async () => {
    await Expect(StudioDev.testing.studioWatchmanEnvironment({
      isFile: async () => true,
      repositoryRoot: '/repo',
      run: async (command, spec) => ({
        args: ['watch-project', '/repo'],
        command,
        exitCode: spec.args?.[0] === 'watch-project' ? 1 : 0,
        signal: null,
        stderr: spec.args?.[0] === 'watch-project'
          ? 'Failed to open /Users/test/Library/LaunchAgents/com.github.facebook.watchman.plist: Operation not permitted'
          : '',
        stdout: spec.args?.[0] === 'watch-project'
          ? ''
          : spec.args?.includes('get-sockname')
          ? '{"sockname":"/repo/.watchman.sock"}'
          : '{"version":"2026.01.19.00","capabilities":["field-content.sha1hex","relative_root","suffix-set","wildmatch"]}',
      }),
    })).rejects.toThrow('ordinary host shell')
  })

  Test("stops before Metro when Watchman cannot pass Metro's no-spawn capability check", async () => {
    await Expect(StudioDev.testing.studioWatchmanEnvironment({
      isFile: async () => true,
      repositoryRoot: '/repo',
      run: async (command, spec) => ({
        args: [...(spec.args ?? [])],
        command,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: spec.args?.[0] === 'watch-project'
          ? '{"watch":"/repo"}'
          : spec.args?.includes('get-sockname')
          ? '{"sockname":"/repo/.watchman.sock"}'
          : '{"version":"2026.01.19.00","capabilities":["relative_root"]}',
      }),
    })).rejects.toThrow('missing Metro capability')
  })

  Test("stops before Metro when Watchman omits Metro's required version field", async () => {
    await Expect(StudioDev.testing.studioWatchmanEnvironment({
      isFile: async () => true,
      repositoryRoot: '/repo',
      run: async (command, spec) => ({
        args: [...(spec.args ?? [])],
        command,
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: spec.args?.[0] === 'watch-project'
          ? '{"watch":"/repo"}'
          : spec.args?.includes('get-sockname')
          ? '{"sockname":"/repo/.watchman.sock"}'
          : '{"capabilities":["field-content.sha1hex","relative_root","suffix-set","wildmatch"]}',
      }),
    })).rejects.toThrow('missing Metro capability')
  })

  Test('treats a native probe result as terminal and stops Hutch watch mode', async () => {
    const events: string[] = []
    const exitCode = await StudioDev.testing.completeNativeProbe({
      async stop() {
        events.push('stop')
      },
      async waitForProbe() {
        events.push('probe')
        return { capabilities: { websocket: { passed: false } }, passed: false }
      },
    })

    Expect(exitCode).toBe(1)
    Expect(events).toEqual(['probe', 'stop'])
  })

  Test('stops Hutch watch mode when the native probe cannot report', async () => {
    const events: string[] = []
    await Expect(StudioDev.testing.completeNativeProbe({
      async stop() {
        events.push('stop')
      },
      async waitForProbe() {
        events.push('probe')
        Errors.throwUnexpected('probe failed')
      },
    })).rejects.toThrow('probe failed')

    Expect(events).toEqual(['probe', 'stop'])
  })

  Test('preserves a probe failure when stopping Hutch also fails', async () => {
    const stopErrors: string[] = []
    await Expect(StudioDev.testing.completeNativeProbe({
      async stop() {
        Errors.throwUnexpected('stop failed')
      },
      async waitForProbe() {
        Errors.throwUnexpected('probe failed')
      },
    }, error => stopErrors.push(Errors.formatForLog(error)))).rejects.toThrow('probe failed')

    Expect(stopErrors).toHaveLength(1)
    Expect(stopErrors[0]).toContain('UnexpectedBehaviorError: stop failed')
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
    const stateRoot = await mkTestDir('tao-studio-state-')
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
    const stateRoot = await mkTestDir('tao-studio-state-')
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

  Test('publishes the generated app into the preview runtime before the bundler starts', async () => {
    const runtimeRoot = await mkTestDir('studio-publish-order-')
    const generatedApp = FS.resolvePath('_gen_tao-app/App.tsx', runtimeRoot)
    const steps: string[] = []
    let generatedAppWasPublished: boolean | undefined
    try {
      await StudioDev.testing.publishPreviewBeforeBundling({
        async compilePreview() {
          steps.push('compile')
          await FS.mkdir(FS.dirname(generatedApp))
          await FS.writeText(generatedApp, 'export default function App() {}\n')
        },
        isStopping: () => false,
        async startBundler() {
          steps.push('start')
          generatedAppWasPublished = await FS.exists(generatedApp)
        },
        async waitForBundler() {
          steps.push('wait')
          return true
        },
      })

      // The bundler only ever sees the files present when it crawls, so the compile must precede it.
      Expect(generatedAppWasPublished).toBe(true)
      Expect(steps).toEqual(['compile', 'start', 'wait'])
    } finally {
      await FS.remove(runtimeRoot)
    }
  })

  Test('never starts the bundler when opening is cancelled during the first compile', async () => {
    const steps: string[] = []
    let stopping = false

    await Expect(StudioDev.testing.publishPreviewBeforeBundling({
      compilePreview: async () => {
        steps.push('compile')
        stopping = true
      },
      isStopping: () => stopping,
      startBundler: async () => {
        steps.push('start')
      },
      waitForBundler: async () => {
        steps.push('wait')
        return true
      },
    })).rejects.toThrow('Studio project opening was cancelled.')

    Expect(steps).toEqual(['compile'])
  })

  Test('reports a cancelled open when the bundler never becomes ready', async () => {
    const steps: string[] = []

    await Expect(StudioDev.testing.publishPreviewBeforeBundling({
      compilePreview: async () => {
        steps.push('compile')
      },
      isStopping: () => false,
      startBundler: async () => {
        steps.push('start')
      },
      waitForBundler: async () => {
        steps.push('wait')
        return false
      },
    })).rejects.toThrow('Studio project opening was cancelled.')

    Expect(steps).toEqual(['compile', 'start', 'wait'])
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
        Errors.throwHostEnvironment('watcher close failed')
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

  Test('preserves a startup failure when rollback cleanup also fails', async () => {
    const primary = new Errors.HostEnvironmentError('Metro could not start.')
    const cleanup = new Errors.HostEnvironmentError('The preview root could not be removed.')
    const reported: unknown[] = []

    await Expect(StudioDev.testing.cleanupAfterFailure(primary, [
      () => {
        throw cleanup
      },
    ], error => reported.push(error))).rejects.toBe(primary)
    Expect(reported).toEqual([cleanup])
  })

  Test('routes a rejected native completion through the failure observer before exiting', async () => {
    const failure = new Errors.HostEnvironmentError('The native probe disconnected.')
    const events: unknown[] = []

    await StudioDev.testing.completeNativeLifecycle(
      Promise.reject(failure),
      exitCode => events.push(['exit', exitCode]),
      error => events.push(['failure', error]),
    )

    Expect(events).toEqual([
      ['failure', failure],
      ['exit', 1],
    ])
  })

  Test('delivers the original classified startup failure to an in-process observer', async () => {
    const root = await mkTestDir('tao-studio-failure-observer-')
    const failures: unknown[] = []
    try {
      const captured = await withCapturedOutput(async () =>
        await runStudioDev({
          native: true,
          nativeHutchPath: FS.resolvePath('missing-hutch', root),
          onFailure: error => failures.push(error),
          projectRoot: Repo.getRoot(),
          userStateRoot: FS.resolvePath('user-state', root),
        })
      )

      Expect(captured.result).toBe(1)
      Expect(failures).toHaveLength(1)
      Expect(failures[0]).toBeInstanceOf(Errors.UserInputError)
      Expect(Errors.messageOf(failures[0])).toContain('Hutch executable specified by --hutch was not found')
    } finally {
      await FS.remove(root)
    }
  })

  Test('creates disjoint preview runtime roots backed by the installed toolchain', async () => {
    const sourceRoot = Repo.resolvePath('packages/apps/expo-host')
    const artifactRoot = await mkTestDir('studio-preview-artifacts-')
    await FS.symlink(Repo.resolvePath('node_modules'), FS.resolvePath('node_modules', artifactRoot))
    let first: Awaited<ReturnType<typeof StudioPreviewRuntime.create>> | undefined
    let second: Awaited<ReturnType<typeof StudioPreviewRuntime.create>> | undefined
    try {
      first = await StudioPreviewRuntime.create(sourceRoot, { artifactRoot })
      second = await StudioPreviewRuntime.create(sourceRoot, { artifactRoot })
      Expect(first.root === second.root).toBe(false)
      Expect(first.root.startsWith(`${artifactRoot}/`)).toBe(true)
      // Expo refuses to start a TypeScript project unless `typescript` resolves from its root, and the
      // repository hoists it above the linked package node_modules.
      Expect(await FS.realPath(Bun.resolveSync('typescript/package.json', second.root))).toBe(
        await FS.realPath(Repo.resolvePath('node_modules/typescript/package.json')),
      )
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
      await first?.close()
      await second?.close()
      await FS.remove(artifactRoot)
    }
  })

  Test('keeps the bundler file map inside the preview runtime it describes', async () => {
    const sourceRoot = Repo.resolvePath('packages/apps/expo-host')
    const artifactRoot = await mkTestDir('studio-preview-file-map-')
    const runtime = await StudioPreviewRuntime.create(sourceRoot, { artifactRoot })
    try {
      // Metro keys its file map by project root, so the map of a per-session root is unreadable by
      // every later session. Inside the root, closing the session removes it; outside, it is a
      // couple of megabytes of permanent litter per Studio start.
      const previewConfigPath = FS.resolvePath('metro.config.cjs', runtime.root)
      const toolchainConfigPath = FS.resolvePath('metro.config.cjs', sourceRoot)
      const sharedPath = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      const inspectConfigs = `
        const { HCI } = require(${JSON.stringify(sharedPath)})
        const preview = require(${JSON.stringify(previewConfigPath)})
        const toolchain = require(${JSON.stringify(toolchainConfigPath)})
        HCI.writeLine(JSON.stringify({
          preview: preview.fileMapCacheDirectory,
          toolchain: toolchain.fileMapCacheDirectory,
        }))
      `
      const inspected = await CLI.run(Platform.runtimeProcess.execPath, {
        args: ['-e', inspectConfigs],
        env: { TAO_RUNTIME_TOOLCHAIN_SOURCE_ROOT: sourceRoot },
        stdio: 'pipe',
      })
      Expect(inspected.exitCode).toBe(0)
      const config = JSON.parse(inspected.stdout.trim()) as { preview?: string; toolchain?: string }

      Expect(config.preview).toBeDefined()
      Expect(await FS.realPath(FS.dirname(config.preview!))).toBe(await FS.realPath(runtime.root))
      // The toolchain project is stable and reuses its map, so it keeps Metro's shared default.
      Expect(config.toolchain).toBe(undefined)

      await runtime.close()
      Expect(await FS.exists(runtime.root)).toBe(false)
    } finally {
      await runtime.close()
      await FS.remove(artifactRoot)
    }
  })

  Test('gives the preview project the companion scheme and gateway bootstrap fact only', async () => {
    const sourceRoot = Repo.resolvePath('packages/apps/expo-host')
    const artifactRoot = await mkTestDir('studio-preview-companion-')
    const runtime = await StudioPreviewRuntime.create(sourceRoot, { artifactRoot, deviceGatewayPort: 43_210 })
    let plain: Awaited<ReturnType<typeof StudioPreviewRuntime.create>> | undefined
    try {
      const source = await FS.readJson<{ expo: Record<string, unknown> }>(FS.resolvePath('app.json', sourceRoot))
      const preview = await FS.readJson<{ expo: Record<string, unknown> }>(FS.resolvePath('app.json', runtime.root))
      Expect(source.expo['scheme']).toBeUndefined()
      Expect(preview.expo['scheme']).toBe('taostudiocompanion')
      Expect(preview.expo['extra']).toEqual({
        taoStudioDevice: { gatewayPort: 43_210, protocol: 'tao-studio-device-v1' },
      })
      Expect(preview.expo['slug']).toBe(source.expo['slug'])
      Expect(JSON.stringify(preview)).not.toContain('secret')

      // The dev data fact arrives once the session has resolved its app, and keeps the gateway fact.
      await runtime.configure({
        devData: {
          app: 'Notes-0123abcd',
          capability: 'test_capability_0123456789abcdef0123456789abcdef',
          port: 4_321,
          protocol: 'tao-dev-data-v1',
        },
      })
      const configured = await FS.readJson<{ expo: Record<string, unknown> }>(FS.resolvePath('app.json', runtime.root))
      Expect(configured.expo['extra']).toEqual({
        taoDevData: {
          app: 'Notes-0123abcd',
          capability: 'test_capability_0123456789abcdef0123456789abcdef',
          port: 4_321,
          protocol: 'tao-dev-data-v1',
        },
        taoStudioDevice: { gatewayPort: 43_210, protocol: 'tao-studio-device-v1' },
      })
      Expect(configured.expo['scheme']).toBe('taostudiocompanion')
      await runtime.close()
      plain = await StudioPreviewRuntime.create(sourceRoot, { artifactRoot })
      const plainConfig = await FS.readJson<{ expo: Record<string, unknown> }>(FS.resolvePath('app.json', plain.root))
      Expect(plainConfig.expo['scheme']).toBe('taostudiocompanion')
      Expect(plainConfig.expo['extra']).toBeUndefined()
    } finally {
      await runtime.close()
      await plain?.close()
      await FS.remove(artifactRoot)
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

  Test('gives each worktree its own port block, so two checkouts never claim one port', () => {
    const here = StudioSmoke.defaultShardIndex('/Users/dev/tao-lang-2')
    const linked = StudioSmoke.defaultShardIndex('/Users/dev/tao-lang-2/.claude/worktrees/feature-a')
    const otherLinked = StudioSmoke.defaultShardIndex('/Users/dev/tao-lang-2/.claude/worktrees/feature-b')

    // Every lane bound 42000 upward from shard 0, so the second worktree to start a Studio lane
    // died on a port the first one was serving.
    Expect(new Set([here, linked, otherLinked]).size).toBe(3)
    for (const shard of [here, linked, otherLinked]) {
      Expect(shard).toBeGreaterThanOrEqual(0)
      Expect(shard).toBeLessThan(StudioSmoke.shardCount)
    }
    Expect(StudioSmoke.defaultShardIndex('/Users/dev/tao-lang-2')).toBe(here)
  })

  Test('a lane with no explicit shard allocates from its own worktree block', () => {
    const allocated = StudioSmoke.resources({ runId: 'run-17', workerIndex: 1 })

    Expect(allocated.shardIndex).toBe(StudioSmoke.defaultShardIndex())
    Expect(allocated.artifactRoot).toEndWith(`shard-${allocated.shardIndex}/worker-1`)
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
