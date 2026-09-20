import { expect, test } from '@playwright/test'
import { Errors } from '@shared'
import {
  physicalIosInstallInputFailure,
  runPhysicalIosInstall,
  withPhysicalIosInstallLease,
} from './PhysicalIosInstall'

type LeaseInput = Readonly<{ command: string; name: string; repositoryRoot: string }>
type CommandInput = Readonly<{ args: readonly string[]; command: string; cwd: string | undefined; timeoutMs: number }>

test('rejects incomplete physical-install requests before device discovery or app build', () => {
  expect(physicalIosInstallInputFailure('', 12345)).toEqual({
    code: 'device-id-required',
    message: 'Pass an explicit physical iOS device identifier.',
  })
  expect(physicalIosInstallInputFailure('physical-id', -1)).toEqual({
    code: 'invalid-seed',
    message: 'seed must be an unsigned 32-bit integer.',
  })
  expect(physicalIosInstallInputFailure('physical-id', 0x1_0000_0000)).toEqual({
    code: 'invalid-seed',
    message: 'seed must be an unsigned 32-bit integer.',
  })
  expect(physicalIosInstallInputFailure('physical-id', 12345)).toBeUndefined()
})

test('holds the physical iOS target lease through the install attempt and releases it after failure', async () => {
  const calls: string[] = []
  const failure = new Errors.HostEnvironmentError('install failed')

  await expect(withPhysicalIosInstallLease({
    acquire: async input => {
      calls.push(`${input.command}:${input.name}:${input.repositoryRoot.endsWith('tao-lang-2')}`)
      return {
        release: async () => {
          calls.push('release')
        },
      }
    },
    action: async () => {
      calls.push('install')
      throw failure
    },
    device: 'physical-id',
    runId: 'run-id',
  })).rejects.toBe(failure)

  expect(calls).toEqual(['physical iOS install run-id:ios-device:physical-id:true', 'install', 'release'])
})

test('records an installed receipt only after physical discovery and an isolated Release install', async () => {
  const harness = physicalInstallHarness()
  const buildInputs: object[] = []
  const receipt = await runPhysicalIosInstall({
    ...harness.options,
    build: async input => {
      buildInputs.push(input)
      return harness.build
    },
  })

  expect(receipt.status).toBe('installed')
  expect(buildInputs).toEqual([{ artifactRoot: 'artifacts', runId: 'run-id', seed: 12345, subject: 'hnreader' }])
  expect(harness.commands).toEqual([
    ['xcrun', [
      'devicectl',
      'list',
      'devices',
      '--json-output',
      'artifacts/physical-ios-install/physical-device-discovery.json',
    ], undefined],
    ['artifacts/project/node_modules/.bin/expo', [
      'run:ios',
      '--device',
      'physical-id',
      '--configuration',
      'Release',
      '--no-bundler',
    ], 'artifacts/project'],
  ])
  expect(harness.receipts.at(-1)).toMatchObject({ preparation: harness.build, status: 'installed' })
  expect(harness.leases).toEqual(['ios-device:physical-id', 'release'])
})

test('blocks unavailable discovery before building or installing', async () => {
  const harness = physicalInstallHarness({ discoveryExitCode: 1 })
  let builds = 0
  const receipt = await runPhysicalIosInstall({
    ...harness.options,
    build: async () => {
      builds += 1
      return harness.build
    },
  })

  expect(receipt).toMatchObject({ failure: { code: 'ios-device-unavailable' }, status: 'blocked' })
  expect(builds).toBe(0)
  expect(harness.commands).toHaveLength(1)
  expect(harness.receipts.at(-1)).toMatchObject({ commands: receipt.commands, status: 'blocked' })
  expect(harness.leases).toEqual(['ios-device:physical-id', 'release'])
})

test('preserves discovery evidence when the build or Release install fails', async () => {
  const buildFailure = physicalInstallHarness()
  const failedBuild = await runPhysicalIosInstall({
    ...buildFailure.options,
    build: async () => {
      return Errors.throwHostEnvironment('build unavailable')
    },
  })
  expect(failedBuild).toMatchObject({
    commands: [{ command: 'xcrun', exitCode: 0 }],
    failure: { code: 'host-app-prepare-failed' },
    status: 'failed',
  })
  expect(buildFailure.commands).toHaveLength(1)

  const installFailure = physicalInstallHarness({ installExitCode: 1 })
  const failedInstall = await runPhysicalIosInstall({
    ...installFailure.options,
    build: async () => installFailure.build,
  })
  expect(failedInstall).toMatchObject({
    commands: [{ command: 'xcrun', exitCode: 0 }, { command: 'artifacts/project/node_modules/.bin/expo', exitCode: 1 }],
    failure: { code: 'native-build-or-install-failed' },
    preparation: installFailure.build,
    status: 'failed',
  })
  expect(installFailure.receipts.at(-1)).toMatchObject({ commands: failedInstall.commands, status: 'failed' })
})

function physicalInstallHarness(options: Readonly<{ discoveryExitCode?: number; installExitCode?: number }> = {}) {
  const receipts: unknown[] = []
  const commands: Array<readonly [string, readonly string[], string | undefined]> = []
  const leases: string[] = []
  const json = new Map<string, unknown>()
  const build = {
    appId: 'dev.tao.taohosthnreaderrunid',
    compiledArtifactDigest: '0'.repeat(64),
    entrySourceDigest: '1'.repeat(64),
    root: 'artifacts/project',
  }
  json.set('artifacts/physical-ios-install/physical-device-discovery.json', {
    result: {
      devices: [{ identifier: 'physical-id', hardwareProperties: { deviceType: 'iPhone', reality: 'physical' } }],
    },
  })
  json.set('artifacts/project/app.json', {
    expo: { android: { package: build.appId }, ios: { bundleIdentifier: build.appId } },
  })
  const filesystem = {
    exists: async () => false,
    isDirectory: async (path: string) => path === 'artifacts/project',
    isFile: async (path: string) => path === 'artifacts/project/node_modules/.bin/expo',
    mkdir: async () => {},
    pathIsWithin: (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`),
    readJson: async <T>(path: string): Promise<T> => json.get(path) as T,
    realPath: async (path: string) => path,
    resolvePath: (path: string, root?: string) => root === undefined ? path : `${root}/${path}`,
    writeJson: async (_path: string, value: unknown) => {
      receipts.push(value)
    },
  }
  return {
    build,
    commands,
    leases,
    options: {
      artifactRoot: 'artifacts',
      dependencies: {
        acquireLease: async (input: LeaseInput) => {
          leases.push(input.name)
          return {
            release: async () => {
              leases.push('release')
            },
          }
        },
        command: async (input: CommandInput) => {
          commands.push([input.command, input.args, input.cwd])
          const exitCode = input.command === 'xcrun' ? options.discoveryExitCode ?? 0 : options.installExitCode ?? 0
          return { args: input.args, command: input.command, exitCode, signal: null, stderr: '', stdout: '' }
        },
        filesystem,
      },
      device: 'physical-id',
      runId: 'run-id',
      seed: 12345,
      subject: 'hnreader' as const,
    },
    receipts,
  }
}
