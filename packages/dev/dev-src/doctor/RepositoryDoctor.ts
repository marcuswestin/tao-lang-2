import { CLI, FS, Platform, Repo, Switch } from '@shared'
import { ProcessListeners } from '../ProcessListeners'
import {
  dependencyCompatibilityIssues,
  readDependencyFacts,
} from '../repository-tests/DependencyCompatibility'
import { type LaneRecord, MachineLanes } from '../repository-tests/MachineLanes'
import { dependencyHealthError } from './DependencyHealth'
import {
  type EnvironmentFingerprint,
  environmentFingerprint,
  readFingerprintFacts,
} from './EnvironmentFingerprint'

/**
 * The repository half of `doctor`: everything a checkout needs before any Tao command can work.
 * It never installs, never mutates the checkout, and never signals a process, so running it can
 * only ever tell you something. It does *run* processes to ask them about themselves — `git`,
 * `bun`, `node`, `watchman`, `direnv`, `du`, `lsof` — including a Node require of the Expo config
 * to prove the dependency graph resolves. `StudioDoctor` layers Studio's own checks on top.
 */

/** The Node major devenv.nix pins, and the Bun the lockfile and workflow scripts assume. */
const SUPPORTED_NODE_MAJOR = 24
const SUPPORTED_BUN_RANGE = '>=1.3.0'

/** Ports Tao conventionally occupies, so an occupied one is reported with its owner. */
const CONVENTIONAL_PORTS = [
  { port: 8081, purpose: 'Expo Metro' },
  { port: 9020, purpose: 'local InstantDB' },
  { port: 3000, purpose: 'local InstantDB dashboard' },
] as const

/** Where Langium's generator is configured, and the modules every language command imports. */
const LANGIUM_CONFIG = 'packages/parser/langium-config.json'
const GENERATED_PARSER_MODULES = ['ast.ts', 'grammar.ts', 'module.ts']

/** Commands this repository actually starts on its conventional ports. */
const TAO_PROCESS_COMMANDS = new Set(['bun', 'node', 'hutch', 'watchman'])

/** Scratch trees whose size is worth reporting, because a failed install can leave gigabytes. */
const ARTIFACT_ROOTS = ['.artifacts/tmp', '.artifacts/cache', '.artifacts/build', '.artifacts/logs']

export type CheckStatus = 'pass' | 'warn' | 'fail'

/** DoctorCheck is one diagnosis: what was looked at, what was found, and what to do about it. */
export type DoctorCheck = {
  detail: string
  name: string
  remediation?: string
  status: CheckStatus
}

/**
 * DoctorReport is the versioned structured result `--json` prints. `fingerprint` is the subset a
 * person can paste into a report; the rest of the report names this machine and this checkout, so
 * it stays here rather than travelling. The envelope version only moves when a field changes
 * meaning: adding one, as `fingerprint` did, leaves every existing reader correct.
 */
export type DoctorReport = {
  checks: readonly DoctorCheck[]
  fingerprint: EnvironmentFingerprint
  repositoryRoot: string
  status: CheckStatus
  version: 1
}

/** PortOccupancy records what, if anything, holds one conventional port. */
type PortOccupancy = {
  listeners?: readonly { command: string; pid: number }[]
  port: number
  purpose: string
}

/** MachineState records what else is running on this machine, which no single checkout can see. */
type MachineState = {
  cpuCount: number
  /** Registration that encloses this doctor process, excluded without hiding sibling local lanes. */
  currentLaneId?: string
  /** One-minute run-queue length, which counts work no Tao lane registered. */
  loadAverage: number
  /** Registered Tao lanes, including any this checkout is running. */
  lanes: readonly LaneRecord[]
  /** False when the shared registry exists but the host refused to list it. */
  registryAvailable?: boolean
}

/** ArtifactRoot records one scratch tree's writability and size. */
type ArtifactRoot = {
  path: string
  present: boolean
  sizeBytes?: number
  writable: boolean
}

