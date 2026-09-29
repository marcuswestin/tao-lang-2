import { CLI, Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'

type ExpoResult = { exitCode: number | null; stdout: string; stderr: string }
type ExpoRunner = (
  expo: string,
  args: readonly string[],
  cwd: string,
  interactive: boolean,
) => Promise<ExpoResult>

type HostedCrudRunOptions = {
  input?: Readable
  interactive?: boolean
  output?: Writable
  /** Replaces Expo CLI calls for focused command tests. */
  expoRunner?: ExpoRunner
}

const EXPO_GO_INSTALL_URL = 'https://expo.dev/go'

/**
 * Starts the Hosted CRUD pilot in Expo Go, on an iPhone once its Expo Go app is signed in to the Expo CLI
 * account, or in the iOS Simulator.
 */
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
  HCI.writeLine('', out)
  HCI.writeLine('To run on your iPhone:', out)
  HCI.writeLine(`  1. Install or open Expo Go: ${EXPO_GO_INSTALL_URL}`, out)
  HCI.writeLine(
    `  2. In Expo Go, open the Home tab, tap the account icon at the top right, and sign in as ${account}.`,
    out,
  )
  HCI.writeLine('', out)
  const onIPhone = await askIPhoneSignedIn(account, options)
  if (onIPhone) {
    HCI.writeLine('Starting Metro; scan the QR code with the iPhone camera.', out)
  } else {
    HCI.writeLine('Starting Metro and opening Expo Go in the iOS Simulator.', out)
  }
  const started = await run(expo, onIPhone ? ['start', '--go'] : ['start', '--go', '--ios'], project, true)
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

/** askIPhoneSignedIn waits until Expo Go on the iPhone is signed in, or Return chooses the iOS Simulator. */
async function askIPhoneSignedIn(account: string, options: HostedCrudRunOptions): Promise<boolean> {
  const terminal = { input: options.input, interactive: options.interactive, output: options.output }
  if (!HCI.isInteractive(terminal)) {
    return false
  }
  const answer = await HCI.askText({
    ...terminal,
    message: `Type yes once Expo Go on your iPhone is signed in as ${account}, or press Return to use the iOS Simulator`,
    validate: value => ['', 'y', 'yes'].includes(value.trim().toLowerCase()) ? undefined : 'Type yes, or press Return.',
  })
  return answer.trim() !== ''
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
