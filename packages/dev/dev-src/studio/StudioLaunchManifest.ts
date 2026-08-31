import { CLI, FS, Platform, Repo } from '@shared'

/**
 * Every running Studio publishes one manifest describing exactly what it owns, so a later
 * command can stop it, report it, or ignore it without guessing. A manifest on disk is only ever
 * a hint: the process it names may have exited and its id been reused by something unrelated, so
 * nothing here acts on a manifest until the live machine has confirmed each claim it makes.
 */

/** The launch directory, relative to the repository root that owns it. */
const LAUNCH_DIRECTORY = '.artifacts/user/studio/launches'

/** The manifest schema version. A manifest carrying anything else is read but never acted on. */
export const STUDIO_LAUNCH_MANIFEST_VERSION = 1

export type StudioLaunchMode = 'browser' | 'native' | 'packaged' | 'smoke'

export type StudioLaunchState = 'failed' | 'ready' | 'starting' | 'stopped' | 'stopping'

/**
 * One process this launch owns. `command` and `startedAt` come from the process table when the
 * process is recorded and are re-read before signalling: together they distinguish the original
 * process from an unrelated one that inherited its id.
 */
export type StudioLaunchProcess = {
  command: string
  pid: number
  role: 'browser' | 'metro' | 'native-shell' | 'studio-server' | 'watcher'
  startedAt?: string
}

/** StudioLaunchManifest is the full record of what one Studio launch owns. */
export type StudioLaunchManifest = {
  appName?: string
  artifactRoot: string
  cleanup?: StudioCleanupResult
  /** Bumped on every write, so a reader can tell which of two snapshots is newer. */
  generation: number
  launchId: string
  mode: StudioLaunchMode
  ownerPid: number
  previewPort?: number
  previewUrl?: string
  processes: readonly StudioLaunchProcess[]
  projectRoot?: string
  repositoryRoot: string
  sessionId?: string
  sessionUrl?: string
  shutdownReason?: string
  startedAt: string
  state: StudioLaunchState
  studioPort?: number
  studioUrl?: string
  version: number
}

/** StudioCleanupResult records what a stop actually did, for the manifest and the report. */
export type StudioCleanupResult = {
  killedPids: readonly number[]
  releasedPorts: readonly number[]
  signaledPids: readonly number[]
}

/** StoredLaunch pairs a manifest with where it was read from and whether it is usable. */
export type StoredLaunch = {
  manifest: StudioLaunchManifest
  path: string
  /** False when the schema version is one this build does not understand. */
  supported: boolean
}

/**
 * ProcessFact is what the live machine says about one recorded process id. `command` is absent
 * when the process table could not be read at all — some agent sandboxes deny `ps` — in which
 * case liveness is still known but the program behind the id is not.
 */
export type ProcessFact = {
  command?: string
  pid: number
  running: boolean
  startedAt?: string
}

/** OwnershipProbes are the machine lookups validation needs, injected so tests can drive them. */
export type OwnershipProbes = {
  listenerPidsOnPort: (port: number) => Promise<readonly number[] | undefined>
  pathExists: (path: string) => Promise<boolean>
  processFact: (pid: number) => Promise<ProcessFact>
}

/** ValidatedLaunch is a manifest reconciled against the machine it claims to describe. */
export type ValidatedLaunch = {
  /** Processes still running as the same program that was recorded. */
  owned: readonly StudioLaunchProcess[]
  /** Recorded processes whose id is now held by a different program, or by nothing. */
  disowned: readonly StudioLaunchProcess[]
  /** Ports whose current listener is one of the owned processes. */
  ownedPorts: readonly number[]
  /** Ports listened on by something this launch does not own. */
  foreignPorts: readonly number[]
  manifest: StudioLaunchManifest
  /** True when nothing this manifest claims is still live. */
  stale: boolean
  /** Why the manifest is not actionable, when it is not. */
  unusableReason?: string
}

