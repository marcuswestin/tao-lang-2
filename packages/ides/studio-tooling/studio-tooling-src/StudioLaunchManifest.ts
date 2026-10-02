import { CLI, FS, HCI, Platform, Repo } from '@shared'

/**
 * Every running Studio publishes one manifest describing exactly what it owns, so a later
 * command can stop it, report it, or ignore it without guessing. A manifest on disk is only ever
 * a hint: the process it names may have exited and its id been reused by something unrelated, so
 * nothing here acts on a manifest until the live machine has confirmed each claim it makes.
 */

/** The launch directory, relative to the repository root that owns it. */
const LAUNCH_DIRECTORY = '.artifacts/user/studio/launches'

/** The manifest schema version. A manifest carrying anything else is read but never acted on. */
const STUDIO_LAUNCH_MANIFEST_VERSION = 1

type StudioLaunchMode = 'browser' | 'native' | 'packaged' | 'smoke'

type StudioLaunchState = 'failed' | 'ready' | 'starting' | 'stopped' | 'stopping'

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
 * ProcessEvidence separates the three answers a host can give about a process id. Collapsing
 * `unknown` into `gone` is what makes a stop delete the record of a launch that is still running;
 * collapsing it into `alive` is what makes a stop signal a stranger. Both have happened here.
 */
type ProcessEvidence = 'alive' | 'gone' | 'unknown'

/**
 * ProcessFact is what the live machine says about one recorded process id. `command` and
 * `startedAt` are absent when the process table could not be read — agent sandboxes commonly deny
 * `ps` — so identity can be unavailable even when liveness is not.
 */
