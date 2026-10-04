import { Errors, FS, HCI, ReleaseCapabilities } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { planShipActions } from './ship-actions'
import { inspectShipGit, type ShipGitState, shipSourceMatchesBuild } from './ship-git'
import {
  acceptedShipEntry,
  promoteShipEntry,
  putShipLockEntry,
  readProjectLock,
  SHIP_LOCK_RELATIVE_PATH,
  type ShipLockEntry,
  type TaoProjectLock,
} from './ship-lock'
import {
  decideShipVersion,
  deriveShipIdentity,
  nextBuildNumber,
  type ShipBump,
  shipInputHash,
  type ShipVersion,
  timestampBuildNumber,
} from './ship-model'
import {
  appStoreConnectKeyPath,
  inspectShipPreflight,
  requirePassingPreflight,
  type ShipPreflightIssue,
} from './ship-preflight'
import { discoverShipProject, selectShipApp, type ShipProject, type ShipProjectApp } from './ship-project'
import { withShipTransaction } from './ship-transaction'

export type ShipCommandOptions = {
  appName?: string
  betaRecipients?: readonly string[]
  bump?: ShipBump
  dryRun?: boolean
  ignoreGit?: boolean
  input?: Readable
  interactive?: boolean
  noWait?: boolean
  notes?: string
  output?: Writable
  rollback?: boolean
  update?: boolean
  yes?: boolean
}

const DEFAULT_SHIP_NAMESPACE = 'com.devtao'

export type PreparedShip = {
  actions: string[]
  app: ShipProjectApp
  buildNumber: string
  bundleIdentifier: string
  channel: string
  entry: ShipLockEntry
  git: ShipGitState
  inputHash: string
  issues: ShipPreflightIssue[]
  lock: TaoProjectLock
  project: ShipProject
  reuseBuild: boolean
  version: ShipVersion
  versionBumped: boolean
}

export type ShipCommandDependencies = {
  execute?: (prepared: PreparedShip, options: ShipCommandOptions) => Promise<void>
  inspectPreflight?: typeof inspectShipPreflight
  now?: () => Date
}

/** runShipCommand prepares and gates one ship run; --dry-run exercises the entire mutation-free path. */
export async function runShipCommand(
  targetPath = '.',
  options: ShipCommandOptions = {},
  dependencies: ShipCommandDependencies = {},
): Promise<'cancelled' | 'dry-run' | 'shipped'> {
  ReleaseCapabilities.require('ship')
  if (options.update || options.rollback) {
    ReleaseCapabilities.require('ota')
  }
  if (options.betaRecipients === undefined && !options.update) {
    ReleaseCapabilities.require('external-distribution')
  }
  validateOptions(options)
  const project = await discoverShipProject(targetPath)
  return await withShipTransaction(project.root, async () => {
    const prepared = await prepareShip(project, options, dependencies)
    writePlan(prepared, options)
    if (options.dryRun) {
      return 'dry-run'
    }
    requirePassingPreflight(prepared.issues)
    if (!options.yes) {
      const proceed = await HCI.askConfirm({
        defaultValue: true,
        input: options.input,
        interactive: options.interactive,
        message: 'Proceed with these actions?',
        output: options.output,
      })
      if (!proceed) {
        return 'cancelled'
      }
    }
    const execute = dependencies.execute ?? (async (value: PreparedShip, commandOptions: ShipCommandOptions) => {
      const { executePreparedShip } = await import('./ship-executor')
      await executePreparedShip(value, commandOptions)
    })
    await execute(prepared, options)
    return 'shipped'
  })
}

