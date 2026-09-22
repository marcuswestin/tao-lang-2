import { CLI, FS, Platform, Repo } from '@shared'
import type { CheckStatus, DoctorCheck } from '@verification/RepositoryDoctor'
import { doctorReport, readDoctorFacts, worstStatus } from '@verification/RepositoryDoctor'
import { listLaunches } from './StudioLifecycle'
import { StudioNative } from './StudioNative'
import { readWatchFacts, studioWatchChecks, type WatchFacts } from './StudioWatchHealth'

/**
 * Studio's own half of `doctor`. It layers on the repository checks rather than repeating them,
 * because a Studio that will not start is far more often a broken checkout than a broken Studio.
 * Read-only, like the repository half: it names what is wrong and what to run, and changes nothing.
 */

/**
 * Electrobun's signing identity, and the two credential sets it accepts for notarization. Only
 * whether each name is set is ever read; the values belong to the operator and to nothing here.
 *
 * @see https://framework.blackboard.sh/electrobun/guides/code-signing/
 */
const SIGNING_IDENTITY_ENV_VAR = 'ELECTROBUN_DEVELOPER_ID'

const NOTARIZATION_METHODS = [
  {
    name: 'App Store Connect API key',
    vars: ['ELECTROBUN_APPLEAPIKEYPATH', 'ELECTROBUN_APPLEAPIKEY', 'ELECTROBUN_APPLEAPIISSUER'],
  },
  { name: 'Apple ID', vars: ['ELECTROBUN_APPLEID', 'ELECTROBUN_APPLEIDPASS', 'ELECTROBUN_TEAMID'] },
] as const

/** Every signing variable, for reporting which are set without ever reading one's value. */
const SIGNING_ENV_VARS = [
  SIGNING_IDENTITY_ENV_VAR,
  ...NOTARIZATION_METHODS.flatMap(method => method.vars),
] as const

/** The versions the generated Electrobun project pins; a mismatch changes what `dev` produces. */
const PINNED_NATIVE_VERSIONS = {
  cottontail: '0.5.0',
  electrobun: '2.0.2-beta.12',
  hutch: '0.24.3',
} as const

/** Artifacts Studio itself needs beyond the ones every Tao command needs. */
const STUDIO_SOURCES = [
  'Apps/Tao Studio/TaoStudioClient.tao',
  'packages/ides/studio/studio-src/TaoStudioBrowser.tsx',
]

export type StudioDoctorReport = {
  checks: readonly DoctorCheck[]
  repositoryRoot: string
  status: CheckStatus
  version: 1
}

/** LaunchSummary is what the Studio checks need to know about recorded launches. */
type LaunchSummary = {
  foreignPorts: readonly number[]
  live: number
  stale: number
  unusable: readonly string[]
}

/** StudioDoctorFacts is the Studio-specific machine state, gathered once. */
export type StudioDoctorFacts = {
  /** Chrome or Chromium path the smoke lane would use, and how it was found. */
  chrome?: { configured: boolean; path: string }
  /** True when the host cannot register an AppKit application (no window server session). */
  appKitAvailable: boolean
  appKitReason?: string
  cottontailVersion?: string
  electrobunVersion?: string
  hutchPath?: string
  hutchVersion?: string
  launches: LaunchSummary
  /** Ports held by a listener no recorded launch owns. */
  legacyPorts: readonly { pids: readonly number[]; port: number }[]
  missingStudioSources: readonly string[]
  /** Names of the signing variables that are set. Values are never read. */
  signingEnvPresent: readonly string[]
  /** Whether an HTTPS release host is configured, without printing it. */
  releaseHostConfigured: boolean
  /** Diagnostics from the runtime dependency compatibility gate that concern React. */
  reactSingletonIssues: readonly string[]
  repositoryRoot: string
  watch: WatchFacts
}

/** studioDoctorChecks diagnoses Studio from a gathered snapshot, without touching the machine. */
function studioDoctorChecks(facts: StudioDoctorFacts): DoctorCheck[] {
  return [
    reactSingletonCheck(facts),
    studioSourceCheck(facts),
    hutchCheck(facts),
    nativeVersionCheck(facts),
    appKitCheck(facts),
    chromeCheck(facts),
    launchCheck(facts),
    legacyPortCheck(facts),
    ...studioWatchChecks(facts.watch),
    releaseCheck(facts),
  ]
}

function reactSingletonCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.reactSingletonIssues.length === 0) {
    return {
      detail: 'one React resolves into the Studio bundle',
      name: 'studio react singleton',
      status: 'pass',
    }
  }
  return {
    detail: facts.reactSingletonIssues.join(' '),
    name: 'studio react singleton',
    remediation: 'A second React in the bundle renders a blank Studio. Reproduce with: ./agent doctor',
    status: 'fail',
  }
}

function studioSourceCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.missingStudioSources.length === 0) {
    return { detail: 'Studio client sources are present', name: 'studio sources', status: 'pass' }
  }
  return {
    detail: `missing ${facts.missingStudioSources.join(', ')}`,
    name: 'studio sources',
    remediation: 'Restore them from Git; Studio cannot build its browser client without them.',
    status: 'fail',
  }
}

function hutchCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.hutchPath === undefined) {
    return {
      // Browser Studio never needs Hutch, so its absence must not read as broken.
      detail: 'Hutch is not installed, so only browser Studio can run',
      name: 'hutch',
      remediation: 'Optional. Native Studio needs it: curl -fsSL https://hutch.sh/install | sh',
      status: 'warn',
    }
  }
  return {
    detail: `${facts.hutchPath}${facts.hutchVersion === undefined ? '' : ` (${facts.hutchVersion})`}`,
    name: 'hutch',
    status: 'pass',
  }
}

function nativeVersionCheck(facts: StudioDoctorFacts): DoctorCheck {
  const drifted = [
    versionDrift('Hutch CLI', facts.hutchVersion, PINNED_NATIVE_VERSIONS.hutch),
    versionDrift('Cottontail', facts.cottontailVersion, PINNED_NATIVE_VERSIONS.cottontail),
    versionDrift('Electrobun', facts.electrobunVersion, PINNED_NATIVE_VERSIONS.electrobun),
  ].filter((entry): entry is string => entry !== undefined)
  if (drifted.length === 0) {
    return {
      detail: `pinned Hutch ${PINNED_NATIVE_VERSIONS.hutch}, Cottontail ${PINNED_NATIVE_VERSIONS.cottontail}, `
        + `Electrobun ${PINNED_NATIVE_VERSIONS.electrobun}`,
      name: 'native toolchain',
      status: 'pass',
    }
  }
  return {
    detail: drifted.join('; '),
    name: 'native toolchain',
    remediation: 'The generated Electrobun project pins these. Install the pinned versions, or update the pins.',
    status: 'warn',
  }
}

function versionDrift(label: string, installed: string | undefined, pinned: string): string | undefined {
  if (installed === undefined || installed === pinned) {
    return undefined
  }
  return `${label} ${installed} is installed but the generated project pins ${pinned}`
}

/**
 * Whether AppKit registration will actually succeed is not knowable without attempting it: a
 * process inside an agent host's coalition reports an Aqua session and still aborts on launch.
 * So this reports the one thing it can see, and points at the canary as the real test rather
 * than claiming a pass it cannot support.
 */
function appKitCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.appKitAvailable) {
    return {
      detail: 'a window server session is attached; whether AppKit registration succeeds is only '
        + 'known by attempting it',
      name: 'native shell host',
      remediation: 'Prove it with: just studio-canary',
      status: 'warn',
    }
  }
  return {
    detail: facts.appKitReason ?? 'no window server session is attached, so no native application can register',
    name: 'native shell host',
    remediation: 'Run native Studio from a terminal in the logged-in desktop session, or use ./dev studio.',
    status: 'warn',
  }
}

function chromeCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.chrome === undefined) {
    return {
      detail: 'no Chrome or Chromium was found for the browser smoke lane',
      name: 'smoke browser',
      remediation: 'Optional. Set TAO_STUDIO_CHROME_PATH to a Chrome or Chromium executable.',
      status: 'warn',
    }
  }
  const source = facts.chrome.configured ? 'configured' : 'discovered'
  return { detail: `${source} at ${facts.chrome.path}`, name: 'smoke browser', status: 'pass' }
}

