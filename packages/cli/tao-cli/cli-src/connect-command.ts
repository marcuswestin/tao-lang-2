import { Packages } from '@ast-utils'
import { Errors, FS, HCI, ProjectLocal, readFirebaseConnections } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { type AppwriteRunner, provisionAppwrite, provisionAppwriteProject } from './appwrite-provision'
import { discoverTaoDevProjects } from './dev-app-discovery'
import { printFirebaseConsoleSetup } from './firebase-console-guidance'
import type { FirebaseInspector } from './firebase-inspection'
import { type FirebaseRunner, provisionFirebase } from './firebase-provision'
import { hostedCrudRunCommand, taoAppRunCommand } from './hosted-crud-run'
import { readHostedProviderInputs } from './hosted-provider-inputs'

export type ConnectProvider = 'firebase' | 'appwrite'

type ConnectPrompts = {
  choice?: (
    message: string,
    choices: readonly { value: string; label: string }[],
    defaultValue?: string,
  ) => Promise<string>
  text: (message: string, defaultValue?: string) => Promise<string>
  paste: (message: string) => Promise<string>
  secret: (message: string) => Promise<string>
}

type ConnectOptions = {
  manual?: boolean
  appName?: string
  rulesFile?: string
  input?: Readable
  interactive?: boolean
  output?: Writable
  /** Replaces terminal input for focused command tests. */
  prompts?: ConnectPrompts
  /** Replaces network requests for focused command tests. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Replaces Firebase CLI calls for focused command tests. */
  firebaseRunner?: FirebaseRunner
  firebaseInspector?: FirebaseInspector
  /** Replaces the pause between Firebase deploy attempts for focused command tests. */
  firebaseSleep?: (milliseconds: number) => Promise<void>
  /** Replaces Appwrite CLI calls for focused command tests. */
  appwriteRunner?: AppwriteRunner
  /** Replaces the pause between Appwrite setup attempts for focused command tests. */
  appwriteSleep?: (milliseconds: number) => Promise<void>
}

