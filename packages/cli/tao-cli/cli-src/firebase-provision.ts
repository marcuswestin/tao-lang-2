import { CLI, Errors, FS, HCI } from '@shared'
import type { Writable } from 'node:stream'

type FirebaseResult = { exitCode: number | null; stdout: string; stderr: string }
export type FirebaseRunner = (args: readonly string[], cwd: string, interactive: boolean) => Promise<FirebaseResult>

type FirebasePrompts = { text: (message: string) => Promise<string> }
type FirebaseConfig = Record<'projectId' | 'apiKey' | 'appId' | 'authDomain', string>

type FirebaseProvisionOptions = {
  project: string
  currentProjectId?: string
  prompts: FirebasePrompts
  output?: Writable
  runner?: FirebaseRunner
}

/** Provisions the disposable Hosted CRUD Firebase backend through Google's supported CLI. */
export async function provisionFirebase(options: FirebaseProvisionOptions): Promise<FirebaseConfig> {
  const run = options.runner ?? runFirebaseCli
  const work = FS.resolvePath('.tao/firebase-connect', options.project)
  const configPath = FS.resolvePath('firebase.json', work)
  const rulesPath = FS.resolvePath('firestore.rules', work)
  if (await FS.isSymbolicLink(work) || await FS.isSymbolicLink(configPath) || await FS.isSymbolicLink(rulesPath)) {
    Errors.throwUserInput('Firebase setup files cannot be symbolic links; no cloud changes were made.')
  }
  const sourceRules = FS.resolvePath('src/firebase/firestore.rules', options.project)
  if (!await FS.isFile(sourceRules)) {
    Errors.throwUserInput('Firebase automation needs src/firebase/firestore.rules in this pilot app.')
  }
  await FS.mkdir(work)

  const out = { output: options.output }
  let accounts = await firebaseJson(run, work, ['login:list'], 'check Firebase sign-in')
  if (!Array.isArray(accounts) || accounts.length === 0) {
    HCI.writeLine('A browser will open for one-time Google sign-in to the Firebase CLI.', out)
    const login = await run(['login'], work, true)
    if (login.exitCode !== 0) {
      Errors.throwHostEnvironment('Firebase sign-in did not finish. Retry ./tao connect firebase after signing in.')
    }
    accounts = await firebaseJson(run, work, ['login:list'], 'check Firebase sign-in')
    if (!Array.isArray(accounts) || accounts.length === 0) {
      Errors.throwHostEnvironment('Firebase CLI did not retain a Google sign-in.')
    }
  }

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
  const suggested = options.currentProjectId ? ` (Return for ${options.currentProjectId})` : ''
  const entered = (await options.prompts.text(`Firebase project ID${suggested}:`)).trim()
  const projectId = entered || options.currentProjectId || ''
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
    Errors.throwUserInput(
      'Firebase project ID must be 6–30 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit.',
    )
  }
  const existingProject = known.includes(projectId)
  if (!existingProject) {
    const answer =
      (await options.prompts.text(`Create Firebase project ${projectId} on this Google account? Type yes:`)).trim()
    if (answer !== 'yes') {
      Errors.throwUserInput('Firebase project creation was cancelled; no connection was saved.')
    }
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
    const selected = (await options.prompts.text('Reuse a web app ID, or press Return to create Tao Hosted CRUD Demo:'))
      .trim()
    if (selected) {
      app = webApps.find(value => value['appId'] === selected)
      if (!app) {
        Errors.throwUserInput('That Firebase web app ID is not in the selected project.')
      }
    }
  }
  if (!app) {
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

  const databases = await firebaseJson(
    run,
    work,
    ['firestore:databases:list', '--project', projectId],
    'list Firestore databases',
  )
  if (!Array.isArray(databases)) {
    Errors.throwHostEnvironment('Firebase CLI returned an unexpected Firestore database list.')
  }
  const defaultDatabase = databases.filter(isRecord).find(value =>
    typeof value['name'] === 'string' && value['name'].endsWith('/databases/(default)')
  )
  if (defaultDatabase && defaultDatabase['type'] !== undefined && defaultDatabase['type'] !== 'FIRESTORE_NATIVE') {
    Errors.throwUserInput('The default Firestore database is not in Native mode; this pilot cannot use it.')
  }
  if (!defaultDatabase) {
    const location = (await options.prompts.text('Firestore region (for example us-central1 or nam5; permanent):'))
      .trim()
    if (!/^[a-z][a-z0-9-]+[a-z0-9]$/u.test(location)) {
      Errors.throwUserInput('Enter a Firestore location such as us-central1 or nam5.')
    }
    await firebaseJson(run, work, [
      'firestore:databases:create',
      '(default)',
      '--location',
      location,
      '--project',
      projectId,
    ], 'create the default Firestore database')
    HCI.writeLine(`Created the default Firestore database in ${location}.`, out)
  } else {
    HCI.writeLine('This project already has a default Firestore database.', out)
    const answer = (await options.prompts.text(
      'Replace its Firestore rules with the Hosted CRUD pilot rules and enable Email/Password auth? Type yes:',
    )).trim()
    if (answer !== 'yes') {
      Errors.throwUserInput('Firebase rules deployment was cancelled; no connection was saved.')
    }
  }

  await FS.writeText(rulesPath, await FS.readText(sourceRules))
  await FS.writeJson(configPath, {
    auth: { providers: { emailPassword: true } },
    firestore: { rules: 'firestore.rules' },
  })
  await firebaseJson(run, work, [
    'deploy',
    '--only',
    'auth,firestore:rules',
    '--project',
    projectId,
    '--config',
    configPath,
  ], 'deploy Firebase Auth and Firestore rules')
  HCI.writeLine('Enabled Email/Password auth and deployed the Hosted CRUD Firestore rules.', out)
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
    const issue = isRecord(response['error']) && typeof response['error']['message'] === 'string'
      ? response['error']['message']
      : 'Check the selected Google account, project permissions, and Firebase CLI login.'
    Errors.throwHostEnvironment(`Firebase CLI could not ${action}: ${issue}`)
  }
  return response['result']
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