function launchCheck(facts: StudioDoctorFacts): DoctorCheck {
  const { live, stale, unusable } = facts.launches
  if (unusable.length > 0) {
    return {
      detail: `${unusable.length} launch manifest(s) cannot be acted on: ${unusable.join('; ')}`,
      name: 'studio launches',
      remediation: 'Inspect them with: ./dev studio-ps --json',
      status: 'warn',
    }
  }
  if (stale > 0) {
    return {
      detail: `${live} live launch(es), ${stale} stale manifest(s)`,
      name: 'studio launches',
      remediation: 'Clear the stale ones with: ./dev studio-stop --all',
      status: 'warn',
    }
  }
  return { detail: `${live} live launch(es), no stale manifests`, name: 'studio launches', status: 'pass' }
}

function legacyPortCheck(facts: StudioDoctorFacts): DoctorCheck {
  if (facts.legacyPorts.length === 0) {
    return { detail: 'no unowned process holds a Studio port', name: 'studio ports', status: 'pass' }
  }
  const described = facts.legacyPorts
    .map(entry => `port ${entry.port} held by pid ${entry.pids.join(' ')}`)
    .join(', ')
  const pids = facts.legacyPorts.flatMap(entry => entry.pids)
  return {
    // Never offered as an automatic stop: no manifest claims these, so nothing proves they are ours.
    detail: `${described}; no launch manifest claims them`,
    name: 'studio ports',
    remediation: `Identify them before stopping anything: ps -o pid=,ppid=,lstart=,command= -p ${pids.join(',')}`,
    status: 'warn',
  }
}

function releaseCheck(facts: StudioDoctorFacts): DoctorCheck {
  const isSet = (name: string) => facts.signingEnvPresent.includes(name)
  const identity = isSet(SIGNING_IDENTITY_ENV_VAR)
  const complete = NOTARIZATION_METHODS.find(method => method.vars.every(isSet))
  const partial = NOTARIZATION_METHODS
    .filter(method => method.vars.some(isSet))
    .map(method => `${method.name} is missing ${method.vars.filter(name => !isSet(name)).join(', ')}`)

  if (!identity && complete === undefined && partial.length === 0) {
    return {
      // Nothing here is configured for release, which is the ordinary state of a dev machine.
      detail: 'no signing identity or notarization credentials are configured',
      name: 'studio release',
      remediation: 'Optional. Only ./dev package-studio-native needs them; see packages/ides/studio/README.md.',
      status: 'warn',
    }
  }
  if (!identity) {
    return {
      detail: `${SIGNING_IDENTITY_ENV_VAR} is not set, so the build cannot be signed at all`,
      name: 'studio release',
      remediation: `Set ${SIGNING_IDENTITY_ENV_VAR} to your Developer ID Application identity.`,
      status: 'warn',
    }
  }
  if (complete === undefined) {
    return {
      detail: partial.length > 0
        ? `signing identity is set; notarization is incomplete: ${partial.join('; ')}`
        : 'signing identity is set, but no notarization credentials are',
      name: 'studio release',
      remediation: 'Set one complete credential set: the App Store Connect API key, or the Apple ID trio.',
      status: 'warn',
    }
  }
  const host = facts.releaseHostConfigured ? 'an HTTPS release host' : 'no release host'
  return {
    // The method is named; no value behind any of these variables is read or printed.
    detail: `signing identity set, notarizing through the ${complete.name}, ${host} configured`,
    name: 'studio release',
    remediation: facts.releaseHostConfigured
      ? undefined
      : 'Set TAO_STUDIO_RELEASE_BASE_URL to the HTTPS host installed copies fetch updates from.',
    status: facts.releaseHostConfigured ? 'pass' : 'warn',
  }
}

/** studioDoctorReport combines the repository checks with Studio's own, worst status winning. */
export async function studioDoctorReport(repositoryRoot = Repo.getRoot()): Promise<StudioDoctorReport> {
  const repository = doctorReport(await readDoctorFacts(repositoryRoot))
  const studio = studioDoctorChecks(await readStudioDoctorFacts(repositoryRoot))
  const checks = [...repository.checks, ...studio]
  return { checks, repositoryRoot, status: worstStatus(checks), version: 1 }
}

