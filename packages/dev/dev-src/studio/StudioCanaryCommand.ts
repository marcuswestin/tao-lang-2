import { Errors, FS, HCI, Repo } from '@shared'
import {
  canaryExitCode,
  evaluateCanary,
  survivingOwnedPids,
  writeCanaryReport,
} from './StudioCanary'
import { runStudioDev } from './StudioDev'
import { readStudioDoctorFacts } from './StudioDoctor'
import { readLaunches } from './StudioLaunchManifest'
import type { StudioNativeProbeResult } from './StudioNative'
import {
  formatReleaseValidation,
  readExternalGates,
  readPayloadInventory,
  releaseExitCode,
  releaseValidation,
} from './StudioReleaseValidation'

/** The `./dev studio-canary` and `./dev studio-release-check` entry points. */

export type CanaryOptions = {
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

  const projectRoot = options.projectRoot ?? FS.resolvePath('Apps/HNReader', repositoryRoot)
  const before = new Set((await readLaunches(repositoryRoot)).map(launch => launch.manifest.launchId))
  await runStudioDev({
    browser: false,
    native: true,
    nativeArtifactRoot: FS.resolvePath('electrobun', artifactRoot),
    nativeHutchPath: options.hutchPath,
    nativeProbe: true,
    projectRoot,
  })
  const launchId = (await readLaunches(repositoryRoot))
    .map(launch => launch.manifest.launchId)
    .find(id => !before.has(id))
  // The native shell writes its probe result beside its generated Electrobun project.
  const probe = await readProbeResult(FS.resolvePath('electrobun/artifacts/runtime-result.json', artifactRoot))
  const report = evaluateCanary({
    probe,
    survivingPids: launchId === undefined ? [] : await survivingOwnedPids(launchId, repositoryRoot),
  })
  await writeCanaryReport(report, artifactRoot)
  return canaryExitCode(report)
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

export type ReleaseCheckOptions = {
  appPath?: string
  artifactNames?: readonly string[]
  diskImagePath?: string
  payloadRoot: string
  releaseBaseUrl?: string
}

/** Validates a built release without publishing anything, so a dry run is always safe. */
async function runStudioReleaseCheck(options: ReleaseCheckOptions): Promise<number> {
  if (!await FS.isDirectory(options.payloadRoot)) {
    Errors.throwUserInput(`No staged service payload at ${options.payloadRoot}.`)
  }
  const validation = releaseValidation(
    await readPayloadInventory(options.payloadRoot),
    { names: options.artifactNames ?? [], releaseBaseUrl: options.releaseBaseUrl },
    await readExternalGates({ appPath: options.appPath, diskImagePath: options.diskImagePath }),
  )
  HCI.writeLine(formatReleaseValidation(validation))
  return releaseExitCode(validation)
}

/** StudioCanaryCommand groups the native canary and the release validation entry points. */
export const StudioCanaryCommand = {
  canary: runStudioCanary,
  releaseCheck: runStudioReleaseCheck,
}