/** Connects a Tao Firebase app or the Hosted CRUD pilot to a provider project. */
export async function runTaoConnect(
  provider: ConnectProvider,
  path = '.',
  options: ConnectOptions = {},
): Promise<void> {
  if (provider !== 'firebase' && provider !== 'appwrite') {
    Errors.throwUserInput(`Unknown connection provider '${provider}'. Choose firebase or appwrite.`)
  }
  const target = FS.resolvePath(path)
  const directory = await FS.isFile(target) && FS.extname(target) === '.tao' ? FS.dirname(target) : target
  if (!await FS.isDirectory(directory)) {
    Errors.throwUserInput(`No project directory found at ${FS.displayPath(target)}.`)
  }
  const project = await FS.realPath(await Packages.containingProjectRoot(directory) ?? directory)

  const terminal = { input: options.input, interactive: options.interactive, output: options.output }
  if (!HCI.isInteractive(terminal)) {
    Errors.throwUserInput('tao connect needs an interactive terminal; no connection files were changed.')
  }
  const prompts = options.prompts ?? {
    choice: (message: string, choices: readonly { value: string; label: string }[], defaultValue?: string) =>
      HCI.askChoice({ ...terminal, message, choices, defaultValue }),
    text: (message: string, defaultValue?: string) => HCI.askText({ ...terminal, message, defaultValue }),
    paste: async (message: string) => (await HCI.askSecret({ ...terminal, message })).value,
    secret: async (message: string) => (await HCI.askSecret({ ...terminal, message })).value,
  }
  const out = { output: options.output }
  const publicPath = FS.resolvePath('tao.connections.json', project)
  const localDirectory = ProjectLocal.localResolve('', project)
  const localPath = ProjectLocal.localResolve('connections.json', project)
  const privateDirectory = ProjectLocal.root(project)
  const privatePath = ProjectLocal.localResolve('connect-secrets.json', project)
  if (
    await FS.isSymbolicLink(publicPath) || await FS.isSymbolicLink(privateDirectory)
    || await FS.isSymbolicLink(privatePath) || await FS.isSymbolicLink(localDirectory)
    || await FS.isSymbolicLink(localPath)
  ) {
    Errors.throwUserInput('A connection file or directory is a symbolic link; nothing was stored.')
  }
  await ProjectLocal.prepare(project)
  const pilot = provider === 'firebase' && await isHostedCrudPilot(project)
  const publicConfig = provider === 'appwrite' || pilot ? await readObject(publicPath) : {}
  const localConfig = provider === 'firebase' ? await readObject(localPath) : {}

  if (provider === 'firebase') {
    HCI.writeLine(
      options.manual
        ? 'Manual Firebase setup: paste the public firebaseConfig for your project, or type manual to enter its fields.'
        : 'Firebase setup uses your local Google sign-in to find the project, read its app config, and configure Auth and Firestore.',
      out,
    )
  } else {
    HCI.writeLine('Appwrite setup uses the official CLI and your browser sign-in; no key paste is needed.', out)
    HCI.writeLine('Press Return at the next prompt to automate setup, or type manual to use a project API key', out)
    HCI.writeLine('from a project you created in the Appwrite Console.', out)
  }

  let publicFields: Record<string, string> = {}
  let firebaseAppName: string | undefined
  let firebaseAutomated = false
  let appwriteAutomated = false
  const appwriteResources = { platform: 'dev.tao.hostedcrudspike', databaseId: 'tao_notes', tableId: 'notes' }
  if (provider === 'appwrite') {
    const choice = (await prompts.text('Appwrite setup (Return to automate; type manual to paste a project API key)'))
      .trim()
    if (choice === '') {
      const existing = publicConfig['appwrite']
      const created = await provisionAppwriteProject({
        project,
        currentProjectId: isObject(existing) && typeof existing['projectId'] === 'string'
          ? existing['projectId']
          : undefined,
        resources: appwriteResources,
        prompts,
        output: options.output,
        runner: options.appwriteRunner,
        fetch: options.fetch,
        sleep: options.appwriteSleep,
      })
      publicFields = { ...created, ...appwriteResources }
      appwriteAutomated = true
    } else if (choice !== 'manual') {
      Errors.throwUserInput('Press Return to automate Appwrite setup, or type manual; nothing was stored.')
    }
  }
  if (provider === 'appwrite' && !appwriteAutomated) {
    HCI.writeLine('1. Open https://cloud.appwrite.io, sign in locally, and select your existing project.', out)
    HCI.writeLine('   Reuse an existing project; a project API key configures it but cannot create it.', out)
    HCI.writeLine('2. In project Settings, copy Project ID and the regional API endpoint ending in /v1.', out)
    HCI.writeLine('3. Open API Keys in the project sidebar, click Create API key, and name it Tao CLI setup.', out)
    HCI.writeLine('   Grant project.read, project.write, platforms.read, platforms.write,', out)
    HCI.writeLine('   databases.read, databases.write, tables.read, and tables.write.', out)
    HCI.writeLine('   Grant columns.write and indexes.write if those scopes are listed.', out)
    HCI.writeLine('   Copy the key once and paste it at the hidden prompt below. Do not put it in app config.', out)
    HCI.writeLine('4. Tao will register the iPhone platform, enable email/password auth, and create', out)
    HCI.writeLine('   a serverless TablesDB Notes table with row security and creator permissions.', out)
  }

  if (provider === 'firebase') {
    if (!options.manual) {
      const existing = isObject(localConfig['firebase']) ? localConfig['firebase'] : publicConfig['firebase']
      const canonical = pilot ? undefined : await readFirebaseConnections(project)
      const backend = pilot
        ? undefined
        : await firebaseBackendForConnect(target, project, options.appName, prompts, terminal)
      publicFields = await provisionFirebase({
        project,
        backend,
        currentAppId: canonical?.appId
          ?? (isObject(existing) && typeof existing['appId'] === 'string' ? existing['appId'] : undefined),
        rulesFile: options.rulesFile,
        inspector: options.firebaseInspector,
        currentProjectId: isObject(existing) && typeof existing['projectId'] === 'string'
          ? existing['projectId']
          : undefined,
        prompts,
        output: options.output,
        runner: options.firebaseRunner,
        sleep: options.firebaseSleep,
      })
      firebaseAppName = backend?.displayName
      firebaseAutomated = true
    } else {
      printFirebaseConfigInstructions(pilot, out)
      const pasted = (await prompts.paste('Firebase config (paste firebaseConfig or type manual):')).trim()
      if (pasted === '') {
        Errors.throwUserInput('Paste a Firebase web app config or type manual; no connection was stored.')
      }
      if (pasted === 'manual') {
        HCI.writeLine('Read each requested field from that same firebaseConfig object; enter only its value.', out)
      } else {
        publicFields = parseFirebaseConfigSnippet(pasted)
      }
    }
  }
  const fields = provider === 'firebase'
    ? (['projectId', 'apiKey', 'appId', 'authDomain'] as const)
    : (['endpoint', 'projectId'] as const)
  if (Object.keys(publicFields).length === 0) {
    for (const field of fields) {
      HCI.writeLine(
        provider === 'firebase'
          ? `Copy the ${field} string from the firebaseConfig object above; omit its quotes and comma.`
          : field === 'endpoint'
          ? 'Copy API Endpoint from the selected Appwrite project Settings; use its HTTPS URL ending in /v1.'
          : 'Copy Project ID from that same Appwrite project Settings; enter the ID, not the project name.',
        out,
      )
      const value = (await prompts.text(`${provider} ${field}`)).trim()
      if (value === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
        Errors.throwUserInput(
          `${provider} ${field} must be non-empty text without control characters; nothing was stored.`,
        )
      }
      publicFields[field] = value
    }
  }
  if (provider === 'appwrite' && !appwriteAutomated) {
    try {
      const endpoint = new URL(publicFields['endpoint']!)
      if (
        endpoint.protocol !== 'https:' || endpoint.pathname !== '/v1'
        || !(endpoint.hostname === 'cloud.appwrite.io' || endpoint.hostname.endsWith('.cloud.appwrite.io'))
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      ) {
        Errors.throwUserInput(
          'Appwrite endpoint must be an Appwrite Cloud HTTPS URL ending in /v1; nothing was stored.',
        )
      }
    } catch (error) {
      if (error instanceof Errors.UserInputError) {
        throw error
      }
      Errors.throwUserInput('Appwrite endpoint must be an Appwrite Cloud HTTPS URL ending in /v1; nothing was stored.')
    }
    publicFields = { ...publicFields, ...appwriteResources }
  }

  if (provider === 'appwrite' && !appwriteAutomated) {
    const privateConfig = await readObject(privatePath)
    const savedAppwrite = privateConfig['appwrite']
    const savedKey = isObject(savedAppwrite)
        && savedAppwrite['endpoint'] === publicFields['endpoint']
        && savedAppwrite['projectId'] === publicFields['projectId']
        && typeof savedAppwrite['apiKey'] === 'string'
      ? savedAppwrite['apiKey']
      : ''
    const enteredKey = (await prompts.secret(
      savedKey ? 'Paste Appwrite project API key (Return to reuse saved key):' : 'Paste Appwrite project API key:',
    )).trim()
    const apiKey = enteredKey || savedKey
    if (apiKey === '' || /[\u0000-\u001f\u007f]/u.test(apiKey)) {
      Errors.throwUserInput('Appwrite API key must be non-empty text; nothing was stored.')
    }
    await provisionAppwrite(
      {
        endpoint: publicFields['endpoint']!,
        projectId: publicFields['projectId']!,
        platform: publicFields['platform']!,
        databaseId: publicFields['databaseId']!,
        tableId: publicFields['tableId']!,
      },
      apiKey,
      options.fetch,
    )
    if (await FS.isFile(privatePath)) {
      await FS.chmod(privatePath, 0o600)
    }
    await FS.writeJson(privatePath, {
      ...privateConfig,
      appwrite: { endpoint: publicFields['endpoint'], projectId: publicFields['projectId'], apiKey },
    }, { mode: 0o600 })
    await FS.chmod(privatePath, 0o600)
    HCI.writeLine(`Saved Appwrite API key to ${FS.displayPath(privatePath)} (owner-only, ignored by Git).`, out)
  }
  const savedPath = provider === 'firebase' ? localPath : publicPath
  if (provider === 'firebase') {
    await FS.writeJson(localPath, { ...localConfig, firebase: publicFields })
    if (pilot) {
      // The Hosted CRUD pilot imports this file directly until its app config uses local connections.
      await FS.writeJson(publicPath, { ...publicConfig, firebase: publicFields })
    }
  } else {
    await FS.writeJson(publicPath, { ...publicConfig, [provider]: publicFields })
  }
  HCI.writeLine(`Saved public ${provider} config to ${FS.displayPath(savedPath)}.`, out)
  if (pilot) {
    HCI.writeLine(`Updated Hosted CRUD pilot config at ${FS.displayPath(publicPath)}.`, out)
  }
  const service = provider === 'firebase' ? 'Firebase' : 'Appwrite'
  if (provider === 'firebase' && !firebaseAutomated) {
    HCI.writeLine(
      'Firebase settings were saved locally; cloud Auth, Firestore, and rules were not configured or checked.',
      out,
    )
    printFirebaseConsoleSetup(publicFields['projectId']!, out)
    if (pilot) {
      HCI.writeLine(
        'Review src/firebase/firestore.rules, combine it with the current rules, then Publish on the Rules tab.',
        out,
      )
    } else {
      HCI.writeLine('Generate the local deployment files from your Tao app folder:', out)
      HCI.writeLine(`cd '${project.replaceAll("'", "'\\''")}'`, out)
      HCI.writeLine('tao firebase generate --output .tao/firebase-backend', out)
      HCI.writeLine('If asked, select the app that uses Firebase. No project path is needed from this folder.', out)
      HCI.writeLine('.tao/firebase-backend is a local folder created by the command for firestore.rules,', out)
      HCI.writeLine('firestore.indexes.json, and firebase.json; no separate backend server is needed.', out)
      HCI.writeLine(
        "Review and combine the generated firestore.rules with the project's current rules before Publish.",
        out,
      )
    }
    HCI.writeLine('Publishing replaces project-wide rules; preserve rules for any other apps using this project.', out)
  } else {
    HCI.writeLine(`${service} connect completed.`, out)
  }
  if (firebaseAutomated && firebaseAppName) {
    HCI.writeLine('To run the app:', out)
    HCI.writeLine(`    ${await taoAppRunCommand(project, firebaseAppName)}`, out)
  }
  if (provider === 'appwrite' || pilot) {
    HCI.writeLine(`To open Hosted CRUD in Expo Go and choose ${service} on its first screen, run:`, out)
    HCI.writeLine('', out)
    HCI.writeLine(`    ${await hostedCrudRunCommand(project)}`, out)
    HCI.writeLine('', out)
  }
  HCI.writeLine('', out)
}

