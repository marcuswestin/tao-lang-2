import { CLI, Errors, FS, HCI, Platform, Time } from '@shared'
import type { Writable } from 'node:stream'

type FirebaseResult = { exitCode: number | null; stdout: string; stderr: string }
export type FirebaseRunner = (args: readonly string[], cwd: string, interactive: boolean) => Promise<FirebaseResult>

type FirebasePrompts = { text: (message: string) => Promise<string> }
type FirebaseConfig =
  & Record<'projectId' | 'apiKey' | 'appId' | 'authDomain', string>
  & Partial<Record<'storageBucket' | 'messagingSenderId', string>>

type FirebaseProvisionOptions = {
  project: string
  currentProjectId?: string
  prompts: FirebasePrompts
  output?: Writable
  runner?: FirebaseRunner
  /** Replaces the pause between deploy attempts for focused command tests. */
  sleep?: (milliseconds: number) => Promise<void>
}

/** A project created seconds earlier answers 403 until Google propagates its permissions and APIs. */
const DEPLOY_ATTEMPTS = 10
const DEPLOY_RETRY_MILLISECONDS = 10_000

/** Provisions the disposable Hosted CRUD Firebase backend through Google's supported CLI. */
export async function provisionFirebase(options: FirebaseProvisionOptions): Promise<FirebaseConfig> {
  const run = options.runner ?? runFirebaseCli
  const work = FS.resolvePath('.tao/firebase-connect', options.project)
  const configPath = FS.resolvePath('firebase.json', work)
  const rulesPath = FS.resolvePath('firestore.rules', work)
  if (await FS.isSymbolicLink(work) || await FS.isSymbolicLink(configPath) || await FS.isSymbolicLink(rulesPath)) {
    Errors.throwUserInput('Firebase setup files cannot be symbolic links; no cloud changes were made.')
  }
  const sourceDirectory = FS.resolvePath('src', options.project)
  const firebaseDirectory = FS.resolvePath('firebase', sourceDirectory)
  const sourceRules = FS.resolvePath('src/firebase/firestore.rules', options.project)
  for (
    const [entry, kind] of [
      [sourceDirectory, 'directory'],
      [firebaseDirectory, 'directory'],
      [sourceRules, 'file'],
    ] as const
  ) {
    if (await FS.isSymbolicLink(entry)) {
      Errors.throwUserInput('Firebase pilot rules cannot use symbolic links; no cloud changes were made.')
    }
    if (!await FS.exists(entry) || (await FS.entryMetadata(entry)).kind !== kind) {
      Errors.throwUserInput('Firebase automation needs a regular src/firebase/firestore.rules in this pilot app.')
    }
  }
  if (!FS.pathIsWithin(await FS.realPath(sourceRules), await FS.realPath(options.project))) {
    Errors.throwUserInput('Firebase pilot rules must stay inside the project; no cloud changes were made.')
  }
  await FS.mkdir(work)

  const out = { output: options.output }
  let accounts = await firebaseJson(run, work, ['login:list'], 'check Firebase sign-in')
  if (!Array.isArray(accounts) || accounts.length === 0) {
    HCI.writeLine('A browser will open for one-time Google sign-in to the Firebase CLI.', out)
    HCI.writeLine('Gemini in Firebase and Firebase CLI usage reporting stay off.', out)
    // --reauth skips firebase-tools' two opt-in consent prompts and leaves both settings unset, which it reads as off.
    const login = await run(['login', '--reauth'], work, true)
    if (login.exitCode !== 0) {
      Errors.throwHostEnvironment('Firebase sign-in did not finish. Retry ./tao connect firebase after signing in.')
    }
    accounts = await firebaseJson(run, work, ['login:list'], 'check Firebase sign-in')
    if (!Array.isArray(accounts) || accounts.length === 0) {
      Errors.throwHostEnvironment('Firebase CLI did not retain a Google sign-in.')
    }
  }

  HCI.writeLine('Listing Firebase projects on this Google account…', out)
  const projects = await firebaseJson(run, work, ['projects:list'], 'list Firebase projects')
  if (!Array.isArray(projects)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected project list.')
  }
  const known = projects.filter(isRecord).map(value => value['projectId']).filter((value): value is string =>
    typeof value === 'string'
  )
  if (known.length > 0) {
    HCI.writeLine(`Firebase projects on this Google account: ${known.join(', ')}`, out)
  }
  // A placeholder left in the template connection file is not a project to reuse, so the default then
  // creates a fresh project under a generated, globally unique ID.
  const current = options.currentProjectId?.includes('REPLACE_WITH') ? undefined : options.currentProjectId
  const generated = `tao-hosted-crud-${Platform.randomUUID().replaceAll('-', '').slice(0, 6)}`
  const entered = (await options.prompts.text(
    current
      ? `Firebase project ID (Return to reuse ${current}, or type another ID)`
      : `Firebase project ID (Return to create new project ${generated}, or type an existing ID)`,
  )).trim()
  const projectId = entered || current || generated
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    Errors.throwUserInput(
      'Firebase project ID must be 6–30 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit.',
    )
  }
  const existingProject = known.includes(projectId)
  if (!existingProject) {
    // Return on the generated default already chose creation; a typed or remembered ID may be a typo.
    if (projectId !== generated) {
      const answer =
        (await options.prompts.text(`Create Firebase project ${projectId} on this Google account? Type yes`)).trim()
      if (answer !== 'yes') {
        Errors.throwUserInput('Firebase project creation was cancelled; no connection was saved.')
      }
    }
    HCI.writeLine(`Creating Firebase project ${projectId}… This usually takes about a minute.`, out)
    await firebaseJson(
      run,
      work,
      ['projects:create', projectId, '--display-name', 'Tao Hosted CRUD Demo'],
      `create Firebase project ${projectId}`,
    )
    HCI.writeLine(`Created Firebase project ${projectId}.`, out)
  }

  const apps = await firebaseJson(run, work, ['apps:list', 'WEB', '--project', projectId], 'list Firebase web apps')
  if (!Array.isArray(apps)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected web app list.')
  }
  const webApps = apps.filter(isRecord).filter(app => typeof app['appId'] === 'string')
  let app = webApps.find(value => value['displayName'] === 'Tao Hosted CRUD Demo')
  if (!app && webApps.length === 1) {
    app = webApps[0]
  }
  if (!app && webApps.length > 1) {
    HCI.writeLine(`Web app IDs: ${webApps.map(value => value['appId']).join(', ')}`, out)
    const selected = (await options.prompts.text('Reuse a web app ID, or press Return to create Tao Hosted CRUD Demo'))
      .trim()
    if (selected) {
      app = webApps.find(value => value['appId'] === selected)
      if (!app) {
        Errors.throwUserInput('That Firebase web app ID is not in the selected project.')
      }
    }
  }
  if (!app) {
    HCI.writeLine('Registering the Firebase web app Tao Hosted CRUD Demo… This can take up to a minute.', out)
    const created = await firebaseJson(run, work, [
      'apps:create',
      'WEB',
      'Tao Hosted CRUD Demo',
      '--project',
      projectId,
    ], 'register a Firebase web app')
    if (!isRecord(created) || typeof created['appId'] !== 'string') {
      Errors.throwHostEnvironment('Firebase CLI did not return the new web app ID.')
    }
    app = created
    HCI.writeLine('Registered a Firebase web app. Firebase Hosting was not configured.', out)
  }
  const appId = app['appId'] as string
  const sdk = await firebaseJson(run, work, [
    'apps:sdkconfig',
    'WEB',
    appId,
    '--project',
    projectId,
  ], 'read Firebase web app configuration')
  const rawConfig = isRecord(sdk) ? sdk['sdkConfig'] : undefined
  if (!isRecord(rawConfig)) {
    Errors.throwHostEnvironment('Firebase CLI did not return web app configuration.')
  }
  const config = firebaseConfig(rawConfig)
  if (config.projectId !== projectId || config.appId !== appId) {
    Errors.throwHostEnvironment('Firebase returned web app configuration for a different project or app.')
  }

  const databases = await listFirestoreDatabases(run, work, projectId)
  const defaultDatabase = databases.filter(isRecord).find(value =>
    typeof value['name'] === 'string' && value['name'].endsWith('/databases/(default)')
  )
  if (defaultDatabase && defaultDatabase['type'] !== undefined && defaultDatabase['type'] !== 'FIRESTORE_NATIVE') {
    Errors.throwUserInput('The default Firestore database is not in Native mode; this pilot cannot use it.')
  }
  let location: string | undefined
  if (!defaultDatabase) {
    location = (await options.prompts.text(
      'Firestore region (Return for nam5, the United States multi-region; permanent)',
    )).trim() || 'nam5'
    if (!/^[a-z][a-z0-9-]+[a-z0-9]$/u.test(location)) {
      Errors.throwUserInput('Enter a Firestore location such as us-central1 or nam5.')
    }
  } else {
    HCI.writeLine('This project already has a default Firestore database.', out)
    const answer = (await options.prompts.text(
      'Replace its Firestore rules with the Hosted CRUD pilot rules and enable Email/Password auth? Type yes',
    )).trim()
    if (answer !== 'yes') {
      Errors.throwUserInput('Firebase rules deployment was cancelled; no connection was saved.')
    }
  }

  await FS.writeText(rulesPath, await FS.readText(sourceRules))
  // Deploy enables the Firestore API and, given a location, creates the missing default database; a new project
  // has the API disabled, so the standalone database commands would fail before either exists.
  await FS.writeJson(configPath, {
    auth: { providers: { emailPassword: true } },
    firestore: location ? { rules: 'firestore.rules', location } : { rules: 'firestore.rules' },
  })
  HCI.writeLine(
    location
      ? `Enabling Firestore, creating its database in ${location}, enabling Email/Password auth, and deploying rules… This can take a few minutes.`
      : 'Enabling Email/Password auth and deploying the Hosted CRUD Firestore rules… This can take a minute.',
    out,
  )
  const deploy = ['deploy', '--only', 'auth,firestore:rules', '--project', projectId, '--config', configPath]
  for (let attempt = 1;; attempt++) {
    try {
      await firebaseJson(run, work, deploy, 'deploy Firebase Auth and Firestore rules')
      break
    } catch (error) {
      if (attempt === DEPLOY_ATTEMPTS || !(error instanceof Error) || !/HTTP Error: 403\b/u.test(error.message)) {
        throw error
      }
      HCI.writeLine(
        `Waiting for Firebase project to finish setup. Retrying in ${
          DEPLOY_RETRY_MILLISECONDS / 1000
        } seconds (attempt ${attempt + 1} of ${DEPLOY_ATTEMPTS})…`,
        out,
      )
      await (options.sleep ?? Time.sleep)(DEPLOY_RETRY_MILLISECONDS)
    }
  }
  HCI.writeLine(
    location
      ? `Created the default Firestore database in ${location}, enabled Email/Password auth, and deployed the Hosted CRUD Firestore rules.`
      : 'Enabled Email/Password auth and deployed the Hosted CRUD Firestore rules.',
    out,
  )
  return config
}

