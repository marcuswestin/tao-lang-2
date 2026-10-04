import { Errors, FS, HCI, Platform, Repo } from '@shared'
import { GateCatalog } from '@verification/GateCatalog'
import { MachineLanes } from '@verification/MachineLanes'
import { UiVisibility } from '@verification/UiVisibility'
import {
  canaryExitCode,
  evaluateCanary,
  survivingOwnedPids,
  writeCanaryReport,
} from './StudioCanary'
import { runStudioDev, type StudioDevCleanupResult, type StudioDevOptions } from './StudioDev'
import { readStudioDoctorFacts } from './StudioDoctor'
import { readLaunches, type StudioLaunchManifest } from './StudioLaunchManifest'
import type { StudioNativeProbeResult } from './StudioNative'
import { StudioNativeTestRun } from './StudioNativeTestRun'
import {
  formatReleaseValidation,
  readArtifactInventory,
  readExternalGates,
  readPayloadInventory,
  releaseExitCode,
  releaseValidation,
} from './StudioReleaseValidation'

/** The `./dev studio-canary` and `./dev studio-release-check` entry points. */

type CanaryOptions = {
  /** The app to open. A project with several apps is not deterministic without one. */
  appName?: string
  artifactRoot?: string
  hutchPath?: string
  projectRoot?: string
  showStudio?: boolean
}

type CanaryCommandDependencies = {
  blockedReason: () => Promise<string | undefined>
  readLaunches: typeof readLaunches
  readProbeResult: typeof readProbeResult
  runStudioDev: typeof runStudioDev
  survivingOwnedPids: typeof survivingOwnedPids
  /** Test registry; production shares the machine-wide resource registry. */
  registryRoot?: string
}

const canaryCommandDependencies: CanaryCommandDependencies = {
  blockedReason: canaryBlockedReason,
  readLaunches,
  readProbeResult,
  runStudioDev,
  survivingOwnedPids,
}

/**
 * Runs the native shell against a deterministic project and reports what it proved. A host that
 * cannot run an AppKit application at all is reported as blocked, which is neither a pass nor a
 * repository failure.
 */
async function runStudioCanary(
  options: CanaryOptions = {},
  dependencies: CanaryCommandDependencies = canaryCommandDependencies,
): Promise<number> {
  if (options.showStudio === true) {
    UiVisibility.warn(UiVisibility.studioWarnings)
  }
  const guiLease = Platform.runtimeProcess.env[GateCatalog.GUI_LEASE_HELD_ENV_KEY] === 'true'
    ? undefined
    : await MachineLanes.acquireResource({
      command: 'studio-canary',
      name: GateCatalog.GUI_RESOURCE,
      registryRoot: dependencies.registryRoot,
      repositoryRoot: Repo.getRoot(),
      waitTimeoutMs: 10 * 60_000,
    })
  try {
    return await runStudioCanaryWithLease(options, dependencies)
  } finally {
    await guiLease?.release()
  }
}

async function runStudioCanaryWithLease(
  options: CanaryOptions,
  dependencies: CanaryCommandDependencies,
): Promise<number> {
  const repositoryRoot = Repo.getRoot()
  const artifactBase = FS.resolvePath(
    options.artifactRoot ?? '.artifacts/tests/studio-canary',
    repositoryRoot,
  )
  const invocation = await createCanaryInvocation(artifactBase)
  const artifactRoot = invocation.root
  await sweepEarlierCanaryInvocations(artifactBase, invocation.id)
  const blockedReason = await dependencies.blockedReason()
  if (blockedReason !== undefined) {
    const report = evaluateCanary({ blockedReason })
    await writeCanaryReport(report, artifactRoot)
    return canaryExitCode(report)
  }

  const target = await StudioNativeTestRun.project(options, artifactRoot, repositoryRoot)
  const { appName, projectRoot } = target
  let cleanupProof: StudioDevCleanupResult | undefined
  let survivingPids: readonly number[] | undefined
  try {
    const isolation = await StudioNativeTestRun.devOptions(artifactRoot)
    const probePath = await freshProbeResultPath(artifactRoot)
    let launchFailure: unknown
    let launchId: string | undefined
    let exitCode: number
    try {
      exitCode = await dependencies.runStudioDev({
        ...canaryStudioDevOptions({
          appName,
          artifactRoot,
          hutchPath: options.hutchPath,
          onFailure: error => {
            launchFailure ??= error
          },
          onLaunch: id => {
            launchId ??= id
          },
          projectRoot,
          showStudio: options.showStudio === true,
        }),
        ...isolation,
        onCleanup: result => {
          cleanupProof = result
        },
      })
    } catch (error) {
      launchFailure ??= error
      exitCode = 1
    }
    const launch = launchId === undefined
      ? undefined
      : findCanaryLaunch(launchId, await dependencies.readLaunches(repositoryRoot, isolation.launchRecordsRoot))
    // The native shell writes its probe result beside its generated Electrobun project.
    const probe = await dependencies.readProbeResult(probePath)
    const disposition = canaryLaunchDisposition({ exitCode, failure: launchFailure, probe })
    survivingPids = launch === undefined
      ? []
      : canarySurvivingPids(
        launch.manifest,
        await dependencies.survivingOwnedPids(launch.manifest.launchId, repositoryRoot, isolation.launchRecordsRoot),
      )
    const cleanupVerified = cleanupProof?.resourcesStopped === true
    const report = evaluateCanary({
      ...disposition,
      failureReason: disposition.failureReason ?? (!cleanupVerified && probe !== undefined
        ? 'Studio did not confirm shutdown of its native and project processes after the probe.'
        : undefined),
      exitCode,
      probe,
      survivingPids,
    })
    await writeCanaryReport(report, artifactRoot)
    if (report.status === 'passed' && cleanupVerified) {
      await pruneNativeBuild(artifactRoot)
    }
    return canaryExitCode(report)
  } finally {
    await target.cleanup(survivingPids === undefined ? undefined : cleanupProof, survivingPids)
  }
}