/** Compiles the chosen app before asking Google to create or change resources. */
async function firebaseBackendForConnect(
  target: string,
  project: string,
  appName: string | undefined,
  prompts: ConnectPrompts,
  terminal: { input?: Readable; interactive?: boolean; output?: Writable },
) {
  HCI.writeLine('Compiling the Firebase app and its private data rules…', terminal)
  const apps = (await discoverTaoDevProjects(target)).flatMap(value => value.apps)
    .filter(app => app.projectRoot === project)
  if (apps.length === 0) {
    Errors.throwUserInput(
      'No Tao app was found here. For a project without Tao source, use tao connect firebase --manual.',
    )
  }
  let selected = appName === undefined
    ? apps.length === 1 ? apps[0] : undefined
    : apps.find(app => app.appName === appName)
  if (appName !== undefined && apps.filter(app => app.appName === appName).length !== 1) {
    Errors.throwUserInput(`--app '${appName}' must identify exactly one app in this project.`)
  }
  if (selected === undefined) {
    const choices = apps.map((app, index) => ({ value: String(index), label: app.appName }))
    const value = prompts.choice
      ? await prompts.choice('Select the app whose Firebase backend to configure:', choices)
      : await HCI.askChoice({ ...terminal, message: 'Select the app whose Firebase backend to configure:', choices })
    selected = apps[Number(value)]
  }
  if (selected === undefined) {
    Errors.throwUserInput('Firebase app selection was cancelled; no cloud changes were made.')
  }
  const inputs = await readHostedProviderInputs(selected.appPath, selected.appName, 'firebase')
  const { files, documentMatch } = (await import('tao-firebase/generate')).generateFirebaseBackend(
    inputs.definition,
    inputs.policy,
  )
  return { files, documentMatch, displayName: selected.appName }
}

