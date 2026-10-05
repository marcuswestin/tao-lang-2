import { Errors, FS, HCI, Platform, Time } from '@shared'
import type { Writable } from 'node:stream'
import {
  type FirebaseInspection,
  firebaseInspectionFailure,
  type FirebaseInspector,
  inspectFirebase,
  listFirebaseAccounts,
} from './firebase-inspection'
import { composeFirebasePilotRules } from './firebase-rules'

import { firebaseJson, type FirebaseRunner, runFirebaseCli } from './firebase-cli'
export { firebaseCreationProgress, type FirebaseRunner } from './firebase-cli'
type Choice = { value: string; label: string }
type FirebasePrompts = {
  text: (message: string, defaultValue?: string) => Promise<string>
  choice?: (message: string, choices: readonly Choice[], defaultValue?: string) => Promise<string>
}
type FirebaseConfig =
  & Record<'projectId' | 'apiKey' | 'appId' | 'authDomain', string>
  & Partial<Record<'storageBucket' | 'messagingSenderId', string>>
type FirebaseProvisionOptions = {
  project: string
  currentProjectId?: string
  currentAppId?: string
  backend?: {
    files: Record<'firestore.rules' | 'firestore.indexes.json', string>
    displayName: string
    documentMatch?: string
  }
  rulesFile?: string
  prompts: FirebasePrompts
  output?: Writable
  runner?: FirebaseRunner
  inspector?: FirebaseInspector
  sleep?: (milliseconds: number) => Promise<void>
}
const DEPLOY_ATTEMPTS = 10
const DEPLOY_RETRY_MILLISECONDS = 10_000

