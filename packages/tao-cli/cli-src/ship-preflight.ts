import { CLI, Errors, FS } from '@shared'
import type { ShipGitState } from './ship-git'

export type ShipPreflightIssue = {
  kind: 'host' | 'user'
  message: string
  url?: string
}

export type ShipPreflightInput = {
  appStoreAppId?: string
  bundleIdentifier: string
  git: ShipGitState
  ignoreGit: boolean
  issuerId?: string
  keyId?: string
  localDatasourceEndpoint?: boolean
  releaseDatasourceConfiguration?: Readonly<Record<string, string>>
}

type CommandRunner = typeof CLI.run

/** inspectShipPreflight reports local prerequisites without contacting Apple or mutating the project. */
export async function inspectShipPreflight(
  input: ShipPreflightInput,
  runner: CommandRunner = CLI.run,
  keyPathForId: (keyId: string) => string = appStoreConnectKeyPath,
): Promise<ShipPreflightIssue[]> {
  const issues: ShipPreflightIssue[] = []
  if (input.git.dirty && !input.ignoreGit) {
    issues.push({
      kind: 'user',
      message: 'The Git working tree is dirty. Commit or discard the changes, or use --ignore-git.',
    })
  }
  if (!input.keyId || !input.issuerId) {
    issues.push({
      kind: 'user',
      message: 'Create an Admin App Store Connect API team key and record its Key ID and Issuer ID.',
      url: 'https://appstoreconnect.apple.com/access/integrations/api',
    })
  } else {
    const keyPath = keyPathForId(input.keyId)
    if (!await FS.isFile(keyPath)) {
      issues.push({
        kind: 'user',
        message: `Place the downloaded API key at ${keyPath}.`,
        url: 'https://appstoreconnect.apple.com/access/integrations/api',
      })
    }
  }

  const xcode = await runner('xcodebuild', { args: ['-version'] })
  const version = /^Xcode\s+(\d+)/mu.exec(xcode.stdout)?.[1]
  if (xcode.exitCode !== 0 || !version || Number(version) < 15) {
    issues.push({
      kind: 'host',
      message: 'Install Xcode 15 or later from the Mac App Store.',
      url: 'https://apps.apple.com/app/xcode/id497799835',
    })
  } else {
    const firstLaunch = await runner('xcodebuild', { args: ['-checkFirstLaunchStatus'] })
    if (firstLaunch.exitCode !== 0) {
      issues.push({
        kind: 'host',
        message: 'Finish Xcode setup with: sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch',
      })
    }
    const sdks = await runner('xcodebuild', { args: ['-showsdks'] })
    if (sdks.exitCode !== 0 || !/iphoneos/iu.test(`${sdks.stdout}\n${sdks.stderr}`)) {
      issues.push({ kind: 'host', message: 'Install the iOS platform with: xcodebuild -downloadPlatform iOS' })
    }
  }

  if (!input.appStoreAppId) {
    issues.push({
      kind: 'user',
      message: `Create the iOS app record for ${input.bundleIdentifier} in App Store Connect when tao ship asks.`,
      url: 'https://appstoreconnect.apple.com/apps',
    })
  }
  if (input.localDatasourceEndpoint && !input.releaseDatasourceConfiguration) {
    issues.push({
      kind: 'user',
      message:
        'The selected app uses a localhost datasource. Accept a hosted datasource configuration before shipping.',
    })
  }
  return issues
}

export function requirePassingPreflight(issues: readonly ShipPreflightIssue[]): void {
  const blocking = issues.find(issue => !issue.message.startsWith('Create the iOS app record'))
  if (!blocking) {
    return
  }
  const message = `${blocking.message}${blocking.url ? ` ${blocking.url}` : ''}`
  if (blocking.kind === 'host') {
    Errors.throwHostEnvironment(message)
  }
  Errors.throwUserInput(message)
}

export function appStoreConnectKeyPath(keyId: string): string {
  return FS.resolvePath(`.appstoreconnect/private_keys/AuthKey_${keyId}.p8`, FS.homeDir())
}

export const APPLE_MEMBERSHIP_URL = 'https://developer.apple.com/account'
export const APPLE_AGREEMENTS_URL = 'https://appstoreconnect.apple.com/business'
