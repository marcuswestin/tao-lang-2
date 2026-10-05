import { Errors, FS, HCI, Platform } from '@shared'
import type { Readable, Writable } from 'node:stream'
import {
  assertFirebaseManagementEnvironment,
  firebaseManagementJson,
  type FirebaseRunner,
  runFirebaseCli,
} from './firebase-cli'
import { listFirebaseAccounts } from './firebase-inspection'

type Operation =
  | 'projects-list'
  | 'projects-info'
  | 'projects-create'
  | 'apps-list'
  | 'apps-info'
  | 'apps-config'
  | 'apps-create'
  | 'data-reset'
type Prompts = {
  text: (message: string, defaultValue?: string) => Promise<string>
  choice: (
    message: string,
    choices: readonly { value: string; label: string }[],
    defaultValue: string,
  ) => Promise<string>
}
type Options = {
  project?: string
  uid?: string
  store?: string
  account?: string
  dryRun?: boolean
  json?: boolean
  cwd?: string
  input?: Readable
  output?: Writable
  progress?: Writable
  interactive?: boolean
  prompts?: Prompts
  runner?: FirebaseRunner
  accounts?: typeof listFirebaseAccounts
}
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u
const APP_ID = /^1:[0-9]+:(web|android|ios):[a-zA-Z0-9]+$/u
const WARN_RESET =
  'Server reset does not clear local offline replicas: they can republish data. Stop clients and clear their local stores before reconnecting. Auth users, other stores, project settings, and apps are preserved.'