async function isHostedCrudPilot(project: string): Promise<boolean> {
  const packagePath = FS.resolvePath('package.json', project)
  const sourceRules = FS.resolvePath('src/firebase/firestore.rules', project)
  if (
    await FS.isSymbolicLink(packagePath) || !await FS.isFile(packagePath)
    || await FS.isSymbolicLink(sourceRules) || !await FS.isFile(sourceRules)
  ) {
    return false
  }
  if ((await FS.entryMetadata(packagePath)).kind !== 'file' || (await FS.entryMetadata(sourceRules)).kind !== 'file') {
    return false
  }
  let packageInfo: unknown
  try {
    packageInfo = await FS.readJson(packagePath)
  } catch {
    return false
  }
  return isObject(packageInfo) && packageInfo['name'] === 'tao-hosted-crud-spike'
}

function parseFirebaseConfigSnippet(snippet: string): Record<string, string> {
  const declaration = /\b(?:const|let|var)\s+firebaseConfig\s*=\s*\{/u.exec(snippet)
  const open = declaration
    ? declaration.index + declaration[0].lastIndexOf('{')
    : snippet.trimStart().startsWith('{')
    ? snippet.indexOf('{')
    : -1
  const close = open < 0 ? -1 : snippet.indexOf('}', open + 1)
  if (close < 0) {
    Errors.throwUserInput('Paste the Firebase code snippet or firebaseConfig object; nothing was stored.')
  }
  const objectText = snippet.slice(open, close + 1)
    .replace(/([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)/gu, '$1"$2"$3')
    .replace(/,\s*\}/gu, '}')
  let config: unknown
  try {
    config = JSON.parse(objectText)
  } catch {
    Errors.throwUserInput('Firebase config must contain a valid firebaseConfig object; nothing was stored.')
  }
  if (!isObject(config)) {
    Errors.throwUserInput('Firebase config must contain a firebaseConfig object; nothing was stored.')
  }
  const fields: Record<string, string> = {}
  for (const key of ['projectId', 'apiKey', 'appId', 'authDomain']) {
    const value = config[key]
    if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwUserInput(`Firebase config needs a non-empty ${key} string; nothing was stored.`)
    }
    fields[key] = value
  }
  for (const key of ['storageBucket', 'messagingSenderId']) {
    const value = config[key]
    if (value === undefined) {
      continue
    }
    if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwUserInput(`Firebase config needs a non-empty ${key} string; nothing was stored.`)
    }
    fields[key] = value
  }
  return fields
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  if (!await FS.exists(path)) {
    return {}
  }
  let value: unknown
  try {
    value = await FS.readJson(path)
  } catch {
    Errors.throwUserInput(`${FS.displayPath(path)} must contain a JSON object; nothing was stored.`)
  }
  if (!isObject(value)) {
    Errors.throwUserInput(`${FS.displayPath(path)} must contain a JSON object; nothing was stored.`)
  }
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Explains the public Web SDK configuration before either connection input path. */
function printFirebaseConfigInstructions(pilot: boolean, out: { output?: Writable }): void {
  HCI.writeLine('Get your Firebase config before continuing:', out)
  HCI.writeLine('1. Open https://console.firebase.google.com/ and sign in locally with Google.', out)
  HCI.writeLine(
    '2. Open your existing Firebase project. Click the gear icon in the left sidebar, then General.',
    out,
  )
  HCI.writeLine('3. In Your apps, select an existing Web app (</>), then SDK setup and configuration > Config.', out)
  HCI.writeLine('   Tao uses the Web SDK config on iPhone and Android too.', out)
  HCI.writeLine('   If no Web app appears, press Create app (or Add app), then choose Web (</>).', out)
  HCI.writeLine(
    pilot
      ? '   Name it Tao Hosted CRUD Demo; leave Firebase Hosting unchecked; click Register app.'
      : '   Name the web app for your project; leave Firebase Hosting unchecked; click Register app.',
    out,
  )
  HCI.writeLine('   Copy the config from Add Firebase SDK, then click Continue to console.', out)
  HCI.writeLine('4. Copy the public firebaseConfig object, including its braces, and paste it at the next prompt.', out)
  HCI.writeLine(
    '   The const firebaseConfig = { ... }; snippet is accepted too. Type manual to enter fields separately.',
    out,
  )
  HCI.writeLine('5. Press Enter after pasting. These are public client settings; no password is requested here.', out)
  HCI.writeLine('No service-account JSON is needed for this app; do not generate one.', out)
  HCI.writeLine('Help: https://support.google.com/firebase/answer/7015592', out)
}