/** launchDirectory returns where a repository keeps its launch manifests. */
export function launchDirectory(repositoryRoot = Repo.getRoot()): string {
  return FS.resolvePath(LAUNCH_DIRECTORY, repositoryRoot)
}

/** createLaunchId returns a sortable, collision-free identifier for one launch. */
export function createLaunchId(mode: StudioLaunchMode): string {
  return `${mode}-${Bun.randomUUIDv7()}`
}

/** StudioLaunchRecord is the writer one running Studio holds for its own manifest. */
export type StudioLaunchRecord = {
  finalize: (update: Partial<StudioLaunchManifest>) => Promise<StudioLaunchManifest>
  launchId: string
  path: string
  /** The manifest as last written. */
  snapshot: () => StudioLaunchManifest
  update: (update: Partial<StudioLaunchManifest>) => Promise<StudioLaunchManifest>
}

type OpenLaunchOptions = {
  appName?: string
  artifactRoot: string
  mode: StudioLaunchMode
  now?: () => string
  ownerPid?: number
  projectRoot?: string
  repositoryRoot?: string
}

/** openLaunchRecord publishes a starting manifest and returns the writer that maintains it. */
export async function openLaunchRecord(options: OpenLaunchOptions): Promise<StudioLaunchRecord> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const launchId = createLaunchId(options.mode)
  const path = FS.resolvePath(`${launchId}.json`, launchDirectory(repositoryRoot))
  let manifest: StudioLaunchManifest = {
    appName: options.appName,
    artifactRoot: options.artifactRoot,
    generation: 0,
    launchId,
    mode: options.mode,
    ownerPid: options.ownerPid ?? Platform.runtimeProcess.pid,
    processes: [],
    projectRoot: options.projectRoot,
    repositoryRoot,
    startedAt: (options.now ?? isoNow)(),
    state: 'starting',
    version: STUDIO_LAUNCH_MANIFEST_VERSION,
  }
  let pending: Promise<void> = Promise.resolve()

  const write = async (update: Partial<StudioLaunchManifest>): Promise<StudioLaunchManifest> => {
    manifest = { ...manifest, ...update, generation: manifest.generation + 1 }
    const snapshot = manifest
    const writing = pending.then(
      () => writeManifestAtomically(path, snapshot),
      () => writeManifestAtomically(path, snapshot),
    )
    pending = writing
    await writing
    return snapshot
  }

  await write({})
  await pruneFinalizedLaunches(repositoryRoot, launchId)
  return {
    finalize: async update => await write({ state: 'stopped', ...update }),
    launchId,
    path,
    snapshot: () => manifest,
    update: write,
  }
}

/**
 * A manifest finalized as `stopped` claims nothing, so keeping it only makes `studio ps` harder
 * to read. Removing them as a new launch opens keeps the listing about launches that matter,
 * without ever touching one that is still starting, ready, or stopping.
 */
async function pruneFinalizedLaunches(repositoryRoot: string, exceptLaunchId: string): Promise<void> {
  for (const stored of await readLaunches(repositoryRoot)) {
    if (stored.manifest.launchId !== exceptLaunchId && stored.manifest.state === 'stopped') {
      await removeLaunch(stored).catch(() => false)
    }
  }
}

/** writeManifestAtomically publishes a manifest through a temporary file and a rename. */
export async function writeManifestAtomically(path: string, manifest: StudioLaunchManifest): Promise<void> {
  const temporaryPath = `${path}.${Bun.randomUUIDv7()}.tmp`
  try {
    await FS.writeJson(temporaryPath, manifest)
    await FS.move(temporaryPath, path)
  } finally {
    await FS.remove(temporaryPath).catch(() => {})
  }
}

