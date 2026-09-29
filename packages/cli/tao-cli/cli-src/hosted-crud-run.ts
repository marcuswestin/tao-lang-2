import { CLI, Errors, FS, HCI } from '@shared'
import type { Writable } from 'node:stream'

type ExpoResult = { exitCode: number | null; stdout: string; stderr: string }
type ExpoRunner = (
  expo: string,
  args: readonly string[],
  cwd: string,
  interactive: boolean,
) => Promise<ExpoResult>

type HostedCrudRunOptions = {
  output?: Writable
  /** Replaces Expo CLI calls for focused command tests. */
  expoRunner?: ExpoRunner
}

/** Starts the Hosted CRUD pilot for Expo Go after the Expo account it needs is signed in. */
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
  const run = options.expoRunner ?? runExpoCli
  const out = { output: options.output }

  // Since SDK 57, Expo Go on a physical iPhone opens a dev server only when Expo CLI and Expo Go are signed in
  // to the same Expo account.
  let account = await expoAccount(run, expo, project)
  if (!account) {
    HCI.writeLine('Expo Go on iPhone needs an Expo account signed in both here and in the Expo Go app.', out)
    HCI.writeLine('Signing in to Expo CLI; create a free account at https://expo.dev/signup if you have none.', out)
    const login = await run(expo, ['login'], project, true)
    if (login.exitCode !== 0) {
      Errors.throwHostEnvironment('Expo sign-in did not finish. Retry after signing in.')
    }
    account = await expoAccount(run, expo, project)
    if (!account) {
      Errors.throwHostEnvironment('Expo CLI did not retain a sign-in.')
    }
  }
  HCI.writeLine(`Expo CLI is signed in as ${account}.`, out)
  HCI.writeLine(
    `In Expo Go on your iPhone, sign in as ${account} too (Home tab, account icon at the top right).`,
    out,
  )
  HCI.writeLine('Starting Metro; scan the QR code with the iPhone camera.', out)
  const started = await run(expo, ['start', '--go'], project, true)
  if (started.exitCode !== 0 && started.exitCode !== null) {
    Errors.throwHostEnvironment(`Expo exited with code ${started.exitCode}.`)
  }
}

/** hostedCrudRunCommand is the command a person types to start the pilot, spelled for where they are. */
export async function hostedCrudRunCommand(project: string): Promise<string> {
  const repository = await taoRepositoryRoot(project)
  return repository
    ? `./tao connect run ${shellQuote(FS.relativePath(repository, project) || '.')}`
    : `tao connect run ${shellQuote(FS.displayPath(project))}`
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

async function expoAccount(run: ExpoRunner, expo: string, project: string): Promise<string | undefined> {
  const result = await run(expo, ['whoami'], project, false)
  const name = result.stdout.replaceAll(/\u001b\[[0-9;]*m/gu, '').trim().split('\n').at(-1)?.trim() ?? ''
  return result.exitCode === 0 && /^[\w.-]+$/u.test(name) ? name : undefined
}

async function runExpoCli(
  expo: string,
  args: readonly string[],
  cwd: string,
  interactive: boolean,
): Promise<ExpoResult> {
  return await CLI.run(expo, { args: [...args], cwd, stdio: interactive ? 'inherit' : 'pipe' })
}
