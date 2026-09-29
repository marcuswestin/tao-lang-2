import { Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'
import { provisionAppwrite } from './appwrite-provision'
import { type FirebaseRunner, provisionFirebase } from './firebase-provision'

export type ConnectProvider = 'firebase' | 'appwrite'

type ConnectPrompts = {
  text: (message: string) => Promise<string>
  paste: (message: string) => Promise<string>
  secret: (message: string) => Promise<string>
}

type ConnectOptions = {
  input?: Readable
  interactive?: boolean
  output?: Writable
  /** Replaces terminal input for focused command tests. */
  prompts?: ConnectPrompts
  /** Replaces network requests for focused command tests. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Replaces Firebase CLI calls for focused command tests. */
  firebaseRunner?: FirebaseRunner
  /** Replaces the pause between Firebase deploy attempts for focused command tests. */
  firebaseSleep?: (milliseconds: number) => Promise<void>
}

/** Connects the Hosted CRUD pilot to a provider project. */
export async function runTaoConnect(
  provider: ConnectProvider,
  path = '.',
  options: ConnectOptions = {},
): Promise<void> {
  if (provider !== 'firebase' && provider !== 'appwrite') {
    Errors.throwUserInput(`Unknown connection provider '${provider}'. Choose firebase or appwrite.`)
  }
  const target = FS.resolvePath(path)
  const project = await FS.isFile(target) && FS.extname(target) === '.tao' ? FS.dirname(target) : target
  if (!await FS.isDirectory(project)) {
    Errors.throwUserInput(`No project directory found at ${FS.displayPath(target)}.`)
  }

  const terminal = { input: options.input, interactive: options.interactive, output: options.output }
  if (!HCI.isInteractive(terminal)) {
    Errors.throwUserInput('tao connect needs an interactive terminal; no connection files were changed.')
  }
  const prompts = options.prompts ?? {
    text: (message: string) => HCI.askText({ ...terminal, message }),
    paste: async (message: string) => (await HCI.askSecret({ ...terminal, message })).value,
    secret: async (message: string) => (await HCI.askSecret({ ...terminal, message })).value,
  }
  const out = { output: options.output }
  const publicPath = FS.resolvePath('tao.connections.json', project)
  const privateDirectory = FS.resolvePath('.tao', project)
  const privatePath = FS.resolvePath('connect-secrets.json', privateDirectory)
  if (
    await FS.isSymbolicLink(publicPath) || await FS.isSymbolicLink(privateDirectory)
    || await FS.isSymbolicLink(privatePath)
  ) {
    Errors.throwUserInput('A connection file or directory is a symbolic link; nothing was stored.')
  }
  const publicConfig = await readObject(publicPath)

  HCI.writeLine(
    'This pilot records setup details for Apps/Hosted CRUD. Ordinary Tao app declarations do not consume these settings yet.',
    out,
  )

  if (provider === 'firebase') {
    HCI.writeLine('Firebase setup uses the official CLI and your Google sign-in; no token paste is needed.', out)
    HCI.writeLine('Press Return at the next prompt to automate setup, paste a firebaseConfig snippet', out)
    HCI.writeLine('from an already configured project, or type manual to enter its four public fields.', out)
  } else {
    HCI.writeLine('1. At https://cloud.appwrite.io create a project, such as Tao Hosted CRUD Demo.', out)
    HCI.writeLine('   Choose the free serverless option and a region.', out)
    HCI.writeLine('   This is the one manual creation step: a project API key cannot create its project.', out)
    HCI.writeLine('2. In project Settings, copy Project ID and the regional API endpoint ending in /v1.', out)
    HCI.writeLine('3. Open API Keys in the project sidebar, click Create API key, and name it Tao CLI setup.', out)
    HCI.writeLine('   Grant project.read, project.write, platforms.read, platforms.write,', out)
    HCI.writeLine('   databases.read, databases.write, tables.read, and tables.write.', out)
    HCI.writeLine('   Grant columns.write and indexes.write if those scopes are listed.', out)
    HCI.writeLine('   Copy the key once and paste it at the hidden prompt below. Do not put it in app config.', out)
    HCI.writeLine('4. Tao will register the iPhone platform, enable email/password auth, and create', out)
    HCI.writeLine('   a serverless TablesDB Notes table with row security and creator permissions.', out)
  }

  let publicFields: Record<string, string> = {}
  let firebaseAutomated = false
  if (provider === 'firebase') {
    const pasted = (await prompts.paste('Firebase config (Return to automate; type manual for individual fields):'))
      .trim()
    if (pasted === '') {
      const existing = publicConfig['firebase']
      publicFields = await provisionFirebase({
        project,
        currentProjectId: isObject(existing) && typeof existing['projectId'] === 'string'
          ? existing['projectId']
          : undefined,
        prompts,
        output: options.output,
        runner: options.firebaseRunner,
        sleep: options.firebaseSleep,
      })
      firebaseAutomated = true
    } else if (pasted === 'manual') {
      HCI.writeLine('In Firebase Console, press Create app (or Add app) and select the Web app icon (</>).', out)
      HCI.writeLine('Name it Tao Hosted CRUD Demo; leave Firebase Hosting unchecked; click Register app.', out)
      HCI.writeLine('On Add Firebase SDK, leave Use npm selected. Firebase is already installed here.', out)
      HCI.writeLine('Click Continue to console after copying config. Later find it in Project settings >', out)
      HCI.writeLine('General > Your apps > Web app > SDK setup and configuration > Config.', out)
      HCI.writeLine('No service-account JSON is needed for this app; do not generate one.', out)
    } else {
      publicFields = parseFirebaseConfigSnippet(pasted)
    }
  }
  const fields = provider === 'firebase'
    ? (['projectId', 'apiKey', 'appId', 'authDomain'] as const)
    : (['endpoint', 'projectId'] as const)
  if (Object.keys(publicFields).length === 0) {
    for (const field of fields) {
      const value = (await prompts.text(`${provider} ${field}`)).trim()
      if (value === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
        Errors.throwUserInput(
          `${provider} ${field} must be non-empty text without control characters; nothing was stored.`,
        )
      }
      publicFields[field] = value
    }
  }
  if (provider === 'appwrite') {
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
    publicFields['platform'] = 'dev.tao.hostedcrudspike'
    publicFields['databaseId'] = 'tao_notes'
    publicFields['tableId'] = 'notes'
  }

  if (provider === 'appwrite') {
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
  await FS.writeJson(publicPath, { ...publicConfig, [provider]: publicFields })

  HCI.writeLine(`Saved public ${provider} config to ${FS.displayPath(publicPath)}.`, out)
  const service = provider === 'firebase' ? 'Firebase' : 'Appwrite'
  if (provider === 'firebase' && !firebaseAutomated) {
    HCI.writeLine('Firebase settings were saved, but cloud resources were not provisioned or checked.', out)
    HCI.writeLine('Next in Firebase Console:', out)
    HCI.writeLine('1. Security > Authentication > Sign-in method: enable Email/Password and Save.', out)
    HCI.writeLine('2. Databases & Storage > Firestore: create a database in a chosen location.', out)
    HCI.writeLine('   Choose production mode initially, then open Firestore > Rules.', out)
    HCI.writeLine('3. Paste Apps/Hosted CRUD/src/firebase/firestore.rules and click Publish.', out)
  } else {
    HCI.writeLine(`${service} connect completed.`, out)
  }
  HCI.writeLine(
    `To open Hosted CRUD in Expo Go and choose ${service} on its first screen, run from the repository root:`,
    out,
  )
  HCI.writeLine('', out)
  HCI.writeLine('    just hosted-crud', out)
  HCI.writeLine('', out)
  HCI.writeLine('', out)
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