async function prepareShip(
  project: ShipProject,
  options: ShipCommandOptions,
  dependencies: ShipCommandDependencies = {},
): Promise<PreparedShip> {
  const app = await resolveApp(project, options)
  const hashInput = {
    appName: app.name,
    appId: app.id,
    appVersion: app.version,
    releaseDatasourceConfiguration: app.releaseDatasourceConfiguration,
  }
  const inputHash = shipInputHash(hashInput)
  const lock = await readProjectLock(project.root)
  const entry = await resolveEntry(app, lock, inputHash, options)
  const accepted = entry.accepted
  const identity = deriveShipIdentity({
    appId: app.id,
    namespace: accepted?.namespace ?? DEFAULT_SHIP_NAMESPACE,
  })
  const lockPath = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, project.root)
  const git = await inspectShipGit(project.root, { excludePaths: [lockPath] })
  const consumed = entry.lastBuild?.version === app.version && entry.lastBuild.submittedForReview === true
  const versionDecision = decideShipVersion(app.version, { consumed, forcedBump: options.bump })
  const buildSourceMatches = entry.lastBuild === undefined
    ? false
    : shipSourceMatchesBuild(git, {
      commit: entry.lastBuild.commit,
      dirty: entry.lastBuild.dirty ?? false,
      dirtyFingerprint: entry.lastBuild.dirtyFingerprint,
    })
  const terminalBuild = entry.lastBuild?.processingState === 'FAILED'
    || entry.lastBuild?.processingState === 'INVALID'
  const incompleteUpload = entry.lastBuild?.processed === false && !terminalBuild
  const dirtyTestFlightPromotion = options.betaRecipients === undefined
    && entry.lastBuild?.distribution === 'testflight'
    && entry.lastBuild.dirty === true
  const reuseBuild = !options.update
    && git.root !== undefined
    && !versionDecision.bumped
    && !dirtyTestFlightPromotion
    && entry.lastBuild?.version === versionDecision.version
    && (incompleteUpload || (options.betaRecipients === undefined
      && entry.lastBuild.processed === true
      && buildSourceMatches))
  const buildNumber = reuseBuild
    ? entry.lastBuild!.number
    : nextBuildNumber(
      timestampBuildNumber(dependencies.now?.() ?? new Date()),
      entry.lastBuild === undefined ? [] : [entry.lastBuild.number],
    )
  const actions = planShipActions({
    appName: app.name,
    betaRecipients: options.betaRecipients,
    buildNumber,
    bump: versionDecision.bumped ? { from: app.version, to: versionDecision.version } : undefined,
    noWait: options.noWait === true,
    notes: options.notes,
    reuseBuild,
    update: options.update === true,
    version: versionDecision.version,
  })
  const issues = await (dependencies.inspectPreflight ?? inspectShipPreflight)({
    appStoreAppId: entry.appStoreAppId,
    bundleIdentifier: accepted?.bundleIdentifier ?? identity.bundleIdentifier,
    git,
    ignoreGit: options.ignoreGit === true,
    issuerId: accepted?.issuerId,
    keyId: accepted?.keyId,
    localDatasourceEndpoint: app.hasLocalDatasourceEndpoint,
    releaseDatasourceConfiguration: accepted?.datasourceConfiguration,
    usesDevDatasource: app.usesDevDatasource,
  })
  return {
    actions,
    app,
    buildNumber,
    bundleIdentifier: accepted?.bundleIdentifier ?? identity.bundleIdentifier,
    channel: identity.channel,
    entry,
    git,
    inputHash,
    issues,
    lock,
    project,
    reuseBuild,
    version: versionDecision.version,
    versionBumped: versionDecision.bumped,
  }
}

async function resolveApp(project: ShipProject, options: ShipCommandOptions): Promise<ShipProjectApp> {
  const selected = selectShipApp(project, options.appName)
  if (selected) {
    return selected
  }
  if (!HCI.isInteractive(options)) {
    Errors.throwUserInput(
      `Project '${project.name}' does not name an app. Select one with --app. Available apps: ${
        project.apps.map(app => app.name).join(', ')
      }.`,
    )
  }
  const appName = await HCI.askChoice({
    choices: project.apps.map(app => ({ value: app.name })),
    input: options.input,
    interactive: options.interactive,
    message: 'Choose the Tao app to ship',
    output: options.output,
  })
  return selectShipApp(project, appName)!
}