/** readStudioDoctorFacts inspects Studio's own prerequisites without changing anything. */
export async function readStudioDoctorFacts(repositoryRoot = Repo.getRoot()): Promise<StudioDoctorFacts> {
  const listing = await listLaunches({ repositoryRoot })
  // Resolved exactly the way StudioNative does, including the installer's own user path, so the
  // doctor cannot report Hutch missing while a launch would find it.
  const hutchPath = await StudioNative.resolveHutchExecutablePath().catch(() => undefined)
  const claimedPorts = new Set(listing.launches.flatMap(row => [...row.ports.owned, ...row.ports.foreign]))
  return {
    appKitAvailable: await hasWindowServerSession(),
    appKitReason: await hasWindowServerSession()
      ? undefined
      : 'no window server session is attached to this process',
    chrome: await findChrome(),
    cottontailVersion: await readToolVersion(hutchPath, ['cottontail', '--version']),
    electrobunVersion: await readToolVersion(hutchPath, ['electrobun', '--version']),
    hutchPath,
    hutchVersion: await readToolVersion(hutchPath, ['--version']),
    launches: {
      foreignPorts: listing.launches.flatMap(row => row.ports.foreign),
      live: listing.launches.filter(row => row.status === 'live').length,
      stale: listing.launches.filter(row => row.status === 'stale').length,
      unusable: listing.launches
        .filter(row => row.status === 'unusable')
        .map(row => `${row.launchId}: ${row.unusableReason ?? 'unknown reason'}`),
    },
    legacyPorts: await readLegacyPorts(claimedPorts),
    missingStudioSources: await missingPaths(repositoryRoot, STUDIO_SOURCES),
    signingEnvPresent: SIGNING_ENV_VARS.filter(
      name => (Platform.runtimeProcess.env[name] ?? '').trim() !== '',
    ),
    reactSingletonIssues: (await readDoctorFacts(repositoryRoot)).dependencyIssues
      .filter(issue => issue.includes('react')),
    releaseHostConfigured: isHttpsUrl(Platform.runtimeProcess.env['TAO_STUDIO_RELEASE_BASE_URL']),
    repositoryRoot,
    watch: await readWatchFacts(repositoryRoot, repositoryRoot),
  }
}

async function missingPaths(repositoryRoot: string, paths: readonly string[]): Promise<string[]> {
  const missing: string[] = []
  for (const path of paths) {
    if (!await FS.isFile(FS.resolvePath(path, repositoryRoot))) {
      missing.push(path)
    }
  }
  return missing
}

/** Mirrors StudioCdp's discovery order so `doctor` reports the browser smoke would actually use. */
async function findChrome(): Promise<{ configured: boolean; path: string } | undefined> {
  const configured = Platform.runtimeProcess.env['TAO_STUDIO_CHROME_PATH']
    ?? Platform.runtimeProcess.env['CHROME_PATH']
  if (configured !== undefined && configured.trim() !== '' && await FS.isFile(configured)) {
    return { configured: true, path: configured }
  }
  for (
    const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
  ) {
    if (await FS.isFile(candidate)) {
      return { configured: false, path: candidate }
    }
  }
  const discovered = await CLI.commandPath('google-chrome') ?? await CLI.commandPath('chromium')
  return discovered === undefined ? undefined : { configured: false, path: discovered }
}

async function readToolVersion(
  executable: string | undefined,
  args: readonly string[],
): Promise<string | undefined> {
  if (executable === undefined) {
    return undefined
  }
  const result = await CLI.run(executable, { args: [...args] })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return /\d+\.\d+\.\d+[\w.-]*/.exec(result.stdout)?.[0]
}

/**
 * A process with no window server session cannot register an AppKit application, which is how
 * native Studio fails inside agent host coalitions and over plain SSH.
 */
async function hasWindowServerSession(): Promise<boolean> {
  const result = await CLI.run('launchctl', { args: ['managername'] })
  if (result.error !== undefined || result.exitCode !== 0) {
    return false
  }
  return result.stdout.trim() === 'Aqua'
}

async function readLegacyPorts(
  claimedPorts: ReadonlySet<number>,
): Promise<{ pids: readonly number[]; port: number }[]> {
  const legacy: { pids: readonly number[]; port: number }[] = []
  for (const port of [8081, 8082]) {
    if (claimedPorts.has(port)) {
      continue
    }
    const result = await CLI.run('lsof', { args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'] })
    const pids = result.stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger)
    if (result.error === undefined && pids.length > 0) {
      legacy.push({ pids, port })
    }
  }
  return legacy
}

function isHttpsUrl(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') {
    return false
  }
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
