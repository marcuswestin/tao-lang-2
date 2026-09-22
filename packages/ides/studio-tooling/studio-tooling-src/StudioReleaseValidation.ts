import { CLI, FS } from '@shared'

/**
 * What `package-studio-native` already does — a release compile, a staged service payload, a
 * materialized Node runtime, and an artifact-name check — leaves the questions that only a built
 * bundle can answer: is the payload actually standalone, is it deep-signed, is it notarized, does
 * the disk image mount, and can a client update from it. Those are checked here.
 *
 * Every check that needs Apple's own tooling reports `unverified` rather than passing when the
 * tool is absent, so a release run on a machine without it never reads as validated.
 */

/** ReleaseCheckStatus separates "checked and good" from "could not check". */
type ReleaseCheckStatus = 'failed' | 'passed' | 'unverified'

type ReleaseCheck = {
  detail: string
  name: string
  remediation?: string
  status: ReleaseCheckStatus
}

/** ReleaseValidation is the versioned result a release run produces. */
export type ReleaseValidation = {
  checks: readonly ReleaseCheck[]
  status: ReleaseCheckStatus
  version: 1
}

/** Strings in a packaged payload that prove it is not standalone. */
const NON_PORTABLE_MARKERS = [
  { marker: 'bunx ', reason: 'runs bunx, which the installing machine is not required to have' },
  { marker: '/.devenv/profile/', reason: "points at this checkout's devenv profile" },
  { marker: '/packages/apps/expo-host/', reason: 'points at a repository path' },
]

/** PayloadInventory is what the staged service payload actually contains. */
export type PayloadInventory = {
  /** Every file in the payload, relative to its root. */
  files: readonly string[]
  /** Files whose contents mention something the installing machine will not have. */
  nonPortableReferences: readonly { file: string; reason: string }[]
}

/**
 * ArtifactInventory is what the build actually produced. `names` is read from the artifact
 * directory on disk, never supplied by the caller: a release gate that trusts a list of names
 * it was handed proves only that the caller can type.
 */
export type ArtifactInventory = {
  names: readonly string[]
  releaseBaseUrl?: string
  /** The directory the names were read from, for the report. */
  root?: string
  updateManifest?: unknown
  updateManifestError?: string
}

/** ExternalGateResults are the outcomes of the Apple tools, or undefined when a tool is absent. */
export type ExternalGateResults = {
  deepSigned?: boolean
  diskImageValid?: boolean
  notarized?: boolean
}

/** releaseChecks reports every release gate from gathered evidence. */
function releaseChecks(
  payload: PayloadInventory,
  artifacts: ArtifactInventory,
  gates: ExternalGateResults,
): ReleaseCheck[] {
  return [
    standalonePayloadCheck(payload),
    nodeRuntimeCheck(payload),
    updateManifestCheck(artifacts),
    differentialUpdateCheck(artifacts),
    externalGateCheck('deep signature', gates.deepSigned, 'codesign --verify --deep --strict <app>'),
    externalGateCheck('notarization', gates.notarized, 'xcrun stapler validate <app>'),
    externalGateCheck('disk image', gates.diskImageValid, 'hdiutil verify <dmg>'),
  ]
}

/** releaseValidation wraps the checks, with `unverified` never counted as a pass. */
export function releaseValidation(
  payload: PayloadInventory,
  artifacts: ArtifactInventory,
  gates: ExternalGateResults,
): ReleaseValidation {
  const checks = releaseChecks(payload, artifacts, gates)
  const status: ReleaseCheckStatus = checks.some(check => check.status === 'failed')
    ? 'failed'
    : checks.some(check => check.status === 'unverified')
    ? 'unverified'
    : 'passed'
  return { checks, status, version: 1 }
}

/**
 * releaseExitCode fails a release whose gates could not all be checked. An unverified gate is not
 * a pass: a build nobody could confirm was signed must not be publishable just because the tool
 * that checks it was absent. `allowUnverified` is for inspecting a build on a machine that was
 * never going to be able to check it.
 */
export function releaseExitCode(
  validation: ReleaseValidation,
  options: { allowUnverified?: boolean } = {},
): number {
  if (validation.status === 'failed') {
    return 1
  }
  return validation.status === 'unverified' && options.allowUnverified !== true ? 1 : 0
}