/** DoctorFacts is the machine state the checks read, gathered once so the checks stay pure. */
export type DoctorFacts = {
  artifactRoots: readonly ArtifactRoot[]
  /** The pasteable half: which OS, which Tao, which toolchain, and nothing that identifies anybody. */
  fingerprint: EnvironmentFingerprint
  /** The checked-out branch, or undefined on a detached HEAD. */
  branch?: string
  bunTempDir?: { path: string; writable: boolean }
  bunVersion?: string
  /** Diagnostics from the runtime dependency compatibility gate. */
  dependencyIssues: readonly string[]
  dependencyHealthError?: string
  devenvProfileNode?: string
  direnvAllowed?: boolean
  generatedParserArtifacts: readonly { path: string; present: boolean }[]
  linkedWorktree: boolean
  lockfilePresent: boolean
  machine: MachineState
  nodeModulesPresent: boolean
  nodeVersion?: string
  ports: readonly PortOccupancy[]
  repositoryRoot: string
  satisfies: (version: string, range: string) => boolean
  watchmanVersion?: string
  watchmanHealthy?: boolean
}

/** repositoryDoctorChecks diagnoses a checkout from a gathered snapshot of its state. */
export function repositoryDoctorChecks(facts: DoctorFacts): DoctorCheck[] {
  return [
    worktreeCheck(facts),
    devenvProfileCheck(facts),
    direnvCheck(facts),
    nodeCheck(facts),
    bunCheck(facts),
    bunTempDirCheck(facts),
    dependencyInstallationCheck(facts),
    dependencyCompatibilityCheck(facts),
    watchmanCheck(facts),
    machineLanesCheck(facts),
    parserArtifactCheck(facts),
    ...artifactRootChecks(facts),
    ...portChecks(facts),
  ]
}

/** doctorReport wraps the checks in the versioned envelope, with the worst status winning. */
export function doctorReport(facts: DoctorFacts): DoctorReport {
  const checks = repositoryDoctorChecks(facts)
  return {
    checks,
    fingerprint: facts.fingerprint,
    repositoryRoot: facts.repositoryRoot,
    status: worstStatus(checks),
    version: 1,
  }
}

/** worstStatus reduces a run to the single status a caller should exit on. */
export function worstStatus(checks: readonly DoctorCheck[]): CheckStatus {
  if (checks.some(check => check.status === 'fail')) {
    return 'fail'
  }
  return checks.some(check => check.status === 'warn') ? 'warn' : 'pass'
}

/** formatCheck renders one check as the PASS/WARN/FAIL line the terminal shows. */
export function formatCheck(check: DoctorCheck): string {
  const label = Switch<CheckStatus, string>(check.status, {
    fail: () => 'FAIL',
    pass: () => 'PASS',
    warn: () => 'WARN',
  })
  const remediation = check.remediation === undefined ? '' : `\n       ${check.remediation}`
  return `${label.padEnd(4)}  ${check.name}: ${check.detail}${remediation}`
}

function worktreeCheck(facts: DoctorFacts): DoctorCheck {
  const kind = facts.linkedWorktree ? 'linked worktree' : 'primary checkout'
  if (facts.branch === undefined) {
    return {
      detail: `${facts.repositoryRoot} (${kind}) is on a detached HEAD`,
      name: 'worktree',
      remediation: 'Name a branch before committing: git switch -c feat/<name>',
      status: 'warn',
    }
  }
  return {
    detail: `${facts.repositoryRoot} (${kind}) on ${facts.branch}`,
    name: 'worktree',
    status: 'pass',
  }
}

function devenvProfileCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.devenvProfileNode !== undefined) {
    return { detail: `pinned profile Node at ${facts.devenvProfileNode}`, name: 'devenv profile', status: 'pass' }
  }
  return {
    detail: 'no pinned devenv profile is linked into this checkout',
    name: 'devenv profile',
    remediation: 'Create the worktree with Worktrunk, or run: direnv allow && direnv exec . ./agent setup',
    status: 'fail',
  }
}

function direnvCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.direnvAllowed === undefined) {
    return {
      detail: 'direnv is not installed, so .envrc trust could not be read',
      name: 'direnv',
      remediation: 'Optional. Install direnv to activate the pinned environment automatically.',
      status: 'warn',
    }
  }
  if (facts.direnvAllowed) {
    return { detail: '.envrc is trusted', name: 'direnv', status: 'pass' }
  }
  // A linked worktree reuses the primary checkout's profile, so untrusted direnv is survivable.
  return {
    detail: "this checkout's .envrc is not trusted",
    name: 'direnv',
    remediation: 'Trust it with: direnv allow',
    status: 'warn',
  }
}

function nodeCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.nodeVersion === undefined) {
    return {
      detail: 'no Node runtime is reachable',
      name: 'node',
      remediation: 'Run Tao commands through ./agent or ./dev, which activate the pinned profile.',
      status: 'fail',
    }
  }
  const major = Number(facts.nodeVersion.replace(/^v/, '').split('.')[0])
  if (major === SUPPORTED_NODE_MAJOR) {
    return { detail: `${facts.nodeVersion}`, name: 'node', status: 'pass' }
  }
  return {
    detail: `${facts.nodeVersion}, but devenv.nix pins Node ${SUPPORTED_NODE_MAJOR}`,
    name: 'node',
    remediation: 'Run Tao commands through ./agent or ./dev so the pinned profile is used.',
    status: 'warn',
  }
}

function bunCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.bunVersion === undefined) {
    return {
      detail: 'no Bun runtime is reachable',
      name: 'bun',
      remediation: 'Install Bun through the pinned devenv profile: direnv allow && direnv exec . ./agent setup',
      status: 'fail',
    }
  }
  if (facts.satisfies(facts.bunVersion, SUPPORTED_BUN_RANGE)) {
    return { detail: facts.bunVersion, name: 'bun', status: 'pass' }
  }
  return {
    detail: `${facts.bunVersion}, outside the supported ${SUPPORTED_BUN_RANGE}`,
    name: 'bun',
    remediation: 'Run Tao commands through ./agent or ./dev so the pinned profile is used.',
    status: 'fail',
  }
}

function bunTempDirCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.bunTempDir === undefined) {
    return {
      detail: 'no writable temporary directory was found for Bun',
      name: 'bun temp dir',
      remediation: 'Reclaim scratch and retry: just clean-scratch',
      status: 'fail',
    }
  }
  if (facts.bunTempDir.writable) {
    return { detail: facts.bunTempDir.path, name: 'bun temp dir', status: 'pass' }
  }
  return {
    detail: `${facts.bunTempDir.path} rejects the writes Bun's installer performs`,
    name: 'bun temp dir',
    remediation: 'Reclaim scratch and retry: just clean-scratch',
    status: 'fail',
  }
}

function dependencyInstallationCheck(facts: DoctorFacts): DoctorCheck {
  if (!facts.lockfilePresent) {
    return {
      detail: 'bun.lock is missing',
      name: 'dependencies',
      remediation: 'Restore it from Git, then run: ./agent setup',
      status: 'fail',
    }
  }
  if (!facts.nodeModulesPresent) {
    return {
      detail: 'node_modules is missing',
      name: 'dependencies',
      remediation: 'Install with: ./agent setup',
      status: 'fail',
    }
  }
  if (facts.dependencyHealthError !== undefined) {
    return {
      detail: `the installed dependency graph is incomplete: ${facts.dependencyHealthError}`,
      name: 'dependencies',
      remediation:
        "Repair with: ./agent setup; if the sandbox denies a protected package path, run it from 'just session-unsandboxed'.",
      status: 'fail',
    }
  }
  return { detail: 'installed and complete against the frozen lockfile', name: 'dependencies', status: 'pass' }
}

function dependencyCompatibilityCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.dependencyIssues.length === 0) {
    return {
      detail: 'runtime versions agree with the installed Expo SDK',
      name: 'dependency compatibility',
      status: 'pass',
    }
  }
  return {
    detail: facts.dependencyIssues.join(' '),
    name: 'dependency compatibility',
    remediation: 'Reproduce with: bun run packages/dev/dev-src/repository-tests/DependencyCompatibility.ts',
    status: 'fail',
  }
}

function watchmanCheck(facts: DoctorFacts): DoctorCheck {
  if (facts.watchmanVersion === undefined) {
    return {
      // Metro then watches through the OS directly, which this repository exceeds: the
      // preview process dies with EMFILE partway through its first bundle.
      detail: 'watchman is not answering; Metro will watch through the OS and can fail with EMFILE',
      name: 'watchman',
      remediation: 'It ships in the pinned devenv profile: direnv exec . watchman version',
      status: 'warn',
    }
  }
  if (facts.watchmanHealthy === false) {
    return {
      // Same consequence as a missing Watchman: Metro falls back and this repository trips EMFILE.
      detail: `watchman ${facts.watchmanVersion} is installed but not answering; `
        + 'Metro will watch through the OS and can fail with EMFILE',
      name: 'watchman',
      remediation: 'Restart it with: watchman shutdown-server',
      status: 'warn',
    }
  }
  return { detail: facts.watchmanVersion, name: 'watchman', status: 'pass' }
}

/**
 * What every other check cannot see: this machine belongs to every worktree on it. A second agent
 * running `verify` next door is the ordinary explanation for a slow lane or a timed-out test, and
 * naming it here is what stops the next hour going into a regression that is not there.
 */
