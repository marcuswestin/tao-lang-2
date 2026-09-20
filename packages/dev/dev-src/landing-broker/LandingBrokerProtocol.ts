import { FS } from '@shared'

export const LANDING_BROKER_VERSION = 1
export const LANDING_BROKER_LABEL = 'com.tao-lang.landing-broker'

export type LandingBrokerRepository = {
  gitCommonDir: string
  mirrorGitDir: string
  objectDirectory: string
  remoteUrl: string
}

export type LandingBrokerConfig = {
  ghPath: string
  gitPath: string
  repositories: readonly LandingBrokerRepository[]
  socketPath: string
  version: typeof LANDING_BROKER_VERSION
}

type LandingBrokerInspectRequest = {
  branches: readonly string[]
  operation: 'inspect'
  repositoryGitDir: string
  version: typeof LANDING_BROKER_VERSION
}

type LandingBrokerPingRequest = {
  operation: 'ping'
  version: typeof LANDING_BROKER_VERSION
}

export type LandingBrokerPushRequest = {
  branch: string
  expectedRemoteFeatureHead: string | null
  expectedRemoteMainHead: string
  featureHead: string
  landedHead: string
  operation: 'push'
  repositoryGitDir: string
  version: typeof LANDING_BROKER_VERSION
}

export type LandingBrokerRequest = LandingBrokerInspectRequest | LandingBrokerPingRequest | LandingBrokerPushRequest

export type LandingBrokerResponse =
  | { ok: true; operation: 'ping' }
  | { ok: true; operation: 'inspect' | 'push'; refs: Record<string, string> }
  | { error: string; ok: false }

export function landingBrokerRoot(): string {
  return FS.resolvePath('Library/Application Support/Tao/landing-broker', FS.homeDir())
}

export function landingBrokerConfigPath(): string {
  return FS.resolvePath('config.json', landingBrokerRoot())
}

export function landingBrokerSocketPath(): string {
  return FS.resolvePath('broker.sock', landingBrokerRoot())
}

export function landingBrokerBinaryPath(): string {
  return FS.resolvePath('tao-landing-broker', landingBrokerRoot())
}

export function landingBrokerLaunchAgentPath(): string {
  return FS.resolvePath(`Library/LaunchAgents/${LANDING_BROKER_LABEL}.plist`, FS.homeDir())
}

export function archiveBranch(branch: string): string {
  const prefix = branch.startsWith('feat/') ? 'feat/' : branch.startsWith('dev/') ? 'dev/' : ''
  return `merged/${branch.slice(prefix.length)}`
}

export function isLandableBranch(branch: string): boolean {
  return /^(?:feat|dev)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) && !branch.includes('..')
}

export function isInspectableBranch(branch: string): boolean {
  return branch === 'main'
    || isLandableBranch(branch)
    || /^merged\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(branch) && !branch.includes('..')
}

export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40,64}$/u.test(value)
}
