import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { inspectShipPreflight, requirePassingPreflight } from '../cli-src/ship-preflight'

type CommandResult = Awaited<ReturnType<typeof import('@shared').CLI.run>>

function runner(overrides: { firstLaunch?: number; sdks?: string; version?: string } = {}) {
  return async (command: string, spec?: { args?: readonly string[] }): Promise<CommandResult> => {
    const operation = spec?.args?.[0]
    const stdout = operation === '-version'
      ? (overrides.version ?? 'Xcode 26.6\nBuild version 17F113')
      : operation === '-showsdks'
      ? (overrides.sdks ?? 'iOS SDKs:\n\tiOS 26.5 -sdk iphoneos26.5')
      : ''
    return {
      args: [...(spec?.args ?? [])],
      command,
      exitCode: operation === '-checkFirstLaunchStatus' ? (overrides.firstLaunch ?? 0) : 0,
      signal: null,
      stderr: '',
      stdout,
    }
  }
}

const cleanGit = { commit: 'abc123', dirty: false, root: '/project' } as const

Describe('tao ship preflight', () => {
  Test('reports dirty Git, missing credentials, the app record, and a local datasource', async () => {
    const issues = await inspectShipPreflight({
      bundleIdentifier: 'app.tao.notes',
      git: { ...cleanGit, dirty: true },
      ignoreGit: false,
      localDatasourceEndpoint: true,
      usesDevDatasource: true,
    }, runner())

    Expect(issues.map(issue => issue.message).join('\n')).toContain('Git working tree is dirty')
    Expect(issues.map(issue => issue.message).join('\n')).toContain('Admin App Store Connect API team key')
    Expect(issues.map(issue => issue.message).join('\n')).toContain('Create the iOS app record')
    Expect(issues.map(issue => issue.message).join('\n')).toContain('localhost datasource')
    Expect(issues.map(issue => issue.message).join('\n')).toContain('uses the Dev datasource')
  })

  Test('reports old Xcode, unfinished first launch, a missing SDK, and a missing key file', async () => {
    const root = await mkTestDir('tao-ship-preflight-')
    const keyPath = FS.resolvePath('AuthKey_KEY.p8', root)
    const old = await inspectShipPreflight(
      {
        appStoreAppId: 'app-id',
        bundleIdentifier: 'app.tao.notes',
        git: cleanGit,
        ignoreGit: false,
        issuerId: 'issuer',
        keyId: 'KEY',
      },
      runner({ version: 'Xcode 14.3' }),
      () => keyPath,
    )
    Expect(old.map(issue => issue.message).join('\n')).toContain('Place the downloaded API key')
    Expect(old.map(issue => issue.message).join('\n')).toContain('Install Xcode 15 or later')

    await FS.writeText(keyPath, 'key')
    const setup = await inspectShipPreflight(
      {
        appStoreAppId: 'app-id',
        bundleIdentifier: 'app.tao.notes',
        git: cleanGit,
        ignoreGit: false,
        issuerId: 'issuer',
        keyId: 'KEY',
      },
      runner({ firstLaunch: 1, sdks: 'macOS SDKs only' }),
      () => keyPath,
    )
    Expect(setup.map(issue => issue.message).join('\n')).toContain('Finish Xcode setup')
    Expect(setup.map(issue => issue.message).join('\n')).toContain('downloadPlatform iOS')
  })

  Test('passes with accepted hosted configuration and treats only the human app-record step as deferred', async () => {
    const root = await mkTestDir('tao-ship-preflight-')
    const keyPath = FS.resolvePath('AuthKey_KEY.p8', root)
    await FS.writeText(keyPath, 'key')
    const issues = await inspectShipPreflight(
      {
        bundleIdentifier: 'app.tao.notes',
        git: cleanGit,
        ignoreGit: false,
        issuerId: 'issuer',
        keyId: 'KEY',
        localDatasourceEndpoint: true,
        releaseDatasourceConfiguration: { ApiURI: 'https://api.instantdb.com' },
      },
      runner(),
      () => keyPath,
    )

    Expect(issues).toHaveLength(1)
    Expect(() => requirePassingPreflight(issues)).not.toThrow()
  })
})