/**
 * Pruning a passing build is the last thing a run does, so a run killed before it reported leaves
 * its whole invocation behind, and a run killed between its report and its prune leaves the build.
 * Nothing else looks at a sibling invocation — the surviving-process check and the prune are both
 * scoped to this run's own launch — so those directories accumulate tens of megabytes each until
 * someone notices. Each later run cleans up after the earlier ones it can prove are finished.
 *
 * What it must not remove: a failed or blocked run's build, which is the evidence that run exists
 * to produce, and anything a live run owns. An invocation touched recently is treated as live,
 * because a canary that has not yet written its report is indistinguishable from one that died
 * before writing it.
 */
async function sweepEarlierCanaryInvocations(
  artifactBase: string,
  currentInvocationId: string,
  isInactive: typeof StudioNativeTestRun.isInactive = StudioNativeTestRun.isInactive,
): Promise<void> {
  const invocationsRoot = FS.resolvePath('invocations', artifactBase)
  try {
    for (const entry of await FS.listDir(invocationsRoot)) {
      if (entry === currentInvocationId) {
        continue
      }
      const root = FS.resolvePath(entry, invocationsRoot)
      if (
        !await FS.isDirectory(root) || await modifiedWithin(root, LIVE_INVOCATION_MS)
        || !await isInactive(root)
      ) {
        continue
      }
      const report = await readCanaryReportStatus(FS.resolvePath('canary.json', root))
      if (report === undefined) {
        // It never reported, so it is evidence of nothing.
        await FS.remove(root)
      } else if (report === 'passed') {
        await FS.remove(FS.resolvePath('electrobun', root))
      }
    }
  } catch (error) {
    HCI.logProcessError(
      'studio-canary',
      `Could not sweep earlier canary invocations: ${Errors.formatForLog(Errors.asError(error))}`,
    )
  }
}

/** How recently an invocation must have been touched to be treated as still running. */
const LIVE_INVOCATION_MS = 60 * 60 * 1000

async function modifiedWithin(path: string, windowMs: number): Promise<boolean> {
  try {
    return Date.now() - await FS.modifiedTimeMs(path) < windowMs
  } catch {
    return true
  }
}

async function readCanaryReportStatus(path: string): Promise<string | undefined> {
  try {
    return (await FS.readJson<{ status?: string }>(path)).status
  } catch {
    return undefined
  }
}

/**
 * Every invocation builds its own Electrobun project (tens of megabytes). A passing run needs only
 * its report, so its build is removed; a blocked or failed run keeps the build as evidence.
 */
async function pruneNativeBuild(artifactRoot: string): Promise<void> {
  try {
    await FS.remove(FS.resolvePath('electrobun', artifactRoot))
  } catch (error) {
    HCI.logProcessError('studio-canary', `Could not remove the passing canary build: ${Errors.formatForLog(error)}`)
  }
}

/**
 * A canary runs Studio in-process, so its finalized manifest retains the canary command itself as
 * the `studio-server` process. The command has not exited yet while it writes its report, but it
 * is not a shutdown survivor: `runStudioDev` has already stopped every resource and finalized the
 * launch. Ignore only that current owner on a stopped launch; child processes and another
 * process's owner remain real survivors.
 */
function canarySurvivingPids(
  manifest: Pick<StudioLaunchManifest, 'ownerPid' | 'state'>,
  ownedPids: readonly number[],
  canaryPid = Platform.runtimeProcess.pid,
): number[] {
  if (manifest.state !== 'stopped' || manifest.ownerPid !== canaryPid) {
    return [...ownedPids]
  }
  return ownedPids.filter(pid => pid !== canaryPid)
}

async function freshProbeResultPath(artifactRoot: string): Promise<string> {
  const path = FS.resolvePath('electrobun/artifacts/runtime-result.json', artifactRoot)
  await FS.remove(path)
  return path
}

