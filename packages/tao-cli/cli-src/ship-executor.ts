import Runtime, { RuntimeToolchainPaths, type ShipManifest as RuntimeShipManifest } from '@runtime-toolchain'
import { CLI, Errors, FS, HCI, Platform } from '@shared'
import { createHash } from 'node:crypto'
import { createAppStoreConnectToken } from './app-store-connect-auth'
import { type AppStoreBuild, AppStoreConnectClient } from './app-store-connect-client'
import type { PreparedShip, ShipCommandOptions } from './ship-command'
import { acceptedEntryWithRunState, preparedKeyPath } from './ship-command'
import { dataSchemaFingerprint, runtimeFingerprint } from './ship-fingerprints'
import { commitShipState, commitShipVersion, shipNotesSince, tagShipVersion } from './ship-git'
import { SHIP_LOCK_RELATIVE_PATH, type ShipLockEntry, writeProjectLock } from './ship-lock'
import { planShipPipeline, runShipPipeline, type ShipCommandRunner } from './ship-pipeline'
import { planShipProgress, shipCommandFailure, ShipProgress } from './ship-progress'
import { writeProjectVersion } from './ship-project'
import {
  assertUpdateCompatibility,
  type ExpoUpdateAsset,
  TaoUpdateClient,
  type TaoUpdatePublication,
} from './tao-update-client'

type ShipAppleClient = AppStoreConnectClient

type BetaDistributionClient = Pick<
  AppStoreConnectClient,
  | 'addBuildToBetaGroup'
  | 'enableAutomaticBetaNotifications'
  | 'ensureBetaAppLocalization'
  | 'ensureBetaGroup'
  | 'ensureBetaTester'
  | 'setWhatToTest'
  | 'submitBuildForBetaReview'
  | 'users'
>

export type ShipExecutorDependencies = {
  appleClient?: ShipAppleClient
  commandRunner?: ShipCommandRunner
  runtimeRoot?: string
  updateClient?: TaoUpdateClient
}

/** executePreparedShip mutates only after the printed action list and gate have succeeded. */
export async function executePreparedShip(
  prepared: PreparedShip,
  options: ShipCommandOptions,
  dependencies: ShipExecutorDependencies = {},
): Promise<void> {
  const phases = planShipProgress({
    beta: options.betaRecipients !== undefined,
    buildId: prepared.entry.lastBuild?.buildId,
    noWait: options.noWait === true,
    reuseBuild: prepared.reuseBuild,
    rollback: options.rollback === true,
    update: options.update === true,
  })
  const progress = new ShipProgress(phases, options)
  const needsCommandLog = options.update === true || !prepared.reuseBuild
  const logPath = FS.resolvePath(
    `.artifacts/logs/ship/${prepared.app.name}-${prepared.buildNumber}.log`,
    prepared.git.root ?? prepared.project.root,
  )
  const logFile = needsCommandLog ? await freshShipLog(logPath, options) : undefined
  try {
    await executePreparedShipRun(prepared, options, dependencies, progress, logFile)
  } catch (error) {
    throw logFile === undefined ? error : shipCommandFailure(error, progress.currentLabel, logPath)
  } finally {
    await logFile?.close()
  }
}

