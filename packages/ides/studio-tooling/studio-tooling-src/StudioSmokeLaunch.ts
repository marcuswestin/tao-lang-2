import { CLI, Errors, FS, Repo, Time, VerificationTimeouts } from '@shared'
import { stopLaunches } from './StudioLifecycle'
import type { StudioReadiness } from './StudioReadiness'

/**
 * The smoke lane's way in: it starts Studio the way a person does, waits for the readiness
 * payload Studio prints, and stops it through its launch manifest. Nothing here scrapes a log or
 * reaches into Studio's internals, so a smoke run proves the command a person actually runs.
 */

/** How long a smoke launch is given to reach readiness before it is treated as failed. */
const READY_TIMEOUT_MS = 300_000
const READY_POLL_MS = 200

export type StudioSmokeLaunchOptions = {
  appName?: string
  port?: number
  previewPublication?: 'on' | 'off'
  projectRoot: string
  repositoryRoot?: string
  /** Injected in tests so the launch does not need a real Studio. */
  start?: (
    command: string,
    args: readonly string[],
    onOutput: (chunk: Buffer) => void,
  ) => CLI.StartedCommand
  timeoutMs?: number
  timeoutPolicy?: VerificationTimeouts.Policy
}

export type StartedStudioSmokeLaunch = {
  /** Everything the run needs to drive Studio: URLs, ids, and where its records are. */
  readiness: StudioReadiness
  /** Terminal output captured so far, for the run's artifacts when something fails. */
  output: () => string
  /** Stops every process the launch owns, through its manifest. Idempotent. */
  stop: () => Promise<void>
}

/** startStudioSmokeLaunch runs `./dev studio --json --no-browser` and waits for readiness. */
export async function startStudioSmokeLaunch(
  options: StudioSmokeLaunchOptions,
): Promise<StartedStudioSmokeLaunch> {
  const repositoryRoot = options.repositoryRoot ?? Repo.getRoot()
  const args = [
    'studio',
    options.projectRoot,
    '--no-browser',
    '--json',
    ...(options.appName === undefined ? [] : ['--app', options.appName]),
    ...(options.port === undefined ? [] : ['--port', String(options.port)]),
    ...(options.previewPublication === undefined ? [] : ['--preview-publication', options.previewPublication]),
  ]
  let output = ''
  const command = (options.start ?? defaultStart)(
    FS.resolvePath('dev', repositoryRoot),
    args,
    chunk => {
      output += chunk.toString('utf8')
    },
  )

  let stopped: Promise<void> | undefined
  const stop = () => {
    stopped ??= stopSmokeLaunch(command, repositoryRoot, () => readiness)
    return stopped
  }

  let readiness: StudioReadiness | undefined
  try {
    readiness = await waitForReadiness(
      command,
      () => output,
      VerificationTimeouts.resolve(options.timeoutMs ?? READY_TIMEOUT_MS, options.timeoutPolicy) ?? Infinity,
    )
  } catch (error) {
    await stop()
    throw error
  }
  return { output: () => output, readiness, stop }
}

/** readinessFromOutput finds the readiness payload in captured output, ignoring log lines. */
export function readinessFromOutput(output: string): StudioReadiness | undefined {
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') || !trimmed.includes('"sessionUrl"')) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as StudioReadiness
      if (parsed.version === 1 && typeof parsed.sessionUrl === 'string' && typeof parsed.launchId === 'string') {
        return parsed
      }
    } catch {
      continue
    }
  }
  return undefined
}

async function waitForReadiness(
  command: CLI.StartedCommand,
  output: () => string,
  timeoutMs: number,
): Promise<StudioReadiness> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / READY_POLL_MS))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const readiness = readinessFromOutput(output())
    if (readiness !== undefined) {
      return readiness
    }
    if (command.exitCode !== null || command.signalCode !== null || command.error !== undefined) {
      const completion = command.error === undefined
        ? `code=${String(command.exitCode)} signal=${String(command.signalCode)}`
        : `spawn error=${command.error.message}`
      Errors.throwUnexpected(
        `Tao Studio exited before reporting readiness (${completion}). Output:\n${output()}`,
      )
    }
    await Time.sleep(READY_POLL_MS)
  }
  Errors.throwUnexpected(
    `Tao Studio never reported readiness within ${timeoutMs}ms. Output:\n${output()}`,
  )
}

/**
 * Stopping goes through the manifest so the whole process tree is released, not only the
 * command this run happened to spawn. The spawned command is then closed out so no descriptor
 * or child is left behind if Studio ignored the signal.
 */
async function stopSmokeLaunch(
  command: CLI.StartedCommand,
  repositoryRoot: string,
  readiness: () => StudioReadiness | undefined,
): Promise<void> {
  // Only the launch this run was told about is stopped. Falling back to "the newest manifest in
  // the repository" would stop a Studio somebody else started, which is exactly what a run that
  // never reached readiness must not do.
  const launchId = readiness()?.launchId
  if (launchId !== undefined) {
    await stopLaunches({ launchId, repositoryRoot }).catch(() => undefined)
  }
  if (command.exitCode === null && command.signalCode === null) {
    command.kill('SIGTERM')
    await Promise.race([command.waitForClose(), Time.sleep(5_000)])
    if (command.exitCode === null && command.signalCode === null) {
      command.kill('SIGKILL')
      await command.waitForClose()
    }
  }
  await command.closeOutput()
  command.dispose()
}

function defaultStart(
  command: string,
  args: readonly string[],
  onOutput: (chunk: Buffer) => void,
): CLI.StartedCommand {
  return CLI.start(command, {
    args: [...args],
    // Metro's dev-middleware refuses to launch its debugger tooling under NODE_ENV=test, assuming
    // that means its own jest suite; override it so this real subprocess launch is not mistaken
    // for that unit-test context.
    env: { NODE_ENV: 'development' },
    onOutput: (_stream, chunk) => onOutput(chunk),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
