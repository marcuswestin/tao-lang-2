import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { planShipPipeline, planUnsignedArchive, runShipPipeline } from '../cli-src/ship-pipeline'

Describe('tao ship Apple command pipeline', () => {
  Test('derives the exact local Apple command vectors', () => {
    const runtimeRoot = '/repo/packages/apps/expo-host'
    const plan = planShipPipeline({
      archivePath: '/tmp/WordFlower.xcarchive',
      exportPath: '/tmp/export',
      issuerId: 'issuer-id',
      keyId: 'KEY123',
      keyPath: '/keys/AuthKey_KEY123.p8',
      runtimeRoot,
      teamId: 'TEAM123456',
      xcodeProjectName: 'WordFlower',
    })
    Expect(plan.prebuild).toEqual({
      args: ['prebuild', '--platform', 'ios', '--no-install'],
      command: `${runtimeRoot}/node_modules/.bin/expo`,
      cwd: runtimeRoot,
    })
    Expect(plan.installPods).toEqual({
      args: ['install', '--ansi'],
      command: 'pod',
      cwd: `${runtimeRoot}/ios`,
      env: { CP_HOME_DIR: `${runtimeRoot}/.artifacts/cocoapods`, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    })
    Expect(plan.archive.args).toEqual([
      '-workspace',
      `${runtimeRoot}/ios/WordFlower.xcworkspace`,
      '-scheme',
      'WordFlower',
      '-configuration',
      'Release',
      '-archivePath',
      '/tmp/WordFlower.xcarchive',
      '-derivedDataPath',
      `${runtimeRoot}/.artifacts/ship/DerivedData`,
      '-allowProvisioningUpdates',
      'DEVELOPMENT_TEAM=TEAM123456',
      '-authenticationKeyPath',
      '/keys/AuthKey_KEY123.p8',
      '-authenticationKeyID',
      'KEY123',
      '-authenticationKeyIssuerID',
      'issuer-id',
      'archive',
    ])
    Expect(plan.exportArchive.args).toContain('-exportArchive')
    Expect(plan.exportOptionsPlist).toContain('<string>TEAM123456</string>')
    Expect(plan.exportOptionsPlist).toContain('<string>app-store-connect</string>')
    Expect(plan.exportOptionsPlist).toContain('<string>upload</string>')
  })

  Test('runs prebuild, pods, archive, and upload in order through the injected runner', async () => {
    const runtimeRoot = await mkTestDir('tao-ship-pipeline-')
    try {
      const plan = planShipPipeline({
        archivePath: '/tmp/App.xcarchive',
        exportPath: '/tmp/export',
        issuerId: 'issuer',
        keyId: 'key',
        keyPath: '/key.p8',
        runtimeRoot,
        teamId: 'TEAM123456',
        xcodeProjectName: 'App',
      })
      const seen: string[] = []
      const phases: string[] = []
      await runShipPipeline(plan, async (command, spec) => {
        seen.push(`${command} ${spec.args[0]}`)
        return {}
      }, { onPhase: phase => phases.push(phase) })
      Expect(seen).toEqual([
        `${runtimeRoot}/node_modules/.bin/expo prebuild`,
        'pod install',
        'xcodebuild -workspace',
        'xcodebuild -exportArchive',
      ])
      Expect(phases).toEqual(['ios-project', 'ios-dependencies', 'ios-archive', 'upload'])
      Expect(await FS.exists(`${runtimeRoot}/.artifacts/cocoapods`)).toBe(true)
      Expect(await FS.readText(plan.exportOptionsPath)).toBe(plan.exportOptionsPlist)
    } finally {
      await FS.remove(runtimeRoot)
    }
  })

  Test('uses the installed binary for Expo and supplies Node to native subprocesses', async () => {
    const runtimeRoot = await mkTestDir('tao-installed-ship-pipeline-')
    try {
      const binary = '/installed/versions/0.4.0/tao'
      const metro = { TAO_RUNTIME_SOURCE_ROOT: '/installed/versions/0.4.0/resources/runtime' }
      const plan = planShipPipeline({
        archivePath: '/tmp/App.xcarchive',
        exportPath: '/tmp/export',
        issuerId: 'issuer',
        keyId: 'key',
        keyPath: '/key.p8',
        runtimeRoot,
        teamId: 'TEAM123456',
        xcodeProjectName: 'App',
      }, {
        expoCommand: (_root, args) => ({
          command: binary,
          args: ['--bun', `${runtimeRoot}/node_modules/.bin/expo`, ...args],
          env: {
            ...metro,
            BUN_BE_BUN: '1',
          },
        }),
        expoEnvironment: () => metro,
        hostInstallRoot: '/installed/versions/0.4.0/host',
      })
      const node = `${runtimeRoot}/.artifacts/ship/bin/node`
      Expect(plan.prebuild).toEqual({
        command: binary,
        args: ['--bun', `${runtimeRoot}/node_modules/.bin/expo`, 'prebuild', '--platform', 'ios', '--no-install'],
        cwd: runtimeRoot,
        env: { ...metro, BUN_BE_BUN: '1' },
      })
      for (const invocation of [plan.installPods, plan.archive, plan.exportArchive]) {
        Expect(invocation.env?.['TAO_RUNTIME_SOURCE_ROOT']).toBe(metro.TAO_RUNTIME_SOURCE_ROOT)
        Expect(invocation.env?.['PATH']?.startsWith(`${runtimeRoot}/.artifacts/ship/bin:`)).toBe(true)
      }
      const seen: string[] = []
      await runShipPipeline(plan, async (command) => {
        if (command === 'pod') {
          Expect(await FS.readText(node)).toBe(`#!/bin/sh\nBUN_BE_BUN=1 exec '${binary}' "$@"\n`)
          Expect(await FS.readText(`${runtimeRoot}/ios/.xcode.env.local`)).toBe(`export NODE_BINARY='${node}'\n`)
        }
        seen.push(command)
        return {}
      })
      Expect(seen).toEqual([binary, 'pod', 'xcodebuild', 'xcodebuild'])
    } finally {
      await FS.remove(runtimeRoot)
    }
  })

  Test('derives an unsigned archive proof with signing disabled', () => {
    Expect(
      planUnsignedArchive({
        archivePath: '/tmp/App.xcarchive',
        runtimeRoot: '/runtime',
        xcodeProjectName: 'App',
      }).args,
    ).toContain('CODE_SIGNING_ALLOWED=NO')
  })
})