function machineLanesCheck(facts: DoctorFacts): DoctorCheck {
  const { cpuCount, currentLaneId, lanes, loadAverage } = facts.machine
  const peerLanes = currentLaneId === undefined ? lanes : lanes.filter(lane => lane.id !== currentLaneId)
  const load = `load ${loadAverage.toFixed(1)} on ${cpuCount} CPUs`
  if (facts.machine.registryAvailable === false) {
    return {
      detail: `the machine-lane registry could not be inspected (${load})`,
      name: 'machine lanes',
      remediation: 'Check the permissions of the per-user Tao cache before trusting parallel lane diagnostics.',
      status: 'warn',
    }
  }
  const elsewhere = peerLanes.filter(lane => lane.repositoryRoot !== facts.repositoryRoot)
  const local = peerLanes.filter(lane => lane.repositoryRoot === facts.repositoryRoot)
  if (peerLanes.length === 0 && loadAverage <= cpuCount * MachineLanes.CONTENDED_LOAD_RATIO) {
    return { detail: `this checkout has the machine to itself (${load})`, name: 'machine lanes', status: 'pass' }
  }
  // Another worktree's root is named absolutely: relative to this one it is a chain of `..` that
  // says nothing about which checkout is meant.
  const others = [
    ...local.map(lane => `${lane.lane} in this checkout`),
    ...elsewhere.map(lane => `${lane.lane} in ${lane.repositoryRoot}`),
  ].join(', ')
  return {
    detail: peerLanes.length === 0
      ? `no other Tao lane is registered, but this machine is already busy (${load})`
      : `${peerLanes.length} Tao lane${peerLanes.length === 1 ? '' : 's'} running (${load}): ${others}`,
    name: 'machine lanes',
    remediation:
      'Lanes share the machine automatically, so this is expected while other Tao work runs. Timing-sensitive '
      + 'suites are slower and can time out; re-run a timed-out suite on its own before treating it as a regression.',
    status: 'warn',
  }
}

function parserArtifactCheck(facts: DoctorFacts): DoctorCheck {
  const missing = facts.generatedParserArtifacts.filter(artifact => !artifact.present)
  if (missing.length === 0) {
    return { detail: 'generated parser artifacts are present', name: 'parser artifacts', status: 'pass' }
  }
  return {
    detail: `missing ${missing.map(artifact => artifact.path).join(', ')}`,
    name: 'parser artifacts',
    remediation: 'Generate them with: ./agent check',
    status: 'fail',
  }
}

function artifactRootChecks(facts: DoctorFacts): DoctorCheck[] {
  return facts.artifactRoots.map(root => {
    if (!root.present) {
      return { detail: `${root.path} does not exist yet`, name: 'artifacts', status: 'pass' as const }
    }
    if (!root.writable) {
      return {
        detail: `${root.path} is not writable`,
        name: 'artifacts',
        remediation: 'Tao writes every intermediate here. Restore write access to the worktree.',
        status: 'fail' as const,
      }
    }
    return { detail: `${root.path} ${formatBytes(root.sizeBytes)}`, name: 'artifacts', status: 'pass' as const }
  })
}

function portChecks(facts: DoctorFacts): DoctorCheck[] {
  return facts.ports.map(occupancy => {
    if (occupancy.listeners === undefined) {
      return {
        detail: `port ${occupancy.port} (${occupancy.purpose}) could not be inspected`,
        name: 'ports',
        remediation: 'Optional. Install lsof to report which process holds a port.',
        status: 'warn' as const,
      }
    }
    if (occupancy.listeners.length === 0) {
      return { detail: `port ${occupancy.port} (${occupancy.purpose}) is free`, name: 'ports', status: 'pass' as const }
    }
    const owners = occupancy.listeners.map(listener => `${listener.command} pid ${listener.pid}`).join(', ')
    const pids = occupancy.listeners.map(listener => listener.pid)
    // A kill command is only offered for a process this repository recognises as its own. The
    // holder of a conventional port is often somebody else's, and a read-only diagnosis has no
    // business handing out a command that would terminate it.
    const ours = occupancy.listeners.every(listener => TAO_PROCESS_COMMANDS.has(listener.command))
    return {
      detail: `port ${occupancy.port} (${occupancy.purpose}) is held by ${owners}`,
      name: 'ports',
      // A Tao process on a conventional port is as likely to belong to a sibling worktree as to
      // this one, and killing another agent's dev server is the worst outcome available here.
      remediation: ours
        ? `It may belong to another worktree on this machine. Confirm before stopping it: ps -o pid=,ppid=,lstart=,command= -p ${
          pids.join(',')
        }  # then, if it is yours: kill -TERM ${pids.join(' ')}`
        : `Identify it before stopping anything: ps -o pid=,ppid=,lstart=,command= -p ${pids.join(',')}`,
      status: 'warn' as const,
    }
  })
}