async function executePreparedShipRun(
  prepared: PreparedShip,
  options: ShipCommandOptions,
  dependencies: ShipExecutorDependencies,
  progress: ShipProgress,
  logFile: FS.FileHandle | undefined,
): Promise<void> {
  const accepted = prepared.entry.accepted
  if (!accepted) {
    Errors.throwUserInput(
      'Run tao ship interactively once to accept the Key ID, Issuer ID, namespace, and bundle identifier.',
    )
  }
  const runtimeRoot = dependencies.runtimeRoot ?? RuntimeToolchainPaths.packageRoot
  const runner = dependencies.commandRunner ?? CLI.mustRun
  const lockPath = FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, prepared.project.root)
  let entry = prepared.entry
  let lock = acceptedEntryWithRunState(prepared, entry)

  if (options.update) {
    await executeUpdate(prepared, options, entry, runtimeRoot, runner, progress, logFile, dependencies.updateClient)
    return
  }

  if (prepared.versionBumped) {
    await writeProjectVersion(prepared.project, prepared.version)
  }
  await writeProjectLock(prepared.project.root, lock)
  let sourceCommit = prepared.git.commit
  if (prepared.git.root && (prepared.versionBumped || !await pathIsTrackedAndClean(lockPath, prepared.git.root))) {
    sourceCommit = prepared.versionBumped
      ? await commitShipVersion(prepared.git, [prepared.project.projectSourcePath, lockPath], prepared.version)
      : await commitShipState(prepared.git, lockPath, `Accept ship metadata for ${prepared.app.name}`)
  }

  const apple = dependencies.appleClient ?? new AppStoreConnectClient({
    authorizationToken: async () =>
      await createAppStoreConnectToken({
        issuerId: accepted.issuerId,
        keyId: accepted.keyId,
        keyPath: preparedKeyPath(prepared),
      }),
  })
  progress.step('app-store-connect')
  const { appId, teamId } = await ensureAppleProject(apple, prepared, options)

  let build: AppStoreBuild | undefined
  let nativeFingerprint = entry.update?.runtimeFingerprint
  let schemaFingerprint = entry.update?.dataSchemaFingerprint
  if (!prepared.reuseBuild) {
    progress.step('compile')
    nativeFingerprint = await runtimeFingerprint(runtimeRoot, runner as typeof CLI.run)
    schemaFingerprint = await dataSchemaFingerprint(prepared.project.root)
    const updateServer = entry.update?.serverUrl ?? 'https://updates.tao-lang.dev'
    const manifest = runtimeManifest(prepared, sourceCommit, nativeFingerprint, updateServer)
    await Runtime.generateApp(prepared.app.sourcePath, {
      appName: prepared.app.name,
      datasourceConfiguration: accepted.datasourceConfiguration,
      runtimePackageRoot: runtimeRoot,
      ship: manifest,
      validationMode: 'release',
    })
    progress.step('bundle-export')
    await exportAndProve(runtimeRoot, runner, logFile)
    const artifacts = FS.resolvePath(`.artifacts/ship/${prepared.app.name}`, runtimeRoot)
    await runShipPipeline(
      planShipPipeline({
        archivePath: FS.resolvePath(`${prepared.app.name}.xcarchive`, artifacts),
        exportPath: FS.resolvePath('export', artifacts),
        issuerId: accepted.issuerId,
        keyId: accepted.keyId,
        keyPath: preparedKeyPath(prepared),
        runtimeRoot,
        teamId,
        xcodeProjectName: manifest.slug,
      }),
      runner,
      {
        logFile,
        onPhase: phase => progress.step(phase),
      },
    )
    entry = {
      ...entry,
      appStoreAppId: appId,
      lastBuild: {
        commit: sourceCommit,
        number: prepared.buildNumber,
        processed: false,
        version: prepared.version,
      },
      update: {
        ...entry.update,
        channel: prepared.channel,
        dataSchemaFingerprint: schemaFingerprint,
        runtimeFingerprint: nativeFingerprint,
        serverUrl: updateServer,
      },
    }
    lock = acceptedEntryWithRunState(prepared, entry)
    await writeProjectLock(prepared.project.root, lock)
    if (options.noWait) {
      progress.step('checkpoint')
      await persistShipCheckpoint(prepared, lockPath)
      writeSummary(prepared, appId, sourceCommit, 'Uploaded; Apple is processing the build.')
      return
    }
    progress.step('apple-processing')
    build = await apple.waitForProcessedBuild({ appId, buildNumber: prepared.buildNumber })
  } else {
    const buildId = entry.lastBuild?.buildId
    if (!buildId) {
      progress.step('apple-processing')
      build = await apple.waitForProcessedBuild({ appId, buildNumber: prepared.buildNumber })
    } else {
      build = { attributes: { processingState: 'VALID', version: prepared.buildNumber }, id: buildId, type: 'builds' }
    }
  }
  if (!build) {
    Errors.throwHostEnvironment(`Apple did not return processed build ${prepared.buildNumber}.`)
  }

  if (options.betaRecipients !== undefined) {
    progress.step('testflight')
    entry = await distributeBeta(apple, prepared, entry, build, appId, options)
  } else {
    progress.step('app-review')
    const version = await apple.ensureAppStoreVersion(appId, prepared.version)
    await apple.attachBuildToVersion(version.id, build.id)
    await apple.submitVersionForReview(appId, version.id)
    entry = {
      ...entry,
      lastBuild: {
        ...entry.lastBuild!,
        buildId: build.id,
        processed: true,
        submittedForReview: true,
      },
    }
  }
  progress.step('checkpoint')
  await writeProjectLock(prepared.project.root, acceptedEntryWithRunState(prepared, entry))
  await persistShipCheckpoint(prepared, lockPath)
  if (options.betaRecipients === undefined) {
    await tagShipVersion(prepared.git, prepared.version)
  }
  writeSummary(
    prepared,
    appId,
    entry.lastBuild?.commit ?? sourceCommit,
    options.betaRecipients === undefined ? 'Submitted for App Store review.' : 'Distributed through TestFlight.',
  )
}