/** Configure a generated app backend or the Hosted CRUD pilot, retaining public connection identity. */
export async function provisionFirebase(options: FirebaseProvisionOptions): Promise<FirebaseConfig> {
  if (Object.hasOwn(Platform.runtimeProcess.env, 'FIREBASE_TOKEN')) {
    Errors.throwUserInput(
      'Unset FIREBASE_TOKEN in your local terminal before connecting. Firebase setup uses your locally signed-in Google account; no cloud calls were made.',
    )
  }
  const work = FS.resolvePath('.tao/firebase-connect', options.project)
  await safeSetupPaths(options.project, work)
  const generated = options.backend?.files['firestore.rules'] ?? await pilotRules(options.project)
  let candidate = options.rulesFile ? await reviewedRules(options.rulesFile, options.project) : generated
  if (!candidate.trim()) {
    Errors.throwUserInput('Firebase rules are empty; no cloud changes were made.')
  }
  await FS.mkdir(work)
  const out = { output: options.output }
  let stage = 'local setup validation'
  let mutationAttempted = false
  try {
    const rawRun = options.runner
      ?? ((args, cwd, interactive) => runFirebaseCli(args, cwd, interactive, options.output))
    HCI.writeLine('Checking local Firebase CLI sign-in…', out)
    const readAccounts = () =>
      options.runner ? firebaseJson(rawRun, work, ['login:list'], 'check Firebase sign-in') : listFirebaseAccounts(work)
    let accounts = await readAccounts()
    if (!Array.isArray(accounts) || accounts.length === 0) {
      HCI.writeLine('A browser will open for local Google sign-in to the Firebase CLI. Complete sign-in there.', out)
      HCI.writeLine('Complete the official local sign-in flow; existing Firebase CLI preferences are retained.', out)
      const login = await rawRun(['login', '--reauth'], work, true)
      if (login.exitCode !== 0) {
        Errors.throwHostEnvironment('Firebase sign-in did not finish. Retry ./tao connect firebase after signing in.')
      }
      accounts = await readAccounts()
    }
    if (!Array.isArray(accounts)) {
      Errors.throwHostEnvironment('Firebase CLI returned an unexpected account list.')
    }
    const emails = accounts.filter(isRecord).map(value => value['user']).filter(isRecord)
      .map(value => value['email']).filter((value): value is string => typeof value === 'string' && !!value)
    if (!emails.length) {
      Errors.throwHostEnvironment('Firebase CLI did not retain a Google sign-in.')
    }
    const account = emails.length === 1
      ? emails[0]!
      : await choose(
        options,
        'Choose the signed-in Google account',
        emails.map(value => ({ value, label: value })),
        emails[0]!,
      )
    const run: FirebaseRunner = (args, cwd, interactive) => rawRun([...args, '--account', account], cwd, interactive)
    stage = 'local Firebase CLI sign-in'
    HCI.writeLine('Listing Firebase projects on the selected account…', out)
    const projects = await firebaseJson(run, work, ['projects:list'], 'list Firebase projects')
    if (!Array.isArray(projects)) {
      Errors.throwHostEnvironment('Firebase CLI returned an unexpected project list.')
    }
    if (
      !projects.every(value =>
        isRecord(value) && typeof value['projectId'] === 'string'
        && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(value['projectId'])
      )
    ) {
      Errors.throwHostEnvironment('Firebase CLI returned an invalid project ID; no project was selected.')
    }
    const known = projects.filter(isRecord).filter(value => typeof value['projectId'] === 'string')
    const saved = known.find(value => value['projectId'] === options.currentProjectId)
    const choices = known.map(value => ({
      value: String(value['projectId']),
      label: 'Reuse ' + String(value['displayName'] ?? value['projectId']) + ' (' + String(value['projectId']) + ')',
    }))
    choices.push({ value: '__create__', label: 'Create a new Firebase project' })
    if (!known.length) {
      choices.unshift({ value: '__cancel__', label: 'Stop and add or request access to a Firebase project' })
    }
    HCI.writeLine(
      'Reuse a project from https://console.firebase.google.com. Creating another project uses your account quota.',
      out,
    )
    let projectId = await choose(
      options,
      'Choose the Firebase project',
      choices,
      String(saved?.['projectId'] ?? known[0]?.['projectId'] ?? '__cancel__'),
    )
    if (projectId === '__cancel__') {
      Errors.throwUserInput('Firebase setup stopped; no cloud changes were made.')
    }
    const createdProject = projectId === '__create__'
    if (createdProject) {
      const slug = (options.backend?.displayName ?? 'hosted-crud').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(
        /^-+|-+$/gu,
        '',
      ).slice(0, 17).replace(/-+$/u, '') || 'project'
      const proposedId = 'tao-' + slug + '-' + Platform.randomUUID().slice(0, 8)
      HCI.writeLine('Press Enter to use the proposed project ID, or type another ID.', out)
      projectId = (await options.prompts.text(
        'Enter a globally unique Firebase project ID (6–30 lowercase letters, digits, or hyphens)',
        proposedId,
      )).trim() || proposedId
      if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId)) {
        Errors.throwUserInput(
          'Firebase project ID must be 6–30 lowercase letters, digits, or hyphens, starting with a letter and ending with a letter or digit.',
        )
      }
      await confirm(options, 'Create Firebase project ' + projectId + '?')
      HCI.writeLine('Creating Firebase project ' + projectId + '… This usually takes about a minute.', out)
      HCI.writeLine('Firebase CLI is creating the Google Cloud project, then adding Firebase resources…', out)
      mutationAttempted = true
      await firebaseJson(run, work, [
        'projects:create',
        projectId,
        '--display-name',
        options.backend?.displayName ?? 'Tao Hosted CRUD Demo',
      ], 'create Firebase project')
      HCI.writeLine('Google Cloud project created and Firebase resources added.', out)
    }
    stage = 'project selection (' + projectId + ')'
    const inspect = options.inspector ?? inspectFirebase
    const request = { projectId, account, cwd: work }
    HCI.writeLine('Inspecting the default database, Auth settings, and deployed Firestore rules before changes…', out)
    const before = await inspectNewProject()
    async function inspectNewProject(): Promise<FirebaseInspection> {
      for (let attempt = 1;; attempt++) {
        try {
          return await inspect(request)
        } catch (error) {
          const failure = firebaseInspectionFailure(error)
          const transient = failure?.status === 429
            || (failure?.status !== null && failure?.status !== undefined && failure.status >= 500)
            || (failure?.status === 403 && ['PERMISSION_DENIED', 'IAM_PERMISSION_DENIED'].includes(failure.code))
          if (!createdProject || !transient || attempt >= DEPLOY_ATTEMPTS || failure?.stage === 'account') {
            throw error
          }
          HCI.writeLine(
            'Waiting for the new Firebase project to become available after ' + failure!.stage + ' returned HTTP '
              + failure!.status + ' (' + failure!.code + '). Rechecking in 10 seconds (attempt ' + (attempt + 1)
              + ' of ' + DEPLOY_ATTEMPTS + ')…',
            out,
          )
          await (options.sleep ?? Time.sleep)(DEPLOY_RETRY_MILLISECONDS)
          HCI.writeLine('Rechecking the default database, Auth settings, and deployed Firestore rules…', out)
        }
      }
    }
    validateDatabase(before)
    const backup = FS.resolvePath(projectId + '.current.rules', work)
    const candidatePath = FS.resolvePath(projectId + '.candidate.rules', work)
    const recordedPath = FS.resolvePath(projectId + '.accepted.rules', work)
    const receiptPath = FS.resolvePath(projectId + '.accepted.json', work)
    const owner = options.backend?.displayName ?? 'Hosted CRUD pilot'
    const generatedSha256 = Platform.sha256Hex(generated)
    await assertRegularPaths([backup, candidatePath, recordedPath, receiptPath])
    if (before.rules) {
      await FS.writeText(backup, before.rules.source)
    }
    const recorded = await FS.exists(recordedPath) ? await FS.readText(recordedPath) : undefined
    const receipt = await FS.exists(receiptPath) ? await FS.readJson<unknown>(receiptPath) : undefined
    const owned = isRecord(receipt) && typeof recorded === 'string' && receipt['projectId'] === projectId
      && receipt['owner'] === owner && receipt['sha256'] === Platform.sha256Hex(recorded)
      && (options.currentAppId === undefined || receipt['appId'] === options.currentAppId)
      && before.rules?.source === recorded
    let sourceKind = options.rulesFile ? 'reviewed' : 'generated'
    if (
      !options.rulesFile && owned && isRecord(receipt) && receipt['sourceKind'] === 'reviewed'
      && receipt['generatedSha256'] === generatedSha256
    ) {
      candidate = recorded!
      sourceKind = 'reviewed'
    }
    const composed = !options.rulesFile && options.backend?.documentMatch && before.rules
      ? composeFirebasePilotRules(before.rules.source, options.backend.documentMatch, owned ? recorded : undefined)
      : undefined
    if (composed) {
      candidate = composed
      sourceKind = 'pilot-composed'
      HCI.writeLine(
        'The audited Hosted CRUD notes policy will be preserved; generated stores rules will be added.',
        out,
      )
    }
    await FS.writeText(candidatePath, candidate)
    if (
      before.rules && before.rules.source !== candidate
      && !(owned && isRecord(receipt) && receipt['sourceKind'] === 'generated')
      && !denyAll(before.rules.source) && !options.rulesFile && !composed
    ) {
      Errors.throwUserInput(
        'Existing Firestore rules need review. Current rules: ' + backup + '. Generated candidate: ' + candidatePath
          + '. Edit the candidate to preserve the current rules and add the generated app policy. After reviewing it, resume with: '
          + recoveryCommand(options, candidatePath) + '. No deployment was attempted.',
      )
    }
    stage = 'database, Auth, and rules inspection with local backup'
    let location: string | undefined
    if (!before.database) {
      HCI.writeLine(
        'The new (default) database will use Native mode and Standard edition. No billing upgrade is requested.',
        out,
      )
      HCI.writeLine('Its storage location is permanent. See https://firebase.google.com/docs/firestore/locations.', out)
      const region = await choose(options, 'Choose the permanent Firestore location', [
        { value: 'nam5', label: 'nam5 — United States multi-region' },
        { value: '__custom__', label: 'Enter another supported location ID' },
      ], 'nam5')
      location = region === '__custom__'
        ? (await options.prompts.text('Supported Firestore location ID, such as us-central1')).trim()
        : region
      if (!/^[a-z][a-z0-9-]+[a-z0-9]$/u.test(location)) {
        Errors.throwUserInput('Enter a supported Firestore location such as us-central1 or nam5.')
      }
    }
    HCI.writeLine('Listing Firebase web apps…', out)
    const listedApps = await firebaseJson(
      run,
      work,
      ['apps:list', 'WEB', '--project', projectId],
      'list Firebase web apps',
    )
    if (!Array.isArray(listedApps)) {
      Errors.throwHostEnvironment('Firebase CLI returned an unexpected web app list.')
    }
    if (!listedApps.every(value => isRecord(value) && validAppId(value['appId']))) {
      Errors.throwHostEnvironment('Firebase CLI returned an invalid web app ID.')
    }
    const apps = listedApps.filter(isRecord).filter(value => typeof value['appId'] === 'string')
    const appChoices = apps.map(value => ({
      value: String(value['appId']),
      label: 'Reuse ' + String(value['displayName'] ?? 'Web app') + ' (' + String(value['appId']) + ')',
    }))
    appChoices.push({ value: '__create__', label: 'Register a new Firebase web app' })
    const savedApp = apps.find(value => value['appId'] === options.currentAppId)
    let appId = apps.length
      ? await choose(
        options,
        'Choose the Firebase web app',
        appChoices,
        String(savedApp?.['appId'] ?? apps[0]!['appId']),
      )
      : '__create__'
    if (appId === '__create__') {
      if (!apps.length) {
        await confirm(options, 'Register the first Firebase web app in this project?')
      }
      HCI.writeLine('Registering the Firebase web app…', out)
      mutationAttempted = true
      const created = await firebaseJson(run, work, [
        'apps:create',
        'WEB',
        options.backend?.displayName ?? 'Tao Hosted CRUD Demo',
        '--project',
        projectId,
      ], 'register a Firebase web app')
      if (!isRecord(created) || !validAppId(created['appId'])) {
        Errors.throwHostEnvironment('Firebase CLI did not return the new web app ID.')
      }
      appId = created['appId']
    }
    const sdk = await firebaseJson(
      run,
      work,
      ['apps:sdkconfig', 'WEB', appId, '--project', projectId],
      'read Firebase web app configuration',
    )
    const rawConfig = isRecord(sdk) ? sdk['sdkConfig'] : undefined
    if (!isRecord(rawConfig)) {
      Errors.throwHostEnvironment('Firebase CLI did not return web app configuration.')
    }
    const config = firebaseConfig(rawConfig)
    if (config.projectId !== projectId || config.appId !== appId) {
      Errors.throwHostEnvironment('Firebase returned web app configuration for a different project or app.')
    }
    if (
      !options.rulesFile && owned && isRecord(receipt) && receipt['appId'] !== appId
      && before.rules?.source !== candidate
    ) {
      Errors.throwUserInput(
        'These previously recorded rules belong to another Firebase web app. Edit the generated candidate to preserve existing routes, then review and resume with: '
          + recoveryCommand(options, candidatePath) + '. No deployment was attempted.',
      )
    }
    stage = 'web app selection and public SDK configuration'
    const rulesPath = FS.resolvePath('firestore.rules', work)
    const configPath = FS.resolvePath('firebase.json', work)
    await FS.writeText(rulesPath, candidate)
    if (options.backend) {
      await FS.writeText(
        FS.resolvePath('firestore.indexes.json', work),
        options.backend.files['firestore.indexes.json'],
      )
    }
    // Current generated backends require no indexes. Omitting indexes preserves all remote indexes.
    await FS.writeJson(configPath, {
      ...(!before.auth.emailPasswordEnabled ? { auth: { providers: { emailPassword: true } } } : {}),
      firestore: {
        database: '(default)',
        edition: 'standard',
        rules: 'firestore.rules',
        ...(location ? { location } : {}),
      },
    })
    const scopes = before.auth.emailPasswordEnabled ? 'firestore:rules' : 'auth,firestore:rules'
    HCI.writeLine('Firebase deployment plan:', out)
    HCI.writeLine('Project: ' + projectId + '; web app: ' + appId + '; Google account: ' + account, out)
    HCI.writeLine(
      'Database: (default), Native mode, Standard edition, location: ' + (before.database?.locationId ?? location),
      out,
    )
    HCI.writeLine(
      'Auth: ' + (before.auth.emailPasswordEnabled
        ? 'keep existing Email/Password setting'
        : 'enable Email/Password; preserve other providers and settings'),
      out,
    )
    HCI.writeLine(
      'Rules candidate: ' + candidatePath + '; current backup: ' + (before.rules ? backup : 'no deployed release'),
      out,
    )
    HCI.writeLine('Existing indexes and billing plan will be preserved.', out)
    await confirm(options, 'Apply this Firebase deployment plan?')
    const deploy = ['deploy', '--only', scopes, '--project', projectId, '--config', configPath, '--non-interactive']
    let previous = before
    for (let attempt = 1;; attempt++) {
      HCI.writeLine('Rechecking deployed Firestore rules before deployment…', out)
      const fresh = await inspect(request)
      if (
        !sameRelease(fresh, previous) || stable(fresh.database) !== stable(previous.database)
        || stable(fresh.auth.preserved) !== stable(previous.auth.preserved)
        || (previous.auth.emailPasswordEnabled
          && fresh.auth.emailPasswordRequired !== previous.auth.emailPasswordRequired)
      ) {
        Errors.throwUserInput(
          'Firebase rules or Auth settings changed during setup. Inspect the new remote state and retry; deployment was stopped.',
        )
      }
      validateDatabase(fresh)
      HCI.writeLine(
        'Deploying the generated rules and required Email/Password Auth setting… This can take a few minutes.',
        out,
      )
      mutationAttempted = true
      try {
        await firebaseJson(run, work, deploy, 'deploy Firebase Auth and Firestore rules')
        break
      } catch (error) {
        if (attempt === DEPLOY_ATTEMPTS || !(error instanceof Error) || !/HTTP Error: 403\b/u.test(error.message)) {
          throw error
        }
        const afterAttempt = await inspect(request)
        if (!sameRelease(afterAttempt, fresh) && afterAttempt.rules?.source !== candidate) {
          Errors.throwUserInput(
            'Firestore rules changed during the failed deploy. Review remote rules before retrying.',
          )
        }
        previous = afterAttempt
        HCI.writeLine(
          'Waiting for Firebase setup propagation. Retrying in ' + DEPLOY_RETRY_MILLISECONDS / 1000
            + ' seconds (attempt ' + (attempt + 1) + ' of ' + DEPLOY_ATTEMPTS + ')…',
          out,
        )
        await (options.sleep ?? Time.sleep)(DEPLOY_RETRY_MILLISECONDS)
      }
    }
    stage = 'Firebase deployment'
    HCI.writeLine('Checking deployed database mode, Auth providers, and Firestore rules…', out)
    const after = await inspect(request)
    validateDatabase(after)
    if (
      !after.database || !after.auth.emailPasswordEnabled || after.rules?.source !== candidate
      || (before.auth.preserved !== null && stable(after.auth.preserved) !== stable(before.auth.preserved))
      || after.database.locationId !== (before.database?.locationId ?? location)
      || (before.auth.emailPasswordEnabled && after.auth.emailPasswordRequired !== before.auth.emailPasswordRequired)
    ) {
      Errors.throwHostEnvironment(
        'Firebase deployment finished, but its database, rules, or preserved Auth settings did not pass inspection. No connection was saved.',
      )
    }
    await FS.writeText(recordedPath, candidate)
    await assertRegularPaths([receiptPath])
    await FS.writeJson(receiptPath, {
      projectId,
      appId,
      rulesetName: after.rules.rulesetName,
      sha256: Platform.sha256Hex(candidate),
      owner,
      generatedSha256,
      sourceKind,
    })
    HCI.writeLine(
      'Verified the default Native Standard database, Email/Password Auth, and deployed Firestore rules. Existing indexes were preserved.',
      out,
    )
    return config
  } catch (error) {
    HCI.writeLine(
      'Firebase setup stopped. Completed: ' + stage + '. ' + (mutationAttempted
        ? 'Cloud resources may already have changed; retry reuses existing resources and inspects remote state.'
        : 'No cloud mutation was attempted.')
        + ' No connection was saved.',
      out,
    )
    throw error
  }
}