export type ProcessFact = {
  command?: string
  evidence: ProcessEvidence
  pid: number
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
  /** Recorded processes this host would not answer about. Never owned, and never signalled. */
  undetermined: readonly StudioLaunchProcess[]
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

/** createLaunchId returns a collision-free identifier for one launch. */
function createLaunchId(mode: StudioLaunchMode): string {
  return `${mode}-${Platform.randomUUID()}`
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
  launchRecordsRoot?: string
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
  const directory = options.launchRecordsRoot ?? launchDirectory(repositoryRoot)
  const path = FS.resolvePath(`${launchId}.json`, directory)
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
    // Publishing a manifest is a convenience for later commands, never a precondition for the
    // launch itself: an unwritable artifact root must not turn a working Studio into an exit 1.
    const publish = () =>
      writeManifestAtomically(path, snapshot).catch(error => {
        HCI.logProcessWarn('studio', `Could not write the launch manifest: ${(error as Error).message}`)
      })
    const writing = pending.then(publish, publish)
    pending = writing
    await writing
    return snapshot
  }

  await write({})
  await pruneFinalizedLaunches(repositoryRoot, launchId, directory)
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
async function pruneFinalizedLaunches(repositoryRoot: string, exceptLaunchId: string, directory: string): Promise<void> {
  for (const stored of await readLaunches(repositoryRoot, directory)) {
    if (stored.manifest.launchId !== exceptLaunchId && stored.manifest.state === 'stopped') {
      await FS.remove(stored.path).catch(() => {})
    }
  }
}

/** writeManifestAtomically publishes a manifest through a temporary file and a rename. */
export async function writeManifestAtomically(path: string, manifest: StudioLaunchManifest): Promise<void> {
  const temporaryPath = `${path}.${Platform.randomUUID()}.tmp`
  try {
    await FS.writeJson(temporaryPath, manifest)
    await FS.move(temporaryPath, path)
  } finally {
    await FS.remove(temporaryPath).catch(() => {})
  }
}

/** readLaunches reads every manifest a repository has published, newest launch first. */
export async function readLaunches(
  repositoryRoot = Repo.getRoot(),
  directory = launchDirectory(repositoryRoot),
): Promise<StoredLaunch[]> {
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
  const base = {
    disowned: manifest.processes,
    foreignPorts: [],
    manifest,
    owned: [],
    ownedPorts: [],
    undetermined: [],
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

  // Ports are read first: a listener on a port this manifest itself recorded is the one piece of
  // identity evidence available on a host that will not describe its own process table.
  const listenersByPort = new Map<number, readonly number[] | undefined>()
  for (const port of recordedPorts(manifest)) {
    listenersByPort.set(port, await probes.listenerPidsOnPort(port))
  }
  const listeningPids = new Set(
    [...listenersByPort.values()].flatMap(pids => pids === undefined ? [] : [...pids]),
  )

  const owned: StudioLaunchProcess[] = []
  const disowned: StudioLaunchProcess[] = []
  const undetermined: StudioLaunchProcess[] = []
  for (const process of manifest.processes) {
    const fact = await probes.processFact(process.pid)
    if (isSameProcess(process, fact) || (fact.evidence === 'alive' && listeningPids.has(process.pid))) {
      owned.push(process)
    } else if (fact.evidence === 'unknown') {
      undetermined.push(process)
    } else {
      disowned.push(process)
    }
  }

  const ownedPids = new Set(owned.map(process => process.pid))
  const ownedPorts: number[] = []
  const foreignPorts: number[] = []
  for (const [port, listeners] of listenersByPort) {
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
    // Nothing is claimed and nothing is uncertain: only then is a manifest genuinely spent.
    stale: owned.length === 0 && undetermined.length === 0 && foreignPorts.length === 0,
    undetermined,
  }
}

/**
 * isSameProcess decides whether a live id is still the process that was recorded, from the process
 * table alone. It requires positive identity rather than mere liveness: ids are reused, and the
 * only question worth answering is "is this still ours", never "is something there".
 *
 * Commands are compared by basename because the two sides disagree by host: `ps -o comm=` reports
 * an absolute path, while a process describing itself falls back to its executable's basename.
 */
export function isSameProcess(recorded: StudioLaunchProcess, fact: ProcessFact): boolean {
  if (fact.evidence !== 'alive') {
    return false
  }
  if (fact.command !== undefined && !sameCommand(fact.command, recorded.command)) {
    return false
  }
  if (recorded.startedAt !== undefined && fact.startedAt !== undefined && fact.startedAt !== recorded.startedAt) {
    return false
  }
  // Alive with nothing to compare against is not identity; only a recorded port can corroborate it.
  return fact.command !== undefined || (recorded.startedAt !== undefined && fact.startedAt !== undefined)
}

/** sameCommand compares command strings by basename, so `/opt/bin/bun` matches `bun`. */
function sameCommand(left: string, right: string): boolean {
  return FS.basename(left) === FS.basename(right)
}

/** recordedPorts returns the ports a manifest claims, in a stable order. */
function recordedPorts(manifest: StudioLaunchManifest): number[] {
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
    const listed = await runQuietly('ps', ['-o', 'comm=,lstart=', '-p', String(pid)])
    if (listed !== undefined) {
      const line = listed.stdout.trim()
      if (listed.exitCode === 0 && line !== '') {
        // `comm` may be an absolute path containing spaces, and `lstart` is a fixed five fields,
        // so the command is everything before them rather than the first whitespace-run.
        const fields = line.split(/\s+/)
        const startedAt = fields.slice(-5).join(' ')
        return { command: line.slice(0, line.length - startedAt.length).trim(), evidence: 'alive', pid, startedAt }
      }
      // `ps` ran and reported nothing for this id, which is a real answer.
      return { evidence: 'gone', pid }
    }
    return { evidence: await processEvidenceFromSignal(pid), pid }
  },
}

/**
 * When the process table is unreadable, the kernel is asked directly — but only to separate
 * "gone" from "there, and not mine to describe". A host that denies signalling answers neither,
 * and `unknown` is carried forward rather than guessed at in either direction.
 */
async function processEvidenceFromSignal(pid: number): Promise<ProcessEvidence> {
  const result = await runQuietly('/bin/kill', ['-0', String(pid)])
  if (result === undefined) {
    return 'unknown'
  }
  if (result.exitCode === 0) {
    return 'alive'
  }
  return /no such process/i.test(result.stderr) ? 'gone' : 'unknown'
}

async function runQuietly(
  command: string,
  args: readonly string[],
): Promise<{ exitCode: number | null; stderr: string; stdout: string } | undefined> {
  try {
    const result = await CLI.run(command, { args: [...args] })
    return result.error === undefined
      ? { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout }
      : undefined
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
    // Recorded as a basename either way, because that is the only form both hosts agree on.
    command: FS.basename(fact.command ?? Platform.runtimeProcess.execPath),
    pid,
    role,
    startedAt: fact.startedAt,
  }
}

function isoNow(): string {
  return new Date().toISOString()
}