function formatBytes(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) {
    return 'size unknown'
  }
  return `holds ${(sizeBytes / 1_000_000).toFixed(1)} MB`
}

/** readDoctorFacts inspects the machine without changing it. */
export async function readDoctorFacts(
  repositoryRoot = Repo.getRoot(),
  options: { machineRegistryRoot?: string } = {},
): Promise<DoctorFacts> {
  const [
    branch,
    linkedWorktree,
    bunVersion,
    nodeVersion,
    watchman,
    direnvAllowed,
    artifactRoots,
    ports,
    dependencyIssues,
    fingerprintFacts,
  ] = await Promise.all([
    readBranch(repositoryRoot),
    readLinkedWorktree(repositoryRoot),
    readCommandVersion('bun', ['--version']),
    readCommandVersion('node', ['--version']),
    readWatchman(),
    readDirenvAllowed(repositoryRoot),
    Promise.all(ARTIFACT_ROOTS.map(path => readArtifactRoot(repositoryRoot, path))),
    Promise.all(CONVENTIONAL_PORTS.map(readPortOccupancy)),
    readDependencyIssues(),
    readFingerprintFacts(repositoryRoot),
  ])
  const [canonicalRepositoryRoot, laneInspection] = await Promise.all([
    canonicalPath(repositoryRoot),
    MachineLanes.inspectLanes(options.machineRegistryRoot, { prune: false }),
  ])
  const canonicalLanes = await Promise.all(laneInspection.lanes.map(async lane => ({
    ...lane,
    repositoryRoot: await canonicalPath(lane.repositoryRoot),
  })))

  return {
    artifactRoots,
    branch,
    bunTempDir: await readBunTempDir(repositoryRoot),
    bunVersion,
    dependencyHealthError: await dependencyHealthError(repositoryRoot),
    dependencyIssues,
    devenvProfileNode: await presentPath(repositoryRoot, '.devenv/profile/bin/node'),
    direnvAllowed,
    fingerprint: environmentFingerprint(fingerprintFacts),
    generatedParserArtifacts: await readGeneratedParserArtifacts(repositoryRoot),
    linkedWorktree,
    lockfilePresent: await FS.isFile(FS.resolvePath('bun.lock', repositoryRoot)),
    machine: {
      cpuCount: Platform.cpuCount(),
      currentLaneId: Platform.runtimeProcess.env[MachineLanes.LANE_ID_ENV_KEY],
      lanes: canonicalLanes,
      loadAverage: Platform.loadAverage(),
      registryAvailable: laneInspection.available,
    },
    nodeModulesPresent: await FS.isDirectory(FS.resolvePath('node_modules', repositoryRoot)),
    nodeVersion,
    ports,
    repositoryRoot: canonicalRepositoryRoot,
    satisfies: Platform.semverSatisfies,
    watchmanHealthy: watchman.healthy,
    watchmanVersion: watchman.version,
  }
}

async function canonicalPath(path: string): Promise<string> {
  return await FS.realPath(path).catch(() => FS.resolvePath(path))
}

/** Reads the output directory from Langium's own config so the two cannot drift apart. */
async function readGeneratedParserArtifacts(
  repositoryRoot: string,
): Promise<{ path: string; present: boolean }[]> {
  const configPath = FS.resolvePath(LANGIUM_CONFIG, repositoryRoot)
  if (!await FS.isFile(configPath)) {
    return [{ path: LANGIUM_CONFIG, present: false }]
  }
  const config = await FS.readJson<{ out?: string }>(configPath)
  const outputRoot = FS.resolvePath(config.out ?? '.', FS.dirname(configPath))
  return await Promise.all(GENERATED_PARSER_MODULES.map(async name => {
    const path = FS.relativePath(repositoryRoot, FS.resolvePath(name, outputRoot))
    return { path, present: await FS.isFile(FS.resolvePath(name, outputRoot)) }
  }))
}

