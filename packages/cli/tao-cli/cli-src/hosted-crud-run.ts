import type { ExpoFetch } from '@expo-host/dev-loop/expo-runner/metro'
import { CLI, Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { type MetroStarter, runMetroSession } from './hosted-crud-metro'

type ExpoResult = { exitCode: number | null; stdout: string; stderr: string }
type ExpoRunner = (
  expo: string,
  args: readonly string[],
  cwd: string,
  interactive: boolean,
  signal?: AbortSignal,
) => Promise<ExpoResult>

type HostedCrudRunOptions = {
  input?: Readable
  interactive?: boolean
  output?: Writable
  /** Replaces Expo CLI calls for focused command tests. */
  expoRunner?: ExpoRunner
  /** Replace the headless Metro process and its HTTP calls for focused command tests. */
  metro?: MetroStarter
  fetch?: ExpoFetch
  pollMs?: number
  port?: number
}

const EXPO_GO_INSTALL_URL = 'https://expo.dev/go'

/** Starts the Hosted CRUD pilot in Expo Go; device actions are available once Metro is ready. */
export async function runHostedCrud(path = '.', options: HostedCrudRunOptions = {}): Promise<void> {
  const project = FS.resolvePath(path)
  if (!await FS.isFile(FS.resolvePath('app.json', project))) {
    Errors.throwUserInput(`No Expo app.json found at ${FS.displayPath(project)}.`)
  }
  const expo = await findExpoBinary(project)
  if (!expo) {
    Errors.throwHostEnvironment(
      `Expo CLI is not installed for ${FS.displayPath(project)}. Install the project's dependencies first.`,
    )
  }
  const activeExpoRuns = new Set<Promise<ExpoResult>>()
  const run: ExpoRunner = options.expoRunner ?? ((...args) => {
    const task = runExpoCli(...args)
    activeExpoRuns.add(task)
    void task.then(() => activeExpoRuns.delete(task), () => activeExpoRuns.delete(task))
    return task
  })
  try {
    await runMetroSession({
      expo,
      fetch: options.fetch,
      input: options.input,
      interactive: options.interactive,
      metro: options.metro,
      output: options.output,
      pollMs: options.pollMs,
      port: options.port,
      project,
      deviceGuidance: async signal => {
        const account = await expoAccount(run, expo, project, signal)
        return [
          `Install or open Expo Go on your device: ${EXPO_GO_INSTALL_URL}`,
          account
            ? `For iPhone, open Expo Go Home, tap the account icon, and sign in as ${account} (the Expo CLI account).`
            : 'For iPhone, sign in to Expo CLI with `expo login`, then sign in to the same account in Expo Go.',
        ]
      },
    })
  } finally {
    // The default account lookup owns a child process; let its abort teardown finish before returning.
    await Promise.allSettled([...activeExpoRuns])
  }
  HCI.writeLine('Metro stopped.', { output: options.output })
}

/** hostedCrudRunCommand is the command a person types to start the pilot, spelled for where they are. */
export async function hostedCrudRunCommand(project: string): Promise<string> {
  const repository = await taoRepositoryRoot(project)
  return repository
    ? `./tao connect run ${shellQuote(FS.relativePath(repository, project) || '.')}`
    : `tao connect run ${shellQuote(FS.displayPath(project))}`
}

/** Prints a runnable app command relative to the terminal's current directory. */
export async function taoAppRunCommand(project: string, appName: string, cwd = FS.resolvePath('.')): Promise<string> {
  const repository = await taoRepositoryRoot(project)
  const executable = repository ? FS.relativePath(cwd, FS.resolvePath('tao', repository)) : 'tao'
  const command = repository && !executable.includes('/') ? './' + executable : executable
  return `${shellQuote(command)} run ${shellQuote(FS.relativePath(cwd, project) || '.')} --app ${shellQuote(appName)}`
}

/** taoRepositoryRoot finds the Tao development checkout holding a path, whose `./tao` runs the CLI from source. */
async function taoRepositoryRoot(path: string): Promise<string | undefined> {
  for (let directory = FS.resolvePath(path);; directory = FS.dirname(directory)) {
    if (
      await FS.isFile(FS.resolvePath('tao', directory))
      && await FS.isFile(FS.resolvePath('packages/cli/tao-cli/cli-src/tao-cli.ts', directory))
    ) {
      return directory
    }
    if (FS.dirname(directory) === directory) {
      return undefined
    }
  }
}

function shellQuote(value: string): string {
  return /^[\w./-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
}

async function findExpoBinary(project: string): Promise<string | undefined> {
  for (let directory = project;; directory = FS.dirname(directory)) {
    const candidate = FS.resolvePath('node_modules/.bin/expo', directory)
    if (await FS.exists(candidate)) {
      return candidate
    }
    if (FS.dirname(directory) === directory) {
      return undefined
    }
  }
}

async function expoAccount(
  run: ExpoRunner,
  expo: string,
  project: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const result = await run(expo, ['whoami'], project, false, signal)
  const name = result.stdout.replaceAll(/\u001b\[[0-9;]*m/gu, '').trim().split('\n').at(-1)?.trim() ?? ''
  return result.exitCode === 0 && /^[\w.-]+$/u.test(name) ? name : undefined
}

async function runExpoCli(
  expo: string,
  args: readonly string[],
  cwd: string,
  interactive: boolean,
  signal?: AbortSignal,
): Promise<ExpoResult> {
  if (signal?.aborted) {
    return { exitCode: null, stdout: '', stderr: '' }
  }
  let stdout = ''
  let stderr = ''
  const command = CLI.start(expo, {
    args: [...args],
    cwd,
    stdio: interactive ? 'inherit' : 'pipe',
    onOutput: (stream, chunk) => {
      if (stream === 'stdout') {
        stdout += chunk.toString('utf8')
      } else {
        stderr += chunk.toString('utf8')
      }
    },
  })
  const abort = () => {
    command.kill()
  }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }
  try {
    const { exitCode } = await command.waitForClose()
    await command.closeOutput()
    return { exitCode, stdout, stderr }
  } finally {
    signal?.removeEventListener('abort', abort)
    command.dispose()
  }
}
