import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  NativeModuleCheck,
  type NativeModuleCheckDependencies,
  type NativeModuleCommand,
  type NativeModuleCommandResult,
} from '../dev-cli-src/native-module-check/NativeModuleCheck'

const PASSED: NativeModuleCommandResult = {
  exitCode: 0,
  stderr: '',
  stdout: '',
  timedOut: false,
}

Describe('native module compiler check', () => {
  Test('runs every phase in order, builds each declared target, and removes successful artifacts', async () => {
    const events: string[] = []
    const commands: NativeModuleCommand[] = []
    const output: string[] = []
    const dependencies = fakeDependencies({
      commands,
      events,
      output,
      podspecs: ['/repo/packages/b/ios/B.podspec', '/repo/packages/a/ios/A.podspec'],
      result(command) {
        if (command.phase.startsWith('inspect podspec')) {
          return { ...PASSED, stdout: JSON.stringify({ name: command.args.at(-1)?.includes('/a/') ? 'A' : 'B' }) }
        }
        if (command.phase === 'list Pods project targets') {
          return { ...PASSED, stdout: JSON.stringify({ project: { targets: ['Support', 'B', 'A'] } }) }
        }
        return PASSED
      },
    })

    const exitCode = await NativeModuleCheck.run({ repositoryRoot: '/repo' }, dependencies)

    Expect(exitCode).toBe(0)
    Expect(events).toEqual([
      'create:/repo/.artifacts/native-module-check',
      'prepare:/repo/packages/apps/expo-host:/repo/.artifacts/native-module-check/run-1/host',
      'command:Expo prebuild',
      'command:CocoaPods install',
      'discover:/repo',
      'command:inspect podspec packages/b/ios/B.podspec',
      'command:inspect podspec packages/a/ios/A.podspec',
      'command:list Pods project targets',
      'command:compile pod target A',
      'command:compile pod target B',
      'remove:/repo/.artifacts/native-module-check/run-1',
    ])
    Expect(commands.find(command => command.phase === 'Expo prebuild')).toMatchObject({
      args: ['prebuild', '--platform', 'ios', '--no-install', '--clean'],
      timeoutMs: 120_000,
    })
    Expect(commands.find(command => command.phase === 'CocoaPods install')).toMatchObject({
      args: ['install'],
      cwd: '/repo/.artifacts/native-module-check/run-1/host/ios',
      env: { COCOAPODS_DISABLE_STATS: 'true', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      timeoutMs: 300_000,
    })
    for (const command of commands.filter(candidate => candidate.phase.startsWith('inspect podspec'))) {
      Expect(command.env).toEqual({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' })
    }
    for (const command of commands.filter(candidate => candidate.phase.startsWith('compile pod target'))) {
      Expect(command.timeoutMs).toBe(600_000)
      Expect(command.args).toContain('-sdk')
      Expect(command.args).toContain('iphonesimulator')
      Expect(command.args).toContain('CODE_SIGNING_ALLOWED=NO')
      Expect(command.args).toContain('CODE_SIGNING_REQUIRED=NO')
      Expect(command.args).toContain('SYMROOT=/repo/.artifacts/native-module-check/run-1/build/products')
      Expect(command.args).toContain('OBJROOT=/repo/.artifacts/native-module-check/run-1/build/intermediates')
    }
    Expect(output).toEqual(['Native module check passed for 2 pod targets: A, B'])
  })

  Test('discovers podspecs from standalone and grouped package roots in stable order', async () => {
    const root = await mkTestDir('tao-native-module-discovery-')
    try {
      await Promise.all([
        FS.writeText(FS.resolvePath('packages/a/package.json', root), '{}'),
        FS.writeText(FS.resolvePath('packages/a/ios/A.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/a/ios/not-a-podspec.txt', root), ''),
        FS.writeText(FS.resolvePath('packages/a/ios/nested/Hidden.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/services/demo/package.json', root), '{}'),
        FS.writeText(FS.resolvePath('packages/services/demo/ios/Demo.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/apps/providers/icloud/package.json', root), '{}'),
        FS.writeText(FS.resolvePath('packages/apps/providers/icloud/ios/TaoICloudNative.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/apps/providers/ios/Group.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/unpackaged/ios/Unpackaged.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/root/Root.podspec', root), ''),
        FS.writeText(FS.resolvePath('packages/z/package.json', root), '{}'),
        FS.writeText(FS.resolvePath('packages/z/ios/Z.podspec', root), ''),
      ])

      Expect(await NativeModuleCheck.testing.discoverPodspecs(root)).toEqual([
        FS.resolvePath('packages/a/ios/A.podspec', root),
        FS.resolvePath('packages/apps/providers/icloud/ios/TaoICloudNative.podspec', root),
        FS.resolvePath('packages/services/demo/ios/Demo.podspec', root),
        FS.resolvePath('packages/z/ios/Z.podspec', root),
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('copies the runtime host closure and symlinks its installed dependencies', async () => {
    const root = await mkTestDir('tao-native-module-host-')
    const source = FS.resolvePath('source', root)
    const host = FS.resolvePath('host', root)
    try {
      for (
        const file of [
          'app.json',
          'app.config.js',
          'app-config.cjs',
          'index.ts',
          'expo-host-src/ManagedLoopIdentityMarker.ts',
          'metro.config.cjs',
          'package.json',
        ]
      ) {
        await FS.writeText(FS.resolvePath(file, source), file)
      }
      await Promise.all([
        FS.writeText(FS.resolvePath('assets/icon.png', source), 'icon'),
        FS.writeText(FS.resolvePath('plugins/plugin.cjs', source), 'plugin'),
        FS.writeText(FS.resolvePath('node_modules/expo/package.json', source), '{}'),
      ])

      await NativeModuleCheck.testing.prepareHost(source, host)

      Expect(await FS.readText(FS.resolvePath('app.json', host))).toBe('app.json')
      Expect(await FS.readText(FS.resolvePath('expo-host-src/ManagedLoopIdentityMarker.ts', host)))
        .toBe('expo-host-src/ManagedLoopIdentityMarker.ts')
      Expect(await FS.readText(FS.resolvePath('assets/icon.png', host))).toBe('icon')
      Expect(await FS.readText(FS.resolvePath('plugins/plugin.cjs', host))).toBe('plugin')
      Expect(await FS.realPath(FS.resolvePath('node_modules', host)))
        .toBe(await FS.realPath(FS.resolvePath('node_modules', source)))
    } finally {
      await FS.remove(root)
    }
  })

  Test('retains artifacts and names the validation phase when a pod target is absent', async () => {
    const events: string[] = []
    const output: string[] = []
    const dependencies = fakeDependencies({
      events,
      output,
      podspecs: ['/repo/packages/native/ios/Native.podspec'],
      result(command) {
        if (command.phase.startsWith('inspect podspec')) {
          return { ...PASSED, stdout: JSON.stringify({ name: 'Native' }) }
        }
        if (command.phase === 'list Pods project targets') {
          return { ...PASSED, stdout: JSON.stringify({ project: { targets: ['Other'] } }) }
        }
        return PASSED
      },
    })

    Expect(await NativeModuleCheck.run({ repositoryRoot: '/repo' }, dependencies)).toBe(1)
    Expect(events.some(event => event.startsWith('remove:'))).toBe(false)
    Expect(output.join('\n')).toContain('failed during validate Pods project targets')
    Expect(output.join('\n')).toContain('Artifacts retained at: /repo/.artifacts/native-module-check/run-1')
    Expect(output.join('\n')).toContain('missing native module target: Native')
  })

  Test('retains artifacts and stops at the exact phase when a command times out', async () => {
    const events: string[] = []
    const output: string[] = []
    const dependencies = fakeDependencies({
      events,
      output,
      result(command) {
        return command.phase === 'Expo prebuild' ? { ...PASSED, timedOut: true } : PASSED
      },
    })

    Expect(await NativeModuleCheck.run({ repositoryRoot: '/repo' }, dependencies)).toBe(1)
    Expect(events).toEqual([
      'create:/repo/.artifacts/native-module-check',
      'prepare:/repo/packages/apps/expo-host:/repo/.artifacts/native-module-check/run-1/host',
      'command:Expo prebuild',
    ])
    Expect(output.join('\n')).toContain('failed during Expo prebuild')
    Expect(output.join('\n')).toContain('Expo prebuild timed out after 120000ms')
    Expect(output.join('\n')).toContain('Artifacts retained at: /repo/.artifacts/native-module-check/run-1')
  })

  Test('classifies a timed-out child as a native check timeout', async () => {
    // This is the timeoutMs under test — the child sleeps 1s and the test proves the real-command
    // timeout path fires, not that the run is fast.
    const result = await NativeModuleCheck.testing.runCommand({
      args: ['-c', 'exec sleep 1'],
      command: 'zsh',
      cwd: '/',
      phase: 'test timeout',
      quiet: true,
      timeoutMs: 10, // budget-ok: the timeout value under test.
      timeoutPolicy: 'bounded',
    })

    Expect(result.timedOut).toBe(true)
  })

  Test('retains a failed target build with its target-specific phase', async () => {
    const events: string[] = []
    const output: string[] = []
    const dependencies = fakeDependencies({
      events,
      output,
      podspecs: ['/repo/packages/native/ios/Native.podspec'],
      result(command) {
        if (command.phase.startsWith('inspect podspec')) {
          return { ...PASSED, stdout: JSON.stringify({ name: 'Native' }) }
        }
        if (command.phase === 'list Pods project targets') {
          return { ...PASSED, stdout: JSON.stringify({ project: { targets: ['Native'] } }) }
        }
        if (command.phase === 'compile pod target Native') {
          return { ...PASSED, exitCode: 65, stderr: 'SwiftCompile failed' }
        }
        return PASSED
      },
    })

    Expect(await NativeModuleCheck.run({ repositoryRoot: '/repo' }, dependencies)).toBe(1)
    Expect(events.some(event => event.startsWith('remove:'))).toBe(false)
    Expect(output.join('\n')).toContain('failed during compile pod target Native')
    Expect(output.join('\n')).toContain('SwiftCompile failed')
  })

  Test('deduplicates and sorts declared pod targets', () => {
    Expect(NativeModuleCheck.testing.requiredPodTargets(['B', 'A', 'B'], ['A', 'B', 'Support']))
      .toEqual(['A', 'B'])
  })
})

type FakeOptions = {
  commands?: NativeModuleCommand[]
  events: string[]
  output: string[]
  podspecs?: readonly string[]
  result: (command: NativeModuleCommand) => NativeModuleCommandResult
}

function fakeDependencies(options: FakeOptions): NativeModuleCheckDependencies {
  return {
    async createRunRoot(artifactRoot) {
      options.events.push(`create:${artifactRoot}`)
      return FS.resolvePath('run-1', artifactRoot)
    },
    async discoverPodspecs(repositoryRoot) {
      options.events.push(`discover:${repositoryRoot}`)
      return options.podspecs ?? []
    },
    async prepareHost(runtimeToolchainRoot, hostRoot) {
      options.events.push(`prepare:${runtimeToolchainRoot}:${hostRoot}`)
    },
    async remove(path) {
      options.events.push(`remove:${path}`)
    },
    async runCommand(command) {
      options.commands?.push(command)
      options.events.push(`command:${command.phase}`)
      return options.result(command)
    },
    writeErrorLine(message) {
      options.output.push(message)
    },
    writeLine(message) {
      options.output.push(message)
    },
  }
}
