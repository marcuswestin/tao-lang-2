import { type PortReservation, Ports } from '@expo-host/dev-loop/expo-runner/Ports'
import { CLI, Errors, FS, Platform, Repo } from '@shared'
import { GateCatalog } from '@verification/GateCatalog'
import { MachineLanes, type MachineResourceLease } from '@verification/MachineLanes'
import { UiVisibility } from '@verification/UiVisibility'

const basePort = 42_000
const portsPerShard = 128
const portsPerWorker = 2
const shardCount = 16

type StudioSmokeResources = {
  artifactRoot: string
  previewPort: number
  serverPort: number
  shardIndex: number
  workerIndex: number
}

type StudioSmokeOptions = {
  files: readonly string[]
  native?: boolean
  showStudio?: boolean
  /** Test registry; production shares the machine-wide resource registry. */
  registryRoot?: string
  /** Test port probe; production checks the actual host ports. */
  portsAvailable?: (ports: readonly number[]) => Promise<boolean>
  runId: string
  shardIndex?: number
  workerIndex?: number
}

/** StudioSmokeReservation holds the cross-worktree claim until the smoke child exits. */
type StudioSmokeReservation = {
  allocation: StudioSmokeResources
  release: () => Promise<void>
}

type ReservationOptions = Omit<StudioSmokeOptions, 'files'>

/** StudioSmoke owns explicit, slow Studio smoke execution outside ordinary package discovery. */
export const StudioSmoke = {
  defaultShardIndex,
  reserveResources,
  resources,
  run,
  shardCount,
} as const

/**
 * defaultShardIndex gives each worktree its own block of the port range. Worker index separates the
 * lanes inside one run; nothing separated one checkout's lanes from another's, so two agents running
 * a Studio lane at the same time both bound 42000 and the second one failed on a port the first one
 * owned. Deriving the shard from the worktree path makes the common case — different worktrees —
 * disjoint by construction, and `run` walks to the next free shard when two paths still collide.
 */
function defaultShardIndex(repositoryRoot = Repo.resolvePath()): number {
  let hash = 0
  for (const character of repositoryRoot) {
    hash = (hash * 31 + character.codePointAt(0)!) % 1_000_003
  }
  return hash % shardCount
}

function resources(options: Omit<StudioSmokeOptions, 'files'>): StudioSmokeResources {
  const shardIndex = nonNegativeIndex(
    options.shardIndex ?? defaultShardIndex(),
    'Studio smoke shard index',
    shardCount - 1,
  )
  const workerIndex = nonNegativeIndex(options.workerIndex ?? 0, 'Studio smoke worker index', 63)
  const runId = safeRunId(options.runId)
  const lanePort = basePort + shardIndex * portsPerShard + workerIndex * portsPerWorker
  return {
    artifactRoot: Repo.resolvePath(
      `.artifacts/tests/studio-smoke/${runId}/shard-${shardIndex}/worker-${workerIndex}`,
    ),
    previewPort: lanePort + 1,
    serverPort: lanePort,
    shardIndex,
    workerIndex,
  }
}

async function run(options: StudioSmokeOptions): Promise<number> {
  if (UiVisibility.smokeNeedsStudio(options.files, options.native)) {
    UiVisibility.requireStudio(options.showStudio)
    UiVisibility.warn(UiVisibility.studioWarnings)
  }
  if (options.files.length === 0) {
    Errors.throwUserInput('Studio smoke requires at least one explicit test file.')
  }
  await requireGeneratedParser()
  const guiLease = options.native === true && Platform.runtimeProcess.env[GateCatalog.GUI_LEASE_HELD_ENV_KEY] !== 'true'
    ? await MachineLanes.acquireResource({
      command: 'studio-smoke-native',
      name: GateCatalog.GUI_RESOURCE,
      registryRoot: options.registryRoot,
      repositoryRoot: Repo.getRoot(),
      waitTimeoutMs: 10 * 60_000,
    })
    : undefined
  try {
    const reservation = await reserveResources(options)
    const allocation = reservation.allocation
    try {
      await FS.mkdir(allocation.artifactRoot)
      const result = await CLI.run('bun', {
        args: [
          'test',
          ...options.files.map(path => FS.resolvePath(path)),
          `--timeout=${Platform.runtimeProcess.env['TAO_VERIFY_NO_TIMEOUTS'] === 'true' ? 0 : 600000}`,
        ],
        env: {
          TAO_HOME: FS.resolvePath('home', allocation.artifactRoot),
          [UiVisibility.STUDIO_ENV_KEY]: options.showStudio === true ? 'true' : 'false',
          TAO_STUDIO_SMOKE_ARTIFACT_ROOT: allocation.artifactRoot,
          TAO_STUDIO_SMOKE_NATIVE: options.native === true ? 'true' : 'false',
          TAO_STUDIO_SMOKE_PREVIEW_PORT: String(allocation.previewPort),
          TAO_STUDIO_SMOKE_SERVER_PORT: String(allocation.serverPort),
          TAO_STUDIO_TEST_SHARD_INDEX: String(allocation.shardIndex),
          TAO_STUDIO_TEST_WORKER_INDEX: String(allocation.workerIndex),
        },
        stdio: 'inherit',
      })
      return result.error === undefined ? result.exitCode ?? 1 : 1
    } finally {
      await reservation.release()
    }
  } finally {
    await guiLease?.release()
  }
}