function firebaseConfig(config: Record<string, unknown>): FirebaseConfig {
  const fields: Partial<FirebaseConfig> = {}
  for (const key of ['projectId', 'apiKey', 'appId', 'authDomain'] as const) {
    const value = config[key]
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwHostEnvironment(`Firebase CLI returned an invalid ${key} in the web app configuration.`)
    }
    fields[key] = value
  }
  for (const key of ['storageBucket', 'messagingSenderId'] as const) {
    const value = config[key]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwHostEnvironment(`Firebase CLI returned an invalid ${key} in the web app configuration.`)
    }
    fields[key] = value
  }
  return fields as FirebaseConfig
}

async function firebaseJson(
  run: FirebaseRunner,
  cwd: string,
  args: readonly string[],
  action: string,
): Promise<unknown> {
  const result = await run([...args, '--json'], cwd, false)
  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch {
    Errors.throwHostEnvironment(`Firebase CLI could not ${action}; it returned no JSON result.`)
  }
  if (!isRecord(response)) {
    Errors.throwHostEnvironment(`Firebase CLI could not ${action}; it returned an unexpected result.`)
  }
  if (result.exitCode !== 0 || response['status'] !== 'success') {
    Errors.throwHostEnvironment(`Firebase CLI could not ${action}: ${firebaseErrorMessage(response)}`)
  }
  return response['result']
}