function standalonePayloadCheck(payload: PayloadInventory): ReleaseCheck {
  if (payload.nonPortableReferences.length === 0) {
    return {
      detail: `${payload.files.length} payload files, none referencing this machine`,
      name: 'standalone payload',
      status: 'passed',
    }
  }
  return {
    detail: payload.nonPortableReferences
      .map(reference => `${reference.file} ${reference.reason}`)
      .join('; '),
    name: 'standalone payload',
    remediation: 'Bundle or copy the dependency into the payload instead of resolving it at run time.',
    status: 'failed',
  }
}

function nodeRuntimeCheck(payload: PayloadInventory): ReleaseCheck {
  const runtime = payload.files.filter(file => file === 'node' || file.endsWith('/node'))
  const nativeLibraries = payload.files.filter(file => /\.(dylib|node|so)$/.test(file))
  if (runtime.length === 0) {
    return {
      detail: 'no Node runtime is packaged, so the installed app depends on the host having one',
      name: 'packaged runtime',
      remediation: 'Materialize the Node runtime into the payload before building.',
      status: 'failed',
    }
  }
  return {
    detail: `${runtime.join(', ')} plus ${nativeLibraries.length} native ${
      nativeLibraries.length === 1 ? 'library' : 'libraries'
    }`,
    name: 'packaged runtime',
    status: 'passed',
  }
}