/** Manage public Firebase resources and reset exactly one authored store for one user. */
export async function runFirebaseManagement(
  operation: Operation,
  value?: string,
  options: Options = {},
): Promise<unknown> {
  const cwd = FS.resolvePath(options.cwd ?? '.')
  const out = { output: options.output }
  const progress = { output: options.progress ?? (options.json ? Platform.runtimeProcess.stderr : options.output) }
  const say = (message: string) => HCI.writeLine(message, progress)
  const finish = (result: unknown) => {
    HCI.writeLine(JSON.stringify(result, null, options.json ? undefined : 2), out)
    return result
  }
  const terminal = { input: options.input, output: progress.output, interactive: options.interactive }
  const localPrompt = () => {
    if (!options.prompts && !HCI.isInteractive(terminal)) {
      Errors.throwUserInput(
        'Firebase confirmation and account selection need an interactive local terminal. No cloud mutation was attempted.',
      )
    }
    return options.prompts ?? {
      text: (message: string, defaultValue?: string) => HCI.askText({ ...terminal, message, defaultValue }),
      choice: (message: string, choices: readonly { value: string; label: string }[], defaultValue: string) =>
        HCI.askChoice({ ...terminal, message, choices, defaultValue }),
    }
  }
  const confirm = async (message: string) => {
    const answer = await localPrompt().choice(message, [
      { value: 'continue', label: 'Continue' },
      { value: 'stop', label: 'Stop' },
    ], 'continue')
    if (answer !== 'continue') {
      Errors.throwUserInput('Firebase operation cancelled; no cloud mutation was attempted.')
    }
  }
  // Validate every supplied field before authentication, including fields irrelevant to an operation.
  const allowed: Record<Operation, readonly string[]> = {
    'projects-list': [],
    'projects-info': [],
    'projects-create': [],
    'apps-list': ['project'],
    'apps-info': ['project'],
    'apps-config': ['project'],
    'apps-create': ['project'],
    'data-reset': ['project', 'uid', 'store', 'dryRun'],
  }
  for (const name of ['project', 'uid', 'store', 'dryRun'] as const) {
    if (options[name] !== undefined && !allowed[operation].includes(name)) {
      Errors.throwUserInput('The ' + name + ' option does not apply to this Firebase command.')
    }
  }
  if (options.account !== undefined && !validEmail(options.account)) {
    Errors.throwUserInput('Enter a signed-in Google account email for --account.')
  }
  if (options.project !== undefined || operation.startsWith('apps-') || operation === 'data-reset') {
    projectId(options.project)
  }
  if (operation === 'projects-info' || (operation === 'projects-create' && value !== undefined)) {
    projectId(value)
  }
  if (operation === 'apps-info' || operation === 'apps-config') {
    if (!value || !APP_ID.test(value) || (operation === 'apps-config' && !value.includes(':web:'))) {
      Errors.throwUserInput(
        operation === 'apps-config'
          ? 'Enter a Firebase web app ID for configuration.'
          : 'Enter a valid Firebase app ID.',
      )
    }
  }
  if (
    operation === 'apps-create'
    && (!value?.trim() || value.startsWith('-') || value.length > 100 || /[\u0000-\u001f\u007f]/u.test(value))
  ) {
    Errors.throwUserInput(
      'Enter a web app display name of 1–100 characters without control characters or an initial hyphen.',
    )
  }
  let reset: { projectId: string; database: string; path: string; recursive: boolean; warning: string } | undefined
  if (operation === 'data-reset') {
    pathSegment(options.uid, 'uid')
    storageKey(options.store)
    reset = {
      projectId: options.project!,
      database: '(default)',
      path: 'users/' + options.uid + '/stores/s_' + encodeURIComponent(options.store!),
      recursive: true,
      warning: WARN_RESET,
    }
    say(
      'Find the User UID at https://console.firebase.google.com/project/' + options.project
        + '/authentication/users (Authentication → Users → User UID). Use the authored Datasource Firebase StorageKey from your Tao source, such as hosted-firebase-notes; this is not the web app ID.',
    )
    say(
      'Firebase server reset plan: project ' + reset.projectId + ', database (default), recursively delete '
        + reset.path + '.',
    )
    say(WARN_RESET)
    if (options.dryRun) {
      return finish({ ...reset, dryRun: true })
    }
    await confirm('Apply this exact server reset plan?')
  }
  assertFirebaseManagementEnvironment()
  if (Object.hasOwn(Platform.runtimeProcess.env, 'FIREBASE_TOKEN')) {
    Errors.throwUserInput(
      'Unset FIREBASE_TOKEN before Firebase management. Use locally signed-in Google accounts; no cloud calls were made.',
    )
  }
  if (operation === 'projects-create') {
    if (value === undefined) {
      const proposed = 'tao-project-' + Platform.randomUUID().slice(0, 8)
      say(
        'Reuse existing projects at https://console.firebase.google.com when possible. Creation uses account quota. Press Enter to accept the proposed globally unique project ID.',
      )
      value =
        (await localPrompt().text('Firebase project ID (6–30 lowercase letters, digits, or hyphens)', proposed)).trim()
        || proposed
      projectId(value)
    }
    say('Create Firebase project ' + value + '. This uses your Google Cloud project quota.')
    await confirm('Create this Firebase project?')
  }
  if (operation === 'apps-create') {
    say(
      'Register Firebase WEB app ' + value + ' in project ' + options.project
        + '. Tao uses the Web SDK on every client platform.',
    )
    await confirm('Register this Firebase web app?')
  }
  const rawRun: FirebaseRunner = options.runner
    ?? ((args, work, interactive) => runFirebaseCli(args, work, interactive, progress.output))
  say('Checking local Firebase CLI sign-in…')
  const readAccounts = options.accounts ?? listFirebaseAccounts
  let accounts = await readAccounts(cwd)
  if (accounts.length === 0) {
    if (options.json) {
      Errors.throwUserInput(
        'Run tao firebase projects list in an interactive local terminal to sign in, then retry with --json. No cloud calls were made.',
      )
    }
    localPrompt()
    say('Complete the official Firebase CLI Google sign-in in the browser. Credentials remain local.')
    const login = await rawRun(['login', '--reauth'], cwd, true)
    if (login.exitCode !== 0) {
      Errors.throwHostEnvironment('Firebase sign-in did not finish. Sign in locally and retry.')
    }
    accounts = await readAccounts(cwd)
  }
  const emails = accounts.map(account => account.user.email).filter(validEmail)
  if (!emails.length) {
    Errors.throwHostEnvironment('Firebase CLI did not retain a valid Google sign-in.')
  }
  let account = options.account
  if (account && !emails.includes(account)) {
    Errors.throwUserInput('The requested Google account is not signed in locally. Sign in to that account and retry.')
  }
  if (!account) {
    if (emails.length > 35) {
      Errors.throwUserInput('Firebase account selection supports up to 35 accounts; specify --account email.')
    }
    account = emails.length === 1
      ? emails[0]!
      : await localPrompt().choice(
        'Choose the signed-in Google account',
        emails.map(email => ({ value: email, label: email })),
        emails[0]!,
      )
  }
  if (!emails.includes(account)) {
    Errors.throwUserInput('Choose one of the locally signed-in Google accounts.')
  }
  const run: FirebaseRunner = (args, work, interactive) => rawRun([...args, '--account', account!], work, interactive)
  const json = (args: readonly string[], action: string) =>
    firebaseManagementJson(
      run,
      cwd,
      [...args, '--non-interactive'],
      action,
      options.project
        ?? ((operation === 'projects-create' || operation === 'projects-info') ? value! : 'tao-management'),
    )
  if (operation === 'data-reset') {
    say('Resetting ' + reset!.path + '…')
    await json([
      'firestore:delete',
      reset!.path,
      '--project',
      reset!.projectId,
      '--database',
      '(default)',
      '--recursive',
      '--force',
    ], 'reset the selected server store')
    return finish({ ...reset!, reset: true })
  }
  if (operation === 'projects-create') {
    say('Creating Firebase project ' + value + '… This usually takes about a minute.')
    return finish(publicProject(await json(['projects:create', value!], 'create Firebase project')))
  }
  if (operation === 'projects-list' || operation === 'projects-info') {
    say('Listing Firebase projects…')
    const result = list(await json(['projects:list'], 'list Firebase projects')).map(publicProject)
    if (operation === 'projects-list') {
      return finish(result)
    }
    const found = result.find(project => project['projectId'] === value)
    if (!found) {
      Errors.throwUserInput('The selected account has no accessible Firebase project with that ID.')
    }
    return finish(found)
  }
  if (operation === 'apps-create') {
    say('Registering Firebase web app…')
    return finish(
      publicApp(await json(['apps:create', 'WEB', value!, '--project', options.project!], 'register Firebase web app')),
    )
  }
  say('Listing Firebase apps…')
  const apps = list(await json(['apps:list', '--project', options.project!], 'list Firebase apps')).map(publicApp)
  if (operation === 'apps-list') {
    return finish(apps)
  }
  const app = apps.find(app => app['appId'] === value)
  if (!app) {
    Errors.throwUserInput('The Firebase app ID does not belong to the selected project.')
  }
  if (operation === 'apps-info') {
    return finish(app)
  }
  say('Reading public Firebase web SDK configuration…')
  const config = await json(
    ['apps:sdkconfig', 'WEB', value!, '--project', options.project!],
    'read web app configuration',
  )
  const sdk = record(config) ? config['sdkConfig'] : undefined
  if (!record(sdk) || sdk['appId'] !== value || sdk['projectId'] !== options.project) {
    Errors.throwHostEnvironment('Firebase CLI returned configuration for an unexpected app or project.')
  }
  return finish(
    fields(sdk, [
      'projectId',
      'appId',
      'apiKey',
      'authDomain',
      'databaseURL',
      'storageBucket',
      'messagingSenderId',
      'measurementId',
    ]),
  )
}
function projectId(value: unknown): void {
  if (typeof value !== 'string' || !PROJECT_ID.test(value)) {
    Errors.throwUserInput(
      'Firebase project ID must be 6–30 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit.',
    )
  }
}
function pathSegment(value: unknown, name: string): void {
  if (
    typeof value !== 'string' || !value || value === '.' || value === '..' || value.startsWith('-')
    || /[/\\\u0000-\u001f\u007f]/u.test(value) || /%[0-9a-f]{2}/iu.test(value) || /[\uD800-\uDFFF]/u.test(value)
    || value.length > 128
  ) {
    Errors.throwUserInput(
      'The --' + name
        + ' value must be one nonempty path segment without traversal, slashes, encoded path segments, or control characters.',
    )
  }
}
function storageKey(value: unknown): void {
  if (
    typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)
    || ('s_' + encodeURIComponent(value)).length > 1_500
  ) {
    Errors.throwUserInput(
      'The authored StorageKey must contain nonblank text without control characters, and fit in one encoded Firestore segment.',
    )
  }
}
function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && !value.startsWith('-')
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected resource list.')
  }
  return value
}
function fields(value: unknown, keys: readonly string[]): Record<string, string> {
  if (!record(value)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected resource.')
  }
  const result: Record<string, string> = {}
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string' && !/[\u0000-\u001f\u007f]/u.test(item)) {
      result[key] = item
    }
  }
  return result
}
function publicProject(value: unknown): Record<string, string> {
  const result = fields(value, ['projectId', 'projectNumber', 'displayName', 'name', 'state'])
  if (!result['projectId'] || !PROJECT_ID.test(result['projectId'])) {
    Errors.throwHostEnvironment('Firebase CLI returned an invalid project ID.')
  }
  return result
}
function publicApp(value: unknown): Record<string, string> {
  const result = fields(value, [
    'appId',
    'displayName',
    'platform',
    'projectId',
    'packageName',
    'bundleId',
    'appStoreId',
    'name',
    'state',
  ])
  if (!result['appId'] || !APP_ID.test(result['appId'])) {
    Errors.throwHostEnvironment('Firebase CLI returned an invalid app ID.')
  }
  return result
}