async function ensureAppleProject(
  apple: ShipAppleClient,
  prepared: PreparedShip,
  options: ShipCommandOptions,
): Promise<{ appId: string; teamId: string }> {
  const bundleIds = await apple.bundleIds(prepared.bundleIdentifier)
  if (bundleIds.length > 1) {
    Errors.throwHostEnvironment(`Apple returned more than one bundle identifier for ${prepared.bundleIdentifier}.`)
  }
  const bundleId = bundleIds[0] ?? await apple.registerBundleId({
    identifier: prepared.bundleIdentifier,
    name: prepared.app.displayName,
  })
  if (bundleId.attributes.seedId.trim() === '') {
    Errors.throwHostEnvironment('App Store Connect returned no Apple Team ID for the app bundle identifier.')
  }
  let apps = await apple.apps(prepared.bundleIdentifier)
  if (apps.length === 0) {
    const instructions = [
      'Create this App Store Connect app record:',
      '  Platform: iOS',
      `  Name: ${prepared.app.displayName}`,
      '  Primary language: English (U.S.)',
      `  Bundle ID: ${prepared.bundleIdentifier}`,
      `  SKU: ${prepared.project.id}-${prepared.app.name}`,
      '  https://appstoreconnect.apple.com/apps',
    ].join('\n')
    HCI.writeLine(instructions, options)
    if (!HCI.isInteractive(options)) {
      Errors.throwUserInput(`${instructions}\nRun tao ship again after creating it.`)
    }
    await HCI.askText({
      defaultValue: 'done',
      input: options.input,
      interactive: options.interactive,
      message: 'Press Enter after the app record exists',
      output: options.output,
    })
    apps = await apple.apps(prepared.bundleIdentifier)
  }
  if (apps.length !== 1) {
    Errors.throwUserInput(`App Store Connect still has no unique app record for ${prepared.bundleIdentifier}.`)
  }
  return { appId: apps[0]!.id, teamId: bundleId.attributes.seedId }
}

async function distributeBeta(
  apple: ShipAppleClient,
  prepared: PreparedShip,
  entry: ShipLockEntry,
  build: AppStoreBuild,
  appId: string,
  options: ShipCommandOptions,
): Promise<ShipLockEntry> {
  const notes = options.notes ?? await shipNotesSince(prepared.git, entry.lastBuild?.commit)
  const groups = await configureBetaDistribution(apple, {
    appId,
    appName: prepared.app.displayName,
    build,
    emails: options.betaRecipients ?? [],
    notes,
  })
  return {
    ...entry,
    appStoreAppId: appId,
    betaGroups: groups,
    lastBuild: {
      ...entry.lastBuild!,
      buildId: build.id,
      processed: true,
    },
  }
}

/** configureBetaDistribution orders build access before tester assignment, as App Store Connect requires. */
export async function configureBetaDistribution(
  apple: BetaDistributionClient,
  input: { appId: string; appName: string; build: AppStoreBuild; emails: readonly string[]; notes: string },
): Promise<{ external: string; internal: string }> {
  const internal = await apple.ensureBetaGroup(input.appId, 'Tao Internal', true)
  const external = await apple.ensureBetaGroup(input.appId, 'Tao External', false)
  const recipients: { email: string; groupId: string; isExternal: boolean }[] = []
  for (const email of input.emails) {
    const teamMember = (await apple.users(email)).some(
      user => user.attributes.username.toLowerCase() === email.toLowerCase(),
    )
    recipients.push({ email, groupId: teamMember ? internal.id : external.id, isExternal: !teamMember })
  }
  await apple.setWhatToTest(input.build.id, input.notes)
  await apple.addBuildToBetaGroup(internal.id, input.build.id)
  await apple.addBuildToBetaGroup(external.id, input.build.id)
  await apple.enableAutomaticBetaNotifications(input.build.id)
  const externalRecipients = recipients.filter(recipient => recipient.isExternal)
  if (externalRecipients.length > 0) {
    await apple.ensureBetaAppLocalization(input.appId, {
      description: betaAppDescription(input.appName),
      feedbackEmail: externalRecipients[0]!.email,
    })
  }
  for (const recipient of recipients) {
    await apple.ensureBetaTester(recipient.email, recipient.groupId)
  }
  if (externalRecipients.length > 0) {
    await apple.submitBuildForBetaReview(input.build.id)
  }
  return { external: external.id, internal: internal.id }
}