/** firebaseErrorMessage names what Firebase reported; the CLI's JSON carries it as a string or an object. */
function firebaseErrorMessage(response: Record<string, unknown>): string {
  const error = response['error']
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }
  if (isRecord(error) && typeof error['message'] === 'string') {
    return error['message']
  }
  return 'Check the selected Google account, project permissions, and Firebase CLI login.'
}

/** listFirestoreDatabases reads a new project's disabled Firestore API as having no databases yet. */
async function listFirestoreDatabases(run: FirebaseRunner, cwd: string, projectId: string): Promise<unknown[]> {
  const args = ['firestore:databases:list', '--project', projectId, '--json']
  const result = await run(args, cwd, false)
  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch {
    Errors.throwHostEnvironment('Firebase CLI could not list Firestore databases; it returned no JSON result.')
  }
  if (isRecord(response) && response['status'] !== 'success') {
    const message = firebaseErrorMessage(response)
    if (/Cloud Firestore API has not been used in project|SERVICE_DISABLED/u.test(message)) {
      return []
    }
    Errors.throwHostEnvironment(`Firebase CLI could not list Firestore databases: ${message}`)
  }
  const databases = isRecord(response) ? response['result'] : undefined
  if (result.exitCode !== 0 || !Array.isArray(databases)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected Firestore database list.')
  }
  return databases
}

async function runFirebaseCli(args: readonly string[], cwd: string, interactive: boolean): Promise<FirebaseResult> {
  const binary = FS.fileUrlToPath(import.meta.resolve('firebase-tools/lib/bin/firebase.js'))
  const result = await CLI.run('node', {
    args: [binary, ...args],
    cwd,
    stdio: interactive ? 'inherit' : 'pipe',
  })
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