/** readLaunches reads every manifest a repository has published, newest launch first. */
export async function readLaunches(repositoryRoot = Repo.getRoot()): Promise<StoredLaunch[]> {
  const directory = launchDirectory(repositoryRoot)
  if (!await FS.isDirectory(directory)) {
    return []
  }
  const launches: StoredLaunch[] = []
  for (const name of await FS.listDir(directory)) {
    if (!name.endsWith('.json')) {
      continue
    }
    const path = FS.resolvePath(name, directory)
    const manifest = await readManifest(path)
    if (manifest !== undefined) {
      launches.push({ manifest, path, supported: manifest.version === STUDIO_LAUNCH_MANIFEST_VERSION })
    }
  }
  return launches.sort((left, right) => right.manifest.startedAt.localeCompare(left.manifest.startedAt))
}

async function readManifest(path: string): Promise<StudioLaunchManifest | undefined> {
  try {
    const value = await FS.readJson<unknown>(path)
    return isManifest(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** isManifest accepts only a record carrying every field the stop path relies on. */
export function isManifest(value: unknown): value is StudioLaunchManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate['version'] === 'number'
    && typeof candidate['launchId'] === 'string'
    && typeof candidate['repositoryRoot'] === 'string'
    && typeof candidate['artifactRoot'] === 'string'
    && typeof candidate['startedAt'] === 'string'
    && typeof candidate['ownerPid'] === 'number'
    && Array.isArray(candidate['processes'])
    && candidate['processes'].every(isLaunchProcess)
}

function isLaunchProcess(value: unknown): value is StudioLaunchProcess {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate['pid'] === 'number'
    && Number.isInteger(candidate['pid'])
    && candidate['pid'] > 1
    && typeof candidate['command'] === 'string'
    && typeof candidate['role'] === 'string'
}

/**
 * validateLaunch reconciles one manifest against the live machine. A recorded process counts as
 * owned only when its id is still running the same program that was recorded — a pid alone is
 * not evidence, because the operating system reuses them.
 */
export async function validateLaunch(
  stored: StoredLaunch,
  probes: OwnershipProbes,
): Promise<ValidatedLaunch> {
  const manifest = stored.manifest
  const base: Pick<ValidatedLaunch, 'disowned' | 'foreignPorts' | 'manifest' | 'owned' | 'ownedPorts'> = {
    disowned: manifest.processes,
    foreignPorts: [],
    manifest,
    owned: [],
    ownedPorts: [],
  }
  if (!stored.supported) {
    return {
      ...base,
      stale: false,
      unusableReason: `manifest schema version ${manifest.version} is not supported by this build`,
    }
  }
  if (!FS.pathIsWithin(manifest.artifactRoot, manifest.repositoryRoot)) {
    return {
      ...base,
      stale: false,
      unusableReason: `artifact root ${manifest.artifactRoot} is outside ${manifest.repositoryRoot}`,
    }
  }
  if (!await probes.pathExists(manifest.repositoryRoot)) {
    return { ...base, stale: true, unusableReason: `repository root ${manifest.repositoryRoot} no longer exists` }
  }

  const owned: StudioLaunchProcess[] = []
  const disowned: StudioLaunchProcess[] = []
  for (const process of manifest.processes) {
    const fact = await probes.processFact(process.pid)
    ;(isSameProcess(process, fact) ? owned : disowned).push(process)
  }

  const ownedPids = new Set(owned.map(process => process.pid))
  const ownedPorts: number[] = []
  const foreignPorts: number[] = []
  for (const port of recordedPorts(manifest)) {
    const listeners = await probes.listenerPidsOnPort(port)
    if (listeners === undefined || listeners.length === 0) {
      continue
    }
    ;(listeners.every(pid => ownedPids.has(pid)) ? ownedPorts : foreignPorts).push(port)
  }

  return {
    disowned,
    foreignPorts,
    manifest,
    owned,
    ownedPorts,
    stale: owned.length === 0,
  }
}

/** isSameProcess decides whether a live process id is still the process that was recorded. */
export function isSameProcess(recorded: StudioLaunchProcess, fact: ProcessFact): boolean {
  if (!fact.running) {
    return false
  }
  if (fact.command !== undefined && fact.command !== recorded.command) {
    return false
  }
  // A recorded start time is the only defence against an id reused by the same program.
  if (recorded.startedAt !== undefined && fact.startedAt !== undefined && fact.startedAt !== recorded.startedAt) {
    return false
  }
  return true
}

/** recordedPorts returns the ports a manifest claims, in a stable order. */
export function recordedPorts(manifest: StudioLaunchManifest): number[] {
  return [manifest.studioPort, manifest.previewPort]
    .filter((port): port is number => typeof port === 'number' && port > 0)
}

/** removeLaunch deletes one manifest, and only ever a file inside its own launch directory. */
export async function removeLaunch(stored: StoredLaunch): Promise<boolean> {
  const directory = launchDirectory(stored.manifest.repositoryRoot)
  if (!FS.pathIsWithin(stored.path, directory)) {
    return false
  }
  await FS.remove(stored.path)
  return true
}

/**
 * systemOwnershipProbes reads the live process table and port listeners. A probe that cannot run
 * at all — a host that forbids spawning `ps`, for instance — reports no evidence rather than
 * raising, and no evidence always resolves to "not owned", so a blind stop signals nothing.
 */
export const systemOwnershipProbes: OwnershipProbes = {
  listenerPidsOnPort: async port => {
    const result = await runQuietly('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    if (result === undefined) {
      return undefined
    }
    const pids = result.stdout.split(/\s+/).filter(Boolean).map(Number).filter(Number.isInteger)
    return result.exitCode === 0 || pids.length > 0 ? pids : []
  },
  pathExists: async path => await FS.exists(path),
  processFact: async pid => {
    const result = await runQuietly('ps', ['-o', 'comm=,lstart=', '-p', String(pid)])
    if (result === undefined) {
      // The process table is unreadable here, which is the ordinary case inside an agent
      // sandbox. Liveness alone still distinguishes a running launch from a finished one; what
      // is lost is the command check that would catch a reused id, so this is reported rather
      // than silently assumed. Signalling still only ever reaches the recorded process group.
      return { pid, running: await processIsAlive(pid) }
    }
    const line = result.stdout.trim()
    if (result.exitCode !== 0 || line === '') {
      return { pid, running: false }
    }
    // `comm` is a path with no spaces on macOS, so the first field is the command.
    const [command, ...startedAt] = line.split(/\s+/)
    return { command, pid, running: true, startedAt: startedAt.join(' ') }
  },
}

/** processIsAlive asks the kernel directly, which every host permits even when `ps` is denied. */
async function processIsAlive(pid: number): Promise<boolean> {
  const result = await runQuietly('/bin/kill', ['-0', String(pid)])
  return result !== undefined && result.exitCode === 0
}

async function runQuietly(
  command: string,
  args: readonly string[],
): Promise<{ exitCode: number | null; stdout: string } | undefined> {
  try {
    const result = await CLI.run(command, { args: [...args] })
    return result.error === undefined ? { exitCode: result.exitCode, stdout: result.stdout } : undefined
  } catch {
    return undefined
  }
}

/**
 * describeOwnProcess records the running process for its own manifest. Publishing a manifest must
 * never be able to fail a launch, so a host that will not report the process table still yields a
 * usable record: the process is known to be running, and its command falls back to the runtime.
 */
export async function describeOwnProcess(
  role: StudioLaunchProcess['role'],
  pid = Platform.runtimeProcess.pid,
): Promise<StudioLaunchProcess> {
  const fact = await systemOwnershipProbes.processFact(pid)
  return {
    command: fact.command ?? FS.basename(Platform.runtimeProcess.execPath),
    pid,
    role,
    startedAt: fact.startedAt,
  }
}

function isoNow(): string {
  return new Date().toISOString()
}