function betaAppDescription(appName: string): string {
  return `${appName} is currently in beta. Please explore its features and share feedback through TestFlight.`
}

async function executeUpdate(
  prepared: PreparedShip,
  options: ShipCommandOptions,
  entry: ShipLockEntry,
  runtimeRoot: string,
  runner: ShipCommandRunner,
  progress: ShipProgress,
  logFile: FS.FileHandle | undefined,
  injected?: TaoUpdateClient,
): Promise<void> {
  const installed = entry.update
  if (
    !entry.lastBuild?.processed || !installed?.runtimeFingerprint || !installed.dataSchemaFingerprint
    || !installed.serverUrl
  ) {
    Errors.throwUserInput('Ship and process an iOS binary before publishing an update.')
  }
  const token = Platform.runtimeProcess.env['TAO_UPDATE_TOKEN']
  const client = injected ?? (token
    ? new TaoUpdateClient({ authorizationToken: () => token, baseUrl: installed.serverUrl })
    : undefined)
  if (!client) {
    Errors.throwUserInput('Set TAO_UPDATE_TOKEN to the Tao update service credential before publishing an update.')
  }
  if (options.rollback) {
    progress.step('update-publish')
    const previous = installed.previousPublicationId
    if (!previous) {
      Errors.throwUserInput('No earlier update publication is recorded for rollback.')
    }
    const published = await client.rollback({
      applicationId: prepared.project.id,
      channel: prepared.channel,
      toUpdateId: previous,
    })
    progress.step('checkpoint')
    await persistUpdate(prepared, entry, published.manifest.id)
    return
  }
  progress.step('compile')
  const currentRuntime = await runtimeFingerprint(runtimeRoot, runner as typeof CLI.run)
  const currentSchema = await dataSchemaFingerprint(prepared.project.root)
  assertUpdateCompatibility({ dataSchemaFingerprint: currentSchema, runtimeVersion: currentRuntime }, {
    dataSchemaFingerprint: installed.dataSchemaFingerprint,
    runtimeVersion: installed.runtimeFingerprint,
  })
  await Runtime.generateApp(prepared.app.sourcePath, {
    appName: prepared.app.name,
    datasourceConfiguration: entry.accepted?.datasourceConfiguration,
    runtimePackageRoot: runtimeRoot,
    ship: runtimeManifest(prepared, prepared.git.commit, currentRuntime, installed.serverUrl),
    validationMode: 'release',
  })
  progress.step('bundle-export')
  const exportRoot = await exportAndProve(runtimeRoot, runner, logFile)
  progress.step('update-publish')
  const publication = await publicationFromExport(
    client,
    prepared,
    exportRoot,
    currentRuntime,
    currentSchema,
    options.notes,
  )
  const published = await client.publish(publication)
  progress.step('checkpoint')
  await persistUpdate(prepared, entry, published.manifest.id)
  HCI.writeSuccess(
    `Published update ${published.manifest.id}; compatible installed builds receive it on next launch.\n`,
  )
}

async function exportAndProve(
  runtimeRoot: string,
  runner: ShipCommandRunner,
  logFile?: FS.FileHandle,
): Promise<string> {
  const exportRoot = FS.resolvePath('.artifacts/ship/export', runtimeRoot)
  await FS.remove(exportRoot)
  await runner(FS.resolvePath('node_modules/.bin/expo', runtimeRoot), {
    args: ['export', '--platform', 'ios', '--output-dir', exportRoot, '--clear'],
    cwd: runtimeRoot,
    prefixedOutput: { logFile, processName: 'expo', terminal: logFile === undefined },
  })
  await Runtime.proveReleaseBundle(exportRoot)
  return exportRoot
}

async function freshShipLog(path: string, options: ShipCommandOptions): Promise<FS.FileHandle> {
  await FS.writeText(path, '')
  HCI.writeLine(`Detailed log: ${FS.displayPath(path)}`, options)
  return await FS.openAppend(path)
}

