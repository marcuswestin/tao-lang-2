import { Errors, FS, HCI, Platform, Repo } from '@shared'
import {
  canaryExitCode,
  evaluateCanary,
  resolveCanaryTarget,
  survivingOwnedPids,
  writeCanaryReport,
} from './StudioCanary'
import { runStudioDev, type StudioDevOptions } from './StudioDev'
import { readStudioDoctorFacts } from './StudioDoctor'
import { readLaunches, type StudioLaunchManifest } from './StudioLaunchManifest'
import type { StudioNativeProbeResult } from './StudioNative'
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
}

/**
 * Runs the native shell against a deterministic project and reports what it proved. A host that
 * cannot run an AppKit application at all is reported as blocked, which is neither a pass nor a
 * repository failure.
 */
async function runStudioCanary(options: CanaryOptions = {}): Promise<number> {
  const repositoryRoot = Repo.getRoot()
  const artifactRoot = FS.resolvePath(
    options.artifactRoot ?? '.artifacts/tests/studio-canary',
    repositoryRoot,
  )
  await FS.mkdir(artifactRoot)
  const blockedReason = await canaryBlockedReason()
  if (blockedReason !== undefined) {
    const report = evaluateCanary({ blockedReason })
    await writeCanaryReport(report, artifactRoot)
    return canaryExitCode(report)
  }

  const { appName, projectRoot } = resolveCanaryTarget(options, repositoryRoot)
  const probePath = await freshProbeResultPath(artifactRoot)
  const before = new Set((await readLaunches(repositoryRoot)).map(launch => launch.manifest.launchId))
  const exitCode = await runStudioDev(canaryStudioDevOptions({
    appName,
    artifactRoot,
    hutchPath: options.hutchPath,
    projectRoot,
  }))
  const launch = (await readLaunches(repositoryRoot))
    .find(candidate => !before.has(candidate.manifest.launchId))
  // The native shell writes its probe result beside its generated Electrobun project.
  const probe = await readProbeResult(probePath)
  const report = evaluateCanary({
    // A native shell that never reported means it never got far enough to run the probe. The
    // usual cause is the window server refusing AppKit registration, which aborts the runtime.
    blockedReason: probe === undefined && exitCode !== 0
      ? `the native runtime exited ${exitCode} before reporting. If it terminated by a signal, `
        + 'this host refused AppKit registration; run the canary from an ordinary Terminal.'
      : undefined,
    exitCode,
    probe,
    survivingPids: launch === undefined
      ? []
      : canarySurvivingPids(
        launch.manifest,
        await survivingOwnedPids(launch.manifest.launchId, repositoryRoot),
      ),
  })
  await writeCanaryReport(report, artifactRoot)
  return canaryExitCode(report)
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
  projectRoot: string
}): StudioDevOptions {
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
    nativeShowWindow: false,
    projectRoot: options.projectRoot,
  }
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
    await readArtifactInventory(options.artifactsRoot, options.releaseBaseUrl),
    await readExternalGates({ appPath: options.appPath, diskImagePath: options.diskImagePath }),
  )
  HCI.writeLine(formatReleaseValidation(validation))
  return releaseExitCode(validation, { allowUnverified: options.allowUnverified })
}

/** StudioCanaryCommand groups the native canary and the release validation entry points. */
export const StudioCanaryCommand = {
  canary: runStudioCanary,
  releaseCheck: runStudioReleaseCheck,
  testing: { canaryStudioDevOptions, canarySurvivingPids, freshProbeResultPath },
}