function canaryStudioDevOptions(options: {
  appName: string | undefined
  artifactRoot: string
  hutchPath: string | undefined
  onFailure?: (error: unknown) => void
  onLaunch?: (launchId: string) => void
  projectRoot: string
  showStudio?: boolean
}): StudioDevOptions & { nativeShowStudio: boolean } {
  return {
    appName: options.appName,
    // The runtime probe reports on a project window, so the canary must ask for one. `--no-browser`
    // means "Welcome only" for the native shell, which would leave the probe nothing to report on.
    browser: true,
    native: true,
    nativeArtifactRoot: FS.resolvePath('electrobun', options.artifactRoot),
    nativeHutchPath: options.hutchPath,
    nativeHostCommand: 'studio-canary',
    nativeProbe: true,
    nativeShowStudio: options.showStudio === true,
    nativeShowWindow: options.showStudio === true,
    onFailure: options.onFailure,
    onLaunch: options.onLaunch,
    projectRoot: options.projectRoot,
  }
}

/**
 * Keeps a pre-probe Studio failure truthful instead of guessing that every exit was AppKit. The
 * failure can come from setup or from waiting on a native shell that already started, so the reason
 * names only what is known: the probe never reported.
 */
function canaryLaunchDisposition(input: {
  exitCode: number
  failure?: unknown
  probe?: StudioNativeProbeResult
}): { blockedReason?: string; failureReason?: string } {
  if (input.probe !== undefined || input.exitCode === 0) {
    return {}
  }
  if (input.failure !== undefined) {
    const failure = Errors.fromUnknown(input.failure)
    const category = failure instanceof Errors.UserInputError
      ? 'user input'
      : failure instanceof Errors.HostEnvironmentError || failure instanceof Errors.CommandExecutionError
      ? 'host environment'
      : 'unexpected behavior'
    const reason = `Studio failed before the native probe reported (${category}): ${failure.messageForUser}`
    return failure instanceof Errors.UnexpectedBehaviorError
      ? { failureReason: reason }
      : { blockedReason: reason }
  }
  return {
    blockedReason: `the native runtime exited ${input.exitCode} before reporting. If it terminated by a signal, `
      + 'this host refused AppKit registration; run the canary from an ordinary Terminal.',
  }
}

async function createCanaryInvocation(
  artifactBase: string,
  invocationId = Platform.randomUUID(),
): Promise<{ id: string; root: string }> {
  return await StudioNativeTestRun.create(artifactBase, invocationId)
}

function findCanaryLaunch<T extends { manifest: { launchId: string } }>(
  launchId: string,
  launches: readonly T[],
): T | undefined {
  return launches.find(candidate => candidate.manifest.launchId === launchId)
}

async function readProbeResult(path: string): Promise<StudioNativeProbeResult | undefined> {
  try {
    return await FS.readJson<StudioNativeProbeResult>(path)
  } catch {
    return undefined
  }
}

/** canaryBlockedReason names the one prerequisite a host is missing, if it is missing one. */
async function canaryBlockedReason(): Promise<string | undefined> {
  const facts = await readStudioDoctorFacts()
  if (facts.hutchPath === undefined) {
    return 'Hutch is not installed, so the native shell cannot start. Install it, then rerun.'
  }
  if (!facts.appKitAvailable) {
    return facts.appKitReason
      ?? 'this host cannot register a native application; run the canary from the desktop session.'
  }
  return undefined
}

type ReleaseCheckOptions = {
  allowUnverified?: boolean
  appPath?: string
  /** The directory the build wrote its artifacts into. Its contents are read, not described. */
  artifactsRoot: string
  diskImagePath?: string
  firstRelease?: boolean
  payloadRoot: string
  releaseBaseUrl?: string
}

/** Validates a built release without publishing anything, so a dry run is always safe. */
async function runStudioReleaseCheck(options: ReleaseCheckOptions): Promise<number> {
  if (!await FS.isDirectory(options.payloadRoot)) {
    Errors.throwUserInput(`No staged service payload at ${options.payloadRoot}.`)
  }
  if (!await FS.isDirectory(options.artifactsRoot)) {
    Errors.throwUserInput(`No build artifact directory at ${options.artifactsRoot}.`)
  }
  for (const [label, path] of [['--app', options.appPath], ['--dmg', options.diskImagePath]] as const) {
    if (path !== undefined && !await FS.exists(path)) {
      Errors.throwUserInput(`${label} names ${path}, which does not exist.`)
    }
  }
  const validation = releaseValidation(
    await readPayloadInventory(options.payloadRoot),
    await readArtifactInventory(options.artifactsRoot, options.releaseBaseUrl, options.firstRelease),
    await readExternalGates({ appPath: options.appPath, diskImagePath: options.diskImagePath }),
  )
  HCI.writeLine(formatReleaseValidation(validation))
  return releaseExitCode(validation, { allowUnverified: options.allowUnverified })
}

/** StudioCanaryCommand groups the native canary and the release validation entry points. */
export const StudioCanaryCommand = {
  canary: runStudioCanary,
  releaseCheck: runStudioReleaseCheck,
  testing: {
    canaryLaunchDisposition,
    canaryStudioDevOptions,
    canarySurvivingPids,
    createCanaryInvocation,
    findCanaryLaunch,
    freshProbeResultPath,
    runStudioCanary,
    sweepEarlierCanaryInvocations,
  },
}