function updateManifestCheck(artifacts: ArtifactInventory): ReleaseCheck {
  const manifestName = artifacts.names.find(name => name.endsWith('-update.json'))
  if (manifestName === undefined) {
    return {
      detail: artifacts.root === undefined
        ? 'no artifact directory was inspected, so no update manifest could be found'
        : `no update manifest in ${artifacts.root}, so installed copies can never update`,
      name: 'update manifest',
      remediation: 'Check the Electrobun release configuration for this channel.',
      status: 'failed',
    }
  }
  if (artifacts.releaseBaseUrl === undefined || !isHttpsUrl(artifacts.releaseBaseUrl)) {
    return {
      // The host is named, never any credential that reaches it.
      detail: `${manifestName} was produced, but its release host is not an HTTPS URL`,
      name: 'update manifest',
      remediation: 'Pass an https:// --release-base-url; updates are fetched over it.',
      status: 'failed',
    }
  }
  const manifest = artifacts.updateManifest
  if (artifacts.updateManifestError !== undefined || !isRecord(manifest)) {
    return {
      detail: `${manifestName} could not be read as a valid update manifest`,
      name: 'update manifest',
      remediation: 'Inspect the generated update metadata before distributing this build.',
      status: 'failed',
    }
  }
  const artifact = manifest['artifact']
  const expectedName = `${manifest['channel']}-${manifest['platform']}-${manifest['arch']}-update.json`
  const artifactFile = isRecord(artifact) ? artifact['file'] : undefined
  if (
    manifest['schemaVersion'] !== 1
    || manifest['channel'] !== 'stable' && manifest['channel'] !== 'canary'
    || manifest['platform'] !== 'macos'
    || manifest['arch'] !== 'arm64' && manifest['arch'] !== 'x64'
    || typeof manifest['identifier'] !== 'string' || manifest['identifier'] === ''
    || typeof manifest['version'] !== 'string' || manifest['version'] === ''
    || typeof manifest['hash'] !== 'string' || !/^[a-z0-9]{1,13}$/.test(manifest['hash'])
    || manifestName !== expectedName
    || typeof artifactFile !== 'string'
    || !artifactFile.startsWith(`${manifest['channel']}-${manifest['platform']}-${manifest['arch']}-`)
    || !artifactFile.endsWith('.tar.zst')
    || !artifacts.names.includes(artifactFile)
  ) {
    return {
      detail: `${manifestName} does not describe a matching local macOS update archive`,
      name: 'update manifest',
      remediation: 'Rebuild this channel and check the generated manifest and archive together.',
      status: 'failed',
    }
  }
  return {
    detail: `${manifestName} describes ${artifactFile} for the configured HTTPS release host`,
    name: 'update manifest',
    status: 'passed',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function differentialUpdateCheck(artifacts: ArtifactInventory): ReleaseCheck {
  const full = artifacts.names.some(name => name.endsWith('.tar.zst'))
  const patch = artifacts.names.some(name => name.includes('patch') || name.endsWith('.patch'))
  if (full && patch) {
    return {
      detail: 'full and differential update archives are both present',
      name: 'differential update',
      status: 'passed',
    }
  }
  if (!full) {
    return {
      detail: 'no full update archive was produced',
      name: 'differential update',
      remediation: 'Check the Electrobun release configuration for this channel.',
      status: 'failed',
    }
  }
  return {
    // The first release of a channel has nothing to diff against, so this is not a failure.
    detail: 'a full update archive is present; no differential patch was produced',
    name: 'differential update',
    remediation: "Expected for a channel's first release. Otherwise check that generatePatch is enabled.",
    status: 'unverified',
  }
}

function externalGateCheck(
  name: string,
  outcome: boolean | undefined,
  command: string,
): ReleaseCheck {
  if (outcome === undefined) {
    return {
      detail: 'the tool that checks this is not available on this machine',
      name,
      remediation: `Run on a machine with Xcode command line tools: ${command}`,
      status: 'unverified',
    }
  }
  return outcome
    ? { detail: 'verified', name, status: 'passed' }
    : { detail: 'the check did not pass', name, remediation: `Reproduce with: ${command}`, status: 'failed' }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** readPayloadInventory walks a staged payload and reads what it references. */
export async function readPayloadInventory(payloadRoot: string): Promise<PayloadInventory> {
  const files: string[] = []
  const nonPortableReferences: { file: string; reason: string }[] = []
  for await (const path of FS.walk(payloadRoot, { includeHidden: true })) {
    const relativePath = FS.relativePath(payloadRoot, path)
    files.push(relativePath)
    if (!/\.(cjs|js|json|mjs|sh)$/.test(relativePath)) {
      continue
    }
    const contents = await FS.readText(path).catch(() => '')
    for (const { marker, reason } of NON_PORTABLE_MARKERS) {
      if (contents.includes(marker)) {
        nonPortableReferences.push({ file: relativePath, reason })
      }
    }
  }
  return { files: files.sort(), nonPortableReferences }
}

/** readArtifactInventory lists what the build actually left on disk. */
export async function readArtifactInventory(
  artifactsRoot: string,
  releaseBaseUrl?: string,
): Promise<ArtifactInventory> {
  const names: string[] = []
  for await (const path of FS.walk(artifactsRoot)) {
    names.push(FS.relativePath(artifactsRoot, path))
  }
  const manifestName = names.find(name => name.endsWith('-update.json'))
  if (manifestName === undefined) {
    return { names: names.sort(), releaseBaseUrl, root: artifactsRoot }
  }
  try {
    const updateManifest: unknown = JSON.parse(await FS.readText(FS.resolvePath(manifestName, artifactsRoot)))
    return { names: names.sort(), releaseBaseUrl, root: artifactsRoot, updateManifest }
  } catch {
    return {
      names: names.sort(),
      releaseBaseUrl,
      root: artifactsRoot,
      updateManifestError: 'The generated update metadata could not be read as JSON.',
    }
  }
}

/** readExternalGates runs Apple's own validators, reporting undefined when one is unavailable. */
export async function readExternalGates(options: {
  appPath?: string
  diskImagePath?: string
}): Promise<ExternalGateResults> {
  return {
    deepSigned: options.appPath === undefined
      ? undefined
      : await toolOutcome('codesign', ['--verify', '--deep', '--strict', options.appPath]),
    diskImageValid: options.diskImagePath === undefined
      ? undefined
      : await toolOutcome('hdiutil', ['verify', options.diskImagePath]),
    notarized: options.appPath === undefined
      ? undefined
      : await toolOutcome('xcrun', ['stapler', 'validate', options.appPath]),
  }
}

async function toolOutcome(command: string, args: readonly string[]): Promise<boolean | undefined> {
  try {
    const result = await CLI.run(command, { args: [...args] })
    // A missing tool is not a failed check: it is a check that did not happen.
    return result.error !== undefined ? undefined : result.exitCode === 0
  } catch {
    // A host that refuses to spawn the tool at all throws rather than reporting, and that is
    // still a check that did not happen — not a release that failed one.
    return undefined
  }
}

/** formatReleaseValidation renders the release gates as status lines. */
export function formatReleaseValidation(validation: ReleaseValidation): string {
  const lines = validation.checks.map(check => {
    const remediation = check.remediation === undefined ? '' : `\n       ${check.remediation}`
    return `${check.status.toUpperCase().padEnd(11)}${check.name}: ${check.detail}${remediation}`
  })
  lines.push(
    '',
    validation.status === 'failed'
      ? 'release: this build must not be published.'
      : validation.status === 'unverified'
      ? 'release: not publishable from here — the UNVERIFIED gates were never checked. '
        + "Rerun where Apple's tools are available, or pass --allow-unverified to inspect only."
      : 'release: every gate passed.',
  )
  return lines.join('\n')
}