async function readDependencyIssues(): Promise<string[]> {
  try {
    return dependencyCompatibilityIssues(await readDependencyFacts())
  } catch (error) {
    return [`the compatibility gate could not read the workspace: ${(error as Error).message}`]
  }
}

async function readBranch(repositoryRoot: string): Promise<string | undefined> {
  const result = await CLI.run('git', {
    args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    cwd: repositoryRoot,
  })
  const branch = result.stdout.trim()
  return result.exitCode === 0 && branch.length > 0 ? branch : undefined
}

async function readLinkedWorktree(repositoryRoot: string): Promise<boolean> {
  const [gitDir, commonDir] = await Promise.all([
    CLI.run('git', { args: ['rev-parse', '--absolute-git-dir'], cwd: repositoryRoot }),
    CLI.run('git', { args: ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd: repositoryRoot }),
  ])
  return gitDir.stdout.trim() !== commonDir.stdout.trim()
}

async function readCommandVersion(command: string, args: readonly string[]): Promise<string | undefined> {
  const result = await CLI.run(command, { args: [...args] })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  return result.stdout.trim().split('\n')[0]?.trim()
}

async function readWatchman(): Promise<{ healthy?: boolean; version?: string }> {
  const version = await readCommandVersion('watchman', ['--version'])
  if (version === undefined) {
    return {}
  }
  const status = await CLI.run('watchman', { args: ['version'] })
  return { healthy: status.error === undefined && status.exitCode === 0, version }
}

async function readDirenvAllowed(repositoryRoot: string): Promise<boolean | undefined> {
  const result = await CLI.run('direnv', { args: ['status', '--json'], cwd: repositoryRoot })
  if (result.error !== undefined || result.exitCode !== 0) {
    return undefined
  }
  try {
    const status = JSON.parse(result.stdout) as { state?: { foundRC?: { allowed?: number } } }
    return status.state?.foundRC?.allowed === 0
  } catch {
    return undefined
  }
}

async function readArtifactRoot(repositoryRoot: string, path: string): Promise<ArtifactRoot> {
  const absolutePath = FS.resolvePath(path, repositoryRoot)
  if (!await FS.isDirectory(absolutePath)) {
    return { path, present: false, writable: true }
  }
  const size = await CLI.run('du', { args: ['-sk', absolutePath] })
  const kilobytes = Number(size.stdout.trim().split(/\s+/)[0])
  return {
    path,
    present: true,
    sizeBytes: Number.isFinite(kilobytes) ? kilobytes * 1024 : undefined,
    writable: await isWritable(absolutePath),
  }
}

async function readBunTempDir(repositoryRoot: string): Promise<{ path: string; writable: boolean } | undefined> {
  const path = FS.resolvePath('.artifacts/tmp', repositoryRoot)
  // A checkout that has never been built has no scratch directory yet, and a read-only diagnosis
  // must not be the thing that creates one. Probe the nearest ancestor that already exists.
  return { path, writable: await isWritable(await nearestExistingAncestor(path)) }
}

/** nearestExistingAncestor walks up until it finds a directory that is already there. */
async function nearestExistingAncestor(path: string): Promise<string> {
  let current = path
  while (!await FS.isDirectory(current)) {
    const parent = FS.dirname(current)
    if (parent === current) {
      return current
    }
    current = parent
  }
  return current
}

/** Probes with a real nested write, which is what a sandbox actually denies. */
async function isWritable(path: string): Promise<boolean> {
  // Named uniquely so concurrent doctor runs cannot delete each other's probe mid-check.
  const probeRoot = FS.resolvePath(`tao-doctor-probe-${Platform.randomUUID()}`, path)
  try {
    await FS.writeText(FS.resolvePath('nested/probe', probeRoot), 'probe')
    return true
  } catch {
    return false
  } finally {
    await FS.remove(probeRoot).catch(() => {})
  }
}

async function readPortOccupancy(port: typeof CONVENTIONAL_PORTS[number]): Promise<PortOccupancy> {
  const result = await CLI.run('lsof', {
    args: ['-nP', `-iTCP:${port.port}`, '-sTCP:LISTEN', '-F', 'pcn'],
  })
  return { listeners: ProcessListeners.formatLsofListeners(result), port: port.port, purpose: port.purpose }
}

async function presentPath(repositoryRoot: string, path: string): Promise<string | undefined> {
  const absolutePath = FS.resolvePath(path, repositoryRoot)
  return await FS.exists(absolutePath) ? absolutePath : undefined
}