async function resolveEntry(
  app: ShipProjectApp,
  lock: TaoProjectLock,
  inputHash: string,
  options: ShipCommandOptions,
): Promise<ShipLockEntry> {
  const identity = `${app.id}/${app.name}`
  const accepted = acceptedShipEntry(lock, identity, inputHash)
  if (accepted) {
    return accepted
  }
  const previous = lock.ship?.apps[identity]
  if (options.dryRun || !HCI.isInteractive(options)) {
    return previous ?? {
      identity,
      inputHash,
      provenance: { at: new Date(0).toISOString(), command: 'tao ship', version: 1 },
      status: 'suggested',
    }
  }
  const keyId = await HCI.askText({
    input: options.input,
    interactive: options.interactive,
    message: 'App Store Connect Key ID',
    output: options.output,
    validate: value => value.trim().length > 0 ? undefined : 'Enter the Key ID shown beside the Admin team key.',
  })
  const issuerId = await HCI.askText({
    input: options.input,
    interactive: options.interactive,
    message: 'App Store Connect Issuer ID',
    output: options.output,
    validate: value => value.trim().length > 0 ? undefined : 'Enter the Issuer ID shown above the team keys table.',
  })
  const namespace = await HCI.askText({
    defaultValue: DEFAULT_SHIP_NAMESPACE,
    input: options.input,
    interactive: options.interactive,
    message: 'Owned reverse-DNS bundle namespace',
    output: options.output,
  })
  const derived = deriveShipIdentity({ appId: app.id, namespace })
  const confirmed = await HCI.askConfirm({
    defaultValue: true,
    input: options.input,
    interactive: options.interactive,
    message: `Accept bundle identifier ${derived.bundleIdentifier}?`,
    output: options.output,
  })
  if (!confirmed) {
    Errors.throwUserInput('Shipping stopped before accepting the bundle identifier.')
  }
  return promoteShipEntry({
    ...previous,
    identity,
    inputHash,
    provenance: { at: new Date().toISOString(), command: 'tao ship', version: 1 },
    status: 'suggested',
    suggested: {
      bundleIdentifier: derived.bundleIdentifier,
      datasourceConfiguration: app.releaseDatasourceConfiguration,
      issuerId,
      keyId,
      namespace,
    },
  })
}

function writePlan(prepared: PreparedShip, options: ShipCommandOptions): void {
  HCI.writeLine(`Ship ${prepared.app.name} ${prepared.version} (${prepared.buildNumber})`, options)
  HCI.writeLine(`Bundle: ${prepared.bundleIdentifier}`, options)
  if (prepared.issues.length > 0) {
    HCI.writeLine('Precursors:', options)
    for (const issue of prepared.issues) {
      HCI.writeLine(`  - ${issue.message}${issue.url ? ` ${issue.url}` : ''}`, options)
    }
  }
  HCI.writeLine('Actions:', options)
  for (const [index, action] of prepared.actions.entries()) {
    HCI.writeLine(`  ${index + 1}. ${action}`, options)
  }
}

function validateOptions(options: ShipCommandOptions): void {
  if (options.update && options.betaRecipients !== undefined) {
    Errors.throwUserInput('--update cannot be combined with --beta.')
  }
  if (options.rollback && !options.update) {
    Errors.throwUserInput('--rollback requires --update.')
  }
  if (options.noWait && options.update) {
    Errors.throwUserInput('--no-wait applies to Apple build processing, not --update.')
  }
}

/** acceptedEntryWithRunState returns the ship-only lock update the executor persists at its checkpoints. */
export function acceptedEntryWithRunState(prepared: PreparedShip, entry: ShipLockEntry): TaoProjectLock {
  return putShipLockEntry(
    { schemaVersion: 1 },
    { ...entry, inputHash: prepared.inputHash, status: 'accepted' },
  )
}

export function preparedKeyPath(prepared: PreparedShip): string {
  const keyId = prepared.entry.accepted?.keyId
  if (!keyId) {
    Errors.throwUnexpected('Accepted ship metadata has no App Store Connect Key ID.')
  }
  return appStoreConnectKeyPath(keyId)
}
