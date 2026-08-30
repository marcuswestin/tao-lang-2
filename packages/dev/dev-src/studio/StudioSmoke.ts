import { CLI, Errors, FS, Repo } from '@shared'

const basePort = 42_000
const portsPerShard = 1_024
const portsPerWorker = 8

export type StudioSmokeResources = {
  artifactRoot: string
  electronDebuggingPort: number
  previewPort: number
  serverPort: number
  shardIndex: number
  workerIndex: number
}

export type StudioSmokeOptions = {
  files: readonly string[]
  native?: boolean
  runId: string
  shardIndex?: number
  workerIndex?: number
}

/** StudioSmoke owns explicit, slow Studio smoke execution outside ordinary package discovery. */
export const StudioSmoke = {
  resources,
  run,
} as const

function resources(options: Omit<StudioSmokeOptions, 'files'>): StudioSmokeResources {
  const shardIndex = nonNegativeIndex(options.shardIndex ?? 0, 'Studio smoke shard index', 15)
  const workerIndex = nonNegativeIndex(options.workerIndex ?? 0, 'Studio smoke worker index', 63)
  const runId = safeRunId(options.runId)
  const lanePort = basePort + shardIndex * portsPerShard + workerIndex * portsPerWorker
  return {
    artifactRoot: Repo.resolvePath(
      `.artifacts/tests/studio-smoke/${runId}/shard-${shardIndex}/worker-${workerIndex}`,
    ),
    electronDebuggingPort: lanePort + 2,
    previewPort: lanePort + 1,
    serverPort: lanePort,
    shardIndex,
    workerIndex,
  }
}

async function run(options: StudioSmokeOptions): Promise<number> {
  if (options.files.length === 0) {
    throw new Errors.UserInputError('Studio smoke requires at least one explicit test file.')
  }
  const allocation = resources(options)
  await FS.mkdir(allocation.artifactRoot)
  const result = await CLI.run('bun', {
    args: ['test', ...options.files.map(path => FS.resolvePath(path)), '--timeout=180000'],
    env: {
      TAO_STUDIO_SMOKE_ARTIFACT_ROOT: allocation.artifactRoot,
      TAO_STUDIO_SMOKE_ELECTRON_DEBUGGING_PORT: String(allocation.electronDebuggingPort),
      TAO_STUDIO_SMOKE_NATIVE: options.native === true ? 'true' : 'false',
      TAO_STUDIO_SMOKE_PREVIEW_PORT: String(allocation.previewPort),
      TAO_STUDIO_SMOKE_SERVER_PORT: String(allocation.serverPort),
      TAO_STUDIO_TEST_SHARD_INDEX: String(allocation.shardIndex),
      TAO_STUDIO_TEST_WORKER_INDEX: String(allocation.workerIndex),
    },
    stdio: 'inherit',
  })
  return result.error === undefined ? result.exitCode ?? 1 : 1
}

function nonNegativeIndex(value: number, label: string, maximum: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= maximum) {
    return value
  }
  throw new Errors.UserInputError(`${label} must be an integer from 0 through ${maximum}.`)
}

function safeRunId(value: string): string {
  const runId = value.trim()
  if (runId.length > 0 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
    return runId
  }
  throw new Errors.UserInputError('Studio smoke run id must use only letters, numbers, dots, underscores, or dashes.')
}
