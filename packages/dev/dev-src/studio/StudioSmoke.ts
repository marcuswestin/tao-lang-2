import { CLI, Errors, FS, Repo } from '@shared'

const basePort = 42_000
const portsPerShard = 128
const portsPerWorker = 2

export type StudioSmokeResources = {
  artifactRoot: string
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
  await requireGeneratedParser()
  const allocation = resources(options)
  await FS.mkdir(allocation.artifactRoot)
  const result = await CLI.run('bun', {
    args: ['test', ...options.files.map(path => FS.resolvePath(path)), '--timeout=180000'],
    env: {
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
}

/**
 * Without the generated parser every lane dies on `Cannot find module './_gen_tao-parser/module'`,
 * which names a path that was never checked in and gives no hint that generation is the fix. A fresh
 * worktree, or one checked out at an older commit, hits this before any Studio code runs.
 */
async function requireGeneratedParser(): Promise<void> {
  const generated = Repo.resolvePath('packages/parser/parser-src/_gen_tao-parser')
  if (!await FS.exists(generated)) {
    throw new Errors.HostEnvironmentError(
      'The generated Tao parser is missing, so no smoke lane can start. Run `just fix` (or '
        + '`bun run packages/dev/dev-src/repository-tests/ParserGenerate.ts`) in this worktree first.',
    )
  }
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
