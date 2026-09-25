import Runtime, { HostDependencies, RuntimeToolchainPaths, type ShipManifest as RuntimeShipManifest } from '@expo-host'
import { CLI, Errors, FS, HCI, Platform } from '@shared'
import { createAppStoreConnectToken } from './app-store-connect-auth'
import { type AppStoreBuild, AppStoreConnectClient } from './app-store-connect-client'
import type { PreparedShip, ShipCommandOptions } from './ship-command'
import { acceptedEntryWithRunState, preparedKeyPath } from './ship-command'
import { dataSchemaFingerprint, runtimeFingerprint } from './ship-fingerprints'
import { inspectShipGit, shipNotesSince } from './ship-git'
import { SHIP_LOCK_RELATIVE_PATH, type ShipLockEntry, writeProjectLock } from './ship-lock'
import { nextBuildNumber } from './ship-model'
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
  if (prepared.reuseBuild && prepared.git.root === undefined) {
    Errors.throwUserInput('A build outside Git cannot be reused because Tao cannot prove its exact source provenance.')
  }
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
  if (options.update || !prepared.reuseBuild) {
    await HostDependencies.ensure()
  }
  let activePrepared = prepared
  let entry = activePrepared.entry
  const releaseNotesFromCommit = prepared.reuseBuild
    ? entry.lastBuild?.releaseNotesFromCommit ?? entry.lastBuild?.commit
    : entry.lastBuild?.commit
  let lock = acceptedEntryWithRunState(activePrepared, entry)

  if (options.update) {
    await executeUpdate(
      activePrepared,
      options,
      entry,
      runtimeRoot,
      runner,
      progress,
      logFile,
      dependencies.updateClient,
    )
    return
  }

  if (prepared.versionBumped) {
    await writeProjectVersion(prepared.project, prepared.version)
  }
  await writeProjectLock(prepared.project.root, lock)
  activePrepared = {
    ...activePrepared,
    git: await inspectShipGit(prepared.project.root, {
      excludePaths: [FS.resolvePath(SHIP_LOCK_RELATIVE_PATH, prepared.project.root)],
    }),
  }
  const sourceCommit = activePrepared.git.commit

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

  if (!prepared.reuseBuild) {
    const remoteBuildNumbers = (await apple.builds(appId)).map(candidate => candidate.attributes.version)
    activePrepared = {
      ...activePrepared,
      buildNumber: nextBuildNumber(prepared.buildNumber, remoteBuildNumbers),
    }
  }

  let build: AppStoreBuild | undefined
  let nativeFingerprint = entry.update?.runtimeFingerprint
  let schemaFingerprint = entry.update?.dataSchemaFingerprint
  if (!prepared.reuseBuild) {
    progress.step('compile')
    nativeFingerprint = await runtimeFingerprint(runtimeRoot, runner as typeof CLI.run)
    schemaFingerprint = await dataSchemaFingerprint(prepared.project.root)
    const updateServer = entry.update?.serverUrl ?? 'https://updates.devtao.com'
    const manifest = runtimeManifest(activePrepared, sourceCommit, nativeFingerprint, updateServer)
    await Runtime.generateApp(activePrepared.app.sourcePath, {
      appName: activePrepared.app.name,
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
        archivePath: FS.resolvePath(`${activePrepared.app.name}.xcarchive`, artifacts),
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
        number: activePrepared.buildNumber,
        processed: false,
        processingState: 'PROCESSING',
        releaseNotesFromCommit,
        dirty: activePrepared.git.dirty,
        dirtyFingerprint: activePrepared.git.dirtyFingerprint,
        distribution: options.betaRecipients === undefined ? 'app-store' : 'testflight',
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
    lock = acceptedEntryWithRunState(activePrepared, entry)
    await writeProjectLock(activePrepared.project.root, lock)
    if (options.noWait) {
      progress.step('checkpoint')
      writeSummary(activePrepared, appId, sourceCommit, 'Uploaded; Apple is processing the build.', options)
      return
    }
    progress.step('apple-processing')
    build = await waitForProcessedBuild(apple, activePrepared, entry, appId)
  } else {
    const buildId = entry.lastBuild?.buildId
    if (!buildId) {
      progress.step('apple-processing')
      build = await waitForProcessedBuild(apple, activePrepared, entry, appId)
    } else {
      build = {
        attributes: { processingState: 'VALID', version: activePrepared.buildNumber },
        id: buildId,
        type: 'builds',
      }
    }
  }
  if (!build) {
    Errors.throwHostEnvironment(`Apple did not return processed build ${activePrepared.buildNumber}.`)
  }
  entry = {
    ...entry,
    lastBuild: {
      ...entry.lastBuild!,
      buildId: build.id,
      processed: true,
      processingState: 'VALID',
    },
    ...(nativeFingerprint === undefined || schemaFingerprint === undefined
      ? {}
      : {
        update: {
          ...entry.update!,
          supportedBinaries: mergeSupportedBinary(entry.update?.supportedBinaries ?? [], {
            buildNumber: activePrepared.buildNumber,
            dataSchemaFingerprint: schemaFingerprint,
            platform: 'ios',
            runtimeVersion: nativeFingerprint,
            version: activePrepared.version,
          }),
        },
      }),
  }

  if (options.betaRecipients !== undefined) {
    progress.step('testflight')
    entry = await distributeBeta(apple, activePrepared, entry, build, appId, releaseNotesFromCommit, options)
  } else {
    progress.step('app-review')
    const version = await apple.ensureAppStoreVersion(appId, activePrepared.version)
    await apple.attachBuildToVersion(version.id, build.id)
    await apple.submitVersionForReview(appId, version.id)
    entry = {
      ...entry,
      lastBuild: {
        ...entry.lastBuild!,
        buildId: build.id,
        processed: true,
        processingState: 'VALID',
        submittedForReview: true,
      },
    }
  }
  progress.step('checkpoint')
  await writeProjectLock(activePrepared.project.root, acceptedEntryWithRunState(activePrepared, entry))
  writeSummary(
    activePrepared,
    appId,
    entry.lastBuild?.commit ?? sourceCommit,
    options.betaRecipients === undefined ? 'Submitted for App Store review.' : 'Distributed through TestFlight.',
    options,
  )
}

function mergeSupportedBinary(
  current: NonNullable<NonNullable<ShipLockEntry['update']>['supportedBinaries']>,
  binary: NonNullable<NonNullable<ShipLockEntry['update']>['supportedBinaries']>[number],
): NonNullable<NonNullable<ShipLockEntry['update']>['supportedBinaries']> {
  return [...current.filter(candidate => candidate.buildNumber !== binary.buildNumber), binary]
    .toSorted((left, right) => left.buildNumber.localeCompare(right.buildNumber, undefined, { numeric: true }))
}

async function waitForProcessedBuild(
  apple: ShipAppleClient,
  prepared: PreparedShip,
  entry: ShipLockEntry,
  appId: string,
): Promise<AppStoreBuild> {
  return await apple.waitForProcessedBuild({
    appId,
    buildNumber: prepared.buildNumber,
    onTerminalBuild: async terminal => {
      await writeProjectLock(
        prepared.project.root,
        acceptedEntryWithRunState(prepared, {
          ...entry,
          lastBuild: {
            ...entry.lastBuild!,
            buildId: terminal.id,
            processed: false,
            processingState: terminal.attributes.processingState,
          },
        }),
      )
    },
  })
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
  previousBuildCommit: string | undefined,
  options: ShipCommandOptions,
): Promise<ShipLockEntry> {
  const notes = options.notes ?? await shipNotesSince(prepared.git, previousBuildCommit)
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
    const current = installed.publicationId
    const supportedBinaries = installed.supportedBinaries ?? []
    if (!current) {
      Errors.throwUserInput('No current update publication is recorded for rollback.')
    }
    if (supportedBinaries.length === 0) {
      Errors.throwUserInput('No supported binary compatibility contracts are recorded for rollback.')
    }
    const published = await client.rollbackCompatible({
      applicationId: prepared.project.id,
      channel: prepared.channel,
      currentUpdateId: current,
      supportedBinaries,
    })
    progress.step('checkpoint')
    await persistUpdate(prepared, entry, published.manifest.id)
    return
  }
  progress.step('compile')
  const currentRuntime = await runtimeFingerprint(runtimeRoot, runner as typeof CLI.run)
  const currentSchema = await dataSchemaFingerprint(prepared.project.root)
  const supportedBinaries = installed.supportedBinaries ?? [{
    dataSchemaFingerprint: installed.dataSchemaFingerprint,
    platform: 'ios' as const,
    runtimeVersion: installed.runtimeFingerprint,
  }]
  assertUpdateCompatibility({
    dataSchemaFingerprint: currentSchema,
    metadata: { platform: 'ios' },
    runtimeVersion: currentRuntime,
  }, supportedBinaries)
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
  const expo = RuntimeToolchainPaths.expoCommand(runtimeRoot, [
    'export',
    '--platform',
    'ios',
    '--output-dir',
    exportRoot,
    '--clear',
  ])
  await runner(expo.command, {
    args: expo.args,
    cwd: runtimeRoot,
    env: expo.env,
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
  const artifacts = await Runtime.expoUpdateArtifacts(exportRoot, 'ios')
  const upload = async (descriptor: typeof artifacts.launchAsset): Promise<ExpoUpdateAsset> => {
    const bytes = await FS.readFile(descriptor.path)
    const hash = Platform.sha256Base64Url(bytes)
    return await client.uploadAsset({
      applicationId: prepared.project.id,
      bytes,
      contentType: descriptor.contentType,
      fileExtension: descriptor.fileExtension,
      hash,
      key: descriptor.key,
    })
  }
  const launchAsset = await upload(artifacts.launchAsset)
  const uploaded = await Promise.all(artifacts.assets.map(upload))
  return {
    applicationId: prepared.project.id,
    assets: uploaded,
    channel: prepared.channel,
    dataSchemaFingerprint: schemaFingerprint,
    launchAsset,
    message,
    metadata: { buildNumber: prepared.buildNumber, platform: 'ios', version: prepared.version },
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
  const defaultContainer = `iCloud.${prepared.bundleIdentifier}`
  const resolvedICloudServices = prepared.app.icloud?.serviceBindings.map(binding => ({
    containers: [
      ...(binding.usesDefaultContainer ? [defaultContainer] : []),
      ...binding.containers,
    ],
    service: binding.service,
  })) ?? []
  return {
    buildNumber: prepared.buildNumber,
    bundleIdentifier: prepared.bundleIdentifier,
    git: { commit, dirty: prepared.git.dirty },
    icon: prepared.app.name === prepared.project.primaryAppName ? 'default' : 'badged',
    ...(prepared.app.icloud === undefined
      ? {}
      : {
        icloud: {
          containers: [...new Set(resolvedICloudServices.flatMap(binding => binding.containers))].toSorted(),
          documentContainers: [
            ...new Set(
              resolvedICloudServices
                .filter(binding => binding.service === 'CloudDocuments')
                .flatMap(binding => binding.containers),
            ),
          ].toSorted(),
          services: resolvedICloudServices.map(binding => binding.service).toSorted(),
        },
      }),
    ios: {},
    name: prepared.app.displayName,
    schemaVersion: 1,
    slug: prepared.app.name.replace(/[^A-Za-z0-9]/gu, ''),
    updates: {
      channel: prepared.channel,
      runtimeFingerprint: nativeFingerprint,
      runtimeVersion: nativeFingerprint,
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
      publicationId,
    },
  }
  await writeProjectLock(prepared.project.root, acceptedEntryWithRunState(prepared, updated))
}

function writeSummary(
  prepared: PreparedShip,
  appId: string,
  sourceCommit: string,
  outcome: string,
  options: ShipCommandOptions,
): void {
  HCI.writeSuccess(`${outcome}\n`, options)
  HCI.writeLine(`App: ${prepared.app.name}`, options)
  HCI.writeLine(`Version: ${prepared.version} (${prepared.buildNumber})`, options)
  HCI.writeLine(
    `Commit: ${sourceCommit}${sourceCommit === prepared.git.commit && prepared.git.dirty ? ' (dirty)' : ''}`,
    options,
  )
  HCI.writeLine(`App Store Connect: https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`, options)
}

/** Narrow test seam for release artifact wiring that otherwise sits behind Apple and Xcode. */
export const ShipExecutorTesting = { publicationFromExport, runtimeManifest }