async function choose(
  options: FirebaseProvisionOptions,
  message: string,
  choices: readonly Choice[],
  defaultValue: string,
): Promise<string> {
  const ordered = [
    choices.find(choice => choice.value === defaultValue)!,
    ...choices.filter(choice => choice.value !== defaultValue),
  ]
  if (ordered.length > 35) {
    Errors.throwUserInput(
      'Firebase selection has more than 35 choices. Narrow the available resources before connecting.',
    )
  }
  if (options.prompts.choice) {
    return options.prompts.choice(message, ordered, defaultValue)
  }
  const labels = '123456789abcdefghijklmnopqrstuvwxyz'
  for (;;) {
    HCI.writeLine(message, { output: options.output })
    ordered.forEach((choice, index) =>
      HCI.writeLine(labels[index] + '. ' + choice.label + (index === 0 ? ' (default)' : ''), { output: options.output })
    )
    const answer = (await options.prompts.text('Choose an option')).trim()
    const index = answer === '' ? 0 : answer.length === 1 ? labels.indexOf(answer) : -1
    const selected = ordered[index]
    if (selected) {
      return selected.value
    }
    HCI.writeLine('ctrl+c to quit', { output: options.output })
  }
}

async function confirm(options: FirebaseProvisionOptions, message: string): Promise<void> {
  const answer = await choose(options, message, [{ value: 'stop', label: 'Stop setup' }, {
    value: 'continue',
    label: 'Continue',
  }], 'continue')
  if (answer !== 'continue') {
    Errors.throwUserInput('Firebase setup was cancelled; no connection was saved.')
  }
}
function validateDatabase(value: FirebaseInspection): void {
  if (
    value.database
    && (value.database.type !== 'FIRESTORE_NATIVE'
      || (value.database.databaseEdition !== undefined && value.database.databaseEdition !== 'STANDARD'))
  ) {
    Errors.throwUserInput(
      'The default Firestore database must use Native mode and Standard edition. This command does not change database mode, edition, or billing.',
    )
  }
}
function sameRelease(left: FirebaseInspection, right: FirebaseInspection): boolean {
  return left.rules?.releaseName === right.rules?.releaseName && left.rules?.rulesetName === right.rules?.rulesetName
    && left.rules?.source === right.rules?.source
}
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(stable).join(',') + ']'
  }
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
  }
  return JSON.stringify(value) ?? 'null'
}
function denyAll(source: string): boolean {
  const compact = source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, '').replace(/\s/gu, '')
  return /^rules_version=['"]2['"];servicecloud\.firestore\{match\/databases\/\{database\}\/documents\{match\/\{document=\*\*\}\{allowread,write:iffalse;\}\}\}$/u
    .test(compact)
}
async function assertRegularPaths(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    if (await FS.isSymbolicLink(path) || (await FS.exists(path) && (await FS.entryMetadata(path)).kind !== 'file')) {
      Errors.throwUserInput('Firebase setup files must be regular files; no cloud changes were made.')
    }
  }
}
async function safeSetupPaths(project: string, work: string): Promise<void> {
  for (const path of [FS.resolvePath('.tao', project), work]) {
    if (
      await FS.isSymbolicLink(path) || (await FS.exists(path) && (await FS.entryMetadata(path)).kind !== 'directory')
    ) {
      Errors.throwUserInput('Firebase setup directory cannot be a symbolic link or file; no cloud changes were made.')
    }
  }
  await assertRegularPaths(
    ['firebase.json', 'firestore.rules', 'firestore.indexes.json'].map(name => FS.resolvePath(name, work)),
  )
}
async function reviewedRules(path: string, project: string): Promise<string> {
  const absolute = FS.resolvePath(path, project)
  await assertRegularPaths([absolute])
  if (!await FS.exists(absolute)) {
    Errors.throwUserInput('The reviewed Firebase rules file does not exist; no cloud changes were made.')
  }
  return FS.readText(absolute)
}
async function pilotRules(project: string): Promise<string> {
  for (
    const [name, kind] of [['src', 'directory'], ['src/firebase', 'directory'], [
      'src/firebase/firestore.rules',
      'file',
    ]] as const
  ) {
    const path = FS.resolvePath(name, project)
    if (await FS.isSymbolicLink(path)) {
      Errors.throwUserInput('Firebase pilot rules cannot use symbolic links; no cloud changes were made.')
    }
    if (!await FS.exists(path) || (await FS.entryMetadata(path)).kind !== kind) {
      Errors.throwUserInput('Firebase automation needs a regular src/firebase/firestore.rules in this pilot app.')
    }
  }
  const path = FS.resolvePath('src/firebase/firestore.rules', project)
  if (!FS.pathIsWithin(await FS.realPath(path), await FS.realPath(project))) {
    Errors.throwUserInput('Firebase pilot rules must stay inside the project; no cloud changes were made.')
  }
  return FS.readText(path)
}
function firebaseConfig(config: Record<string, unknown>): FirebaseConfig {
  const fields: Partial<FirebaseConfig> = {}
  for (const key of ['projectId', 'apiKey', 'appId', 'authDomain', 'storageBucket', 'messagingSenderId'] as const) {
    const value = config[key]
    if (value === undefined && (key === 'storageBucket' || key === 'messagingSenderId')) {
      continue
    }
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwHostEnvironment('Firebase CLI returned an invalid ' + key + ' in the web app configuration.')
    }
    fields[key] = value
  }
  return fields as FirebaseConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validAppId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9:._-]+$/u.test(value)
}

function recoveryCommand(options: FirebaseProvisionOptions, candidatePath: string): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
  return 'tao connect firebase ' + quote(FS.resolvePath(options.project))
    + (options.backend ? ' --app ' + quote(options.backend.displayName) : '') + ' --rules ' + quote(candidatePath)
}