async function publicationFromExport(
  client: TaoUpdateClient,
  prepared: PreparedShip,
  exportRoot: string,
  nativeFingerprint: string,
  schemaFingerprint: string,
  message?: string,
): Promise<TaoUpdatePublication> {
  const uploaded: ExpoUpdateAsset[] = []
  let launchAsset: ExpoUpdateAsset | undefined
  for await (const path of FS.walk(exportRoot)) {
    if (!await FS.isFile(path)) {
      continue
    }
    const bytes = await FS.readFile(path)
    const relative = FS.relativePath(exportRoot, path)
    const hash = createHash('sha256').update(bytes).digest('base64url')
    const extension = FS.extname(path)
    const asset = await client.uploadAsset({
      applicationId: prepared.project.id,
      bytes,
      contentType: contentType(extension),
      fileExtension: extension || undefined,
      hash,
      key: relative,
    })
    if (launchAsset === undefined && ['.bundle', '.hbc', '.js'].includes(extension)) {
      launchAsset = asset
    } else {
      uploaded.push(asset)
    }
  }
  if (!launchAsset) {
    Errors.throwUnexpected('Expected: the proved export has a launch bundle.')
  }
  return {
    applicationId: prepared.project.id,
    assets: uploaded,
    channel: prepared.channel,
    dataSchemaFingerprint: schemaFingerprint,
    launchAsset,
    message,
    metadata: { buildNumber: prepared.buildNumber, version: prepared.version },
    runtimeVersion: nativeFingerprint,
  }
}

function runtimeManifest(
  prepared: PreparedShip,
  commit: string,
  nativeFingerprint: string,
  updateServer: string,
): RuntimeShipManifest {
  const base = new URL(updateServer)
  return {
    buildNumber: prepared.buildNumber,
    bundleIdentifier: prepared.bundleIdentifier,
    git: { commit, dirty: prepared.git.dirty },
    icon: prepared.app.name === prepared.project.primaryAppName ? 'default' : 'badged',
    ...(prepared.app.icloud === undefined
      ? {}
      : {
        icloud: {
          containers: [prepared.app.icloud.container ?? `iCloud.${prepared.bundleIdentifier}`],
          services: [...prepared.app.icloud.services],
        },
      }),
    ios: { usesNonExemptEncryption: false },
    name: prepared.app.displayName,
    schemaVersion: 1,
    slug: prepared.app.name.replace(/[^A-Za-z0-9]/gu, ''),
    updates: {
      channel: prepared.channel,
      runtimeFingerprint: nativeFingerprint,
      runtimeVersion: { policy: 'fingerprint' },
      url: new URL(`/v1/apps/${encodeURIComponent(prepared.project.id)}/manifest`, base).href,
    },
    version: prepared.version,
  }
}

async function persistUpdate(prepared: PreparedShip, entry: ShipLockEntry, publicationId: string): Promise<void> {
  const updated = {
    ...entry,
    update: {
      ...entry.update!,
      previousPublicationId: entry.update?.publicationId,
      publicationId,
    },
  }
  await writeProjectLock(prepared.project.root, acceptedEntryWithRunState(prepared, updated))
  await persistShipCheckpoint(prepared, FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, prepared.project.root))
}

async function persistShipCheckpoint(prepared: PreparedShip, lockPath: string): Promise<void> {
  await commitShipState(prepared.git, lockPath, `Record ${prepared.app.name} ship state`)
}

async function pathIsTrackedAndClean(path: string, gitRoot: string): Promise<boolean> {
  const relative = FS.relativePath(gitRoot, await FS.realPath(path))
  const result = await CLI.run('git', { args: ['-C', gitRoot, 'status', '--porcelain=v1', '--', relative] })
  return result.exitCode === 0 && result.stdout.trim().length === 0
}

function contentType(extension: string): string {
  if (extension === '.js' || extension === '.bundle') {
    return 'application/javascript'
  }
  if (extension === '.json') {
    return 'application/json'
  }
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return 'application/octet-stream'
}

function writeSummary(prepared: PreparedShip, appId: string, sourceCommit: string, outcome: string): void {
  HCI.writeSuccess(`${outcome}\n`)
  HCI.writeLine(`App: ${prepared.app.name}`)
  HCI.writeLine(`Version: ${prepared.version} (${prepared.buildNumber})`)
  HCI.writeLine(
    `Commit: ${sourceCommit}${sourceCommit === prepared.git.commit && prepared.git.dirty ? ' (dirty)' : ''}`,
  )
  HCI.writeLine(`App Store Connect: https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`)
}