/** reserveResources claims and probes one block; the filesystem claim stays live through the run. */
async function reserveResources(options: ReservationOptions): Promise<StudioSmokeReservation> {
  if (options.shardIndex !== undefined) {
    const allocation = resources(options)
    const lease = await acquireBlockLease(allocation, options.registryRoot)
    if (lease === undefined) {
      Errors.throwHostEnvironment(
        `Studio smoke shard ${allocation.shardIndex}, worker ${allocation.workerIndex} is already reserved by another worktree.`,
      )
    }
    let retained = false
    try {
      if (!await (options.portsAvailable ?? portsAreFree)([allocation.serverPort, allocation.previewPort])) {
        Errors.throwHostEnvironment(
          `Studio smoke shard ${allocation.shardIndex}, worker ${allocation.workerIndex} has a port already in use.`,
        )
      }
      retained = true
      return resourceReservation(allocation, lease)
    } finally {
      if (!retained) {
        await lease.release()
      }
    }
  }
  return freeShardAllocation(options)
}

/**
 * freeShardAllocation starts at this worktree's own shard and takes the first one whose ports are
 * free, so a lane never dies on a port another worktree's lane is already serving.
 */
async function freeShardAllocation(options: ReservationOptions): Promise<StudioSmokeReservation> {
  const preferred = defaultShardIndex()
  for (let attempt = 0; attempt < shardCount; attempt += 1) {
    const allocation = resources({ ...options, shardIndex: (preferred + attempt) % shardCount })
    const lease = await acquireBlockLease(allocation, options.registryRoot)
    if (lease === undefined) {
      continue
    }
    let retained = false
    try {
      if (await (options.portsAvailable ?? portsAreFree)([allocation.serverPort, allocation.previewPort])) {
        retained = true
        return resourceReservation(allocation, lease)
      }
    } finally {
      if (!retained) {
        await lease.release()
      }
    }
  }
  Errors.throwHostEnvironment(
    `Every Studio smoke port block from ${basePort} to ${basePort + shardCount * portsPerShard - 1} is in use, `
      + 'which means this machine is already running Studio lanes in other worktrees. Wait for one to finish, '
      + 'or name a free block yourself with --shard.',
  )
}

async function acquireBlockLease(
  allocation: StudioSmokeResources,
  registryRoot?: string,
): Promise<MachineResourceLease | undefined> {
  return MachineLanes.tryAcquireResource({
    name: `studio-smoke-ports-${allocation.serverPort}-${allocation.previewPort}`,
    registryRoot,
  })
}

function resourceReservation(
  allocation: StudioSmokeResources,
  lease: MachineResourceLease,
): StudioSmokeReservation {
  return { allocation, release: () => lease.release() }
}

/** portsAreFree reports whether every port in one lane's block can still be bound. */
async function portsAreFree(ports: readonly number[]): Promise<boolean> {
  const reservations: PortReservation[] = []
  try {
    for (const port of ports) {
      const reservation = await Ports.reserveAvailable(port)
      reservations.push(reservation)
      if (reservation.port !== port) {
        // `reserveAvailable` falls back to an ephemeral port when the preferred one is taken, and an
        // ephemeral port is no use here: the lane's environment names the block it must bind.
        return false
      }
    }
    return true
  } finally {
    await Promise.all(reservations.map(reservation => reservation.release().catch(() => {})))
  }
}

/**
 * Without the generated parser every lane dies on `Cannot find module './_gen_tao-parser/module'`,
 * which names a path that was never checked in and gives no hint that generation is the fix. A fresh
 * worktree, or one checked out at an older commit, hits this before any Studio code runs.
 */
async function requireGeneratedParser(): Promise<void> {
  const generated = Repo.resolvePath('packages/language/parser/parser-src/_gen_tao-parser')
  if (!await FS.exists(generated)) {
    Errors.throwHostEnvironment(
      'The generated Tao parser is missing, so no smoke lane can start. Run `./agent fix` (or '
        + '`bun run packages/testing/verification/verification-src/ParserGenerate.ts`) in this worktree first.',
    )
  }
}

function nonNegativeIndex(value: number, label: string, maximum: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= maximum) {
    return value
  }
  Errors.throwUserInput(`${label} must be an integer from 0 through ${maximum}.`)
}

function safeRunId(value: string): string {
  const runId = value.trim()
  if (runId.length > 0 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
    return runId
  }
  Errors.throwUserInput('Studio smoke run id must use only letters, numbers, dots, underscores, or dashes.')
}
