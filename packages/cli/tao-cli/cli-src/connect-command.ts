import { Errors, FS, HCI } from '@shared'
import type { Readable, Writable } from 'node:stream'

export type ConnectProvider = 'firebase' | 'appwrite'

type ConnectPrompts = {
  text: (message: string) => Promise<string>
  secret: (message: string) => Promise<string>
}

type ConnectOptions = {
  input?: Readable
  interactive?: boolean
  output?: Writable
  /** Replaces terminal input for focused command tests. */
  prompts?: ConnectPrompts
}

/** Collects settings for the Hosted CRUD pilot. It does not create or verify cloud resources. */
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
    secret: async (message: string) => (await HCI.askSecret({ ...terminal, message })).value,
  }
  const out = { output: options.output }
  const publicPath = FS.resolvePath('tao.connections.json', project)
  const secretPath = FS.resolvePath('.tao/connect-secrets.json', project)

  HCI.writeLine(
    'This pilot records setup details for Apps/Hosted CRUD. Ordinary Tao app declarations do not consume these settings yet.',
    out,
  )

  if (provider === 'firebase') {
    HCI.writeLine('1. At https://console.firebase.google.com create a project, then register a Web app.', out)
    HCI.writeLine('2. Open Project settings > General > Your apps and copy the Firebase web config fields below.', out)
    HCI.writeLine(
      '   The web API key identifies the client project; it is public config, not an admin credential.',
      out,
    )
    HCI.writeLine('3. The app needs no service account. If you want to save one for future backend tooling,', out)
    HCI.writeLine(
      '   open Project settings > Service accounts > Generate new private key. Never put it in a client app.',
      out,
    )
  } else {
    HCI.writeLine(
      '1. At https://cloud.appwrite.io create a project and add an Apple or Android platform for your app ID.',
      out,
    )
    HCI.writeLine(
      '2. In Console, create a database and collection; find the endpoint and project ID in project Settings.',
      out,
    )
    HCI.writeLine('3. The app needs no server API key. Create one in the project API keys area only if you', out)
    HCI.writeLine('   want to save it for future backend tooling. Keep it off the client.', out)
  }

  const publicFields: Record<string, string> = {}
  const fields = provider === 'firebase'
    ? (['projectId', 'apiKey', 'appId', 'authDomain'] as const)
    : (['endpoint', 'projectId', 'platform', 'databaseId', 'collectionId'] as const)
  for (const field of fields) {
    const value = (await prompts.text(`${provider} ${field}:`)).trim()
    if (value === '' || /[\u0000-\u001f\u007f]/u.test(value)) {
      Errors.throwUserInput(
        `${provider} ${field} must be non-empty text without control characters; nothing was stored.`,
      )
    }
    publicFields[field] = value
  }
  if (provider === 'appwrite') {
    try {
      const endpoint = new URL(publicFields['endpoint']!)
      if (endpoint.protocol !== 'https:' || !endpoint.pathname.endsWith('/v1')) {
        Errors.throwUserInput('Appwrite endpoint must be an HTTPS URL ending in /v1; nothing was stored.')
      }
    } catch (error) {
      if (error instanceof Errors.UserInputError) {
        throw error
      }
      Errors.throwUserInput('Appwrite endpoint must be an HTTPS URL ending in /v1; nothing was stored.')
    }
  }

  let secret: unknown
  if (provider === 'firebase') {
    const pasted = (await prompts.secret('Firebase service-account JSON (optional; press Return to skip):')).trim()
    if (pasted !== '') {
      try {
        secret = JSON.parse(pasted)
      } catch {
        Errors.throwUserInput('Firebase service-account JSON is invalid; nothing was stored.')
      }
      if (
        !isObject(secret) || secret['type'] !== 'service_account'
        || secret['project_id'] !== publicFields['projectId']
        || typeof secret['private_key'] !== 'string' || typeof secret['client_email'] !== 'string'
      ) {
        Errors.throwUserInput(
          'Firebase service-account JSON must match the project ID and contain a private key and client email; nothing was stored.',
        )
      }
    }
  } else {
    secret = (await prompts.secret('Appwrite server API key (optional; press Return to skip):')).trim()
  }

  if (
    await FS.isSymbolicLink(publicPath) || await FS.isSymbolicLink(secretPath)
    || await FS.isSymbolicLink(FS.dirname(secretPath))
  ) {
    Errors.throwUserInput('Connection file path is a symbolic link; nothing was stored.')
  }
  const publicConfig = await readObject(publicPath)
  const oldSecrets = await readObject(secretPath)
  if (secret !== undefined && secret !== '') {
    if (await FS.exists(secretPath)) {
      await FS.chmod(secretPath, 0o600)
    }
    await FS.writeJson(secretPath, {
      ...oldSecrets,
      [provider]: provider === 'firebase' ? { serviceAccount: secret } : { apiKey: secret },
    }, { mode: 0o600 })
    await FS.chmod(secretPath, 0o600)
  } else if (await FS.exists(secretPath)) {
    // Retained credentials may have been written with a permissive mode by an older tool.
    await FS.chmod(secretPath, 0o600)
  }
  await FS.writeJson(publicPath, { ...publicConfig, [provider]: publicFields })

  HCI.writeLine(`Saved public ${provider} config to ${FS.displayPath(publicPath)}.`, out)
  HCI.writeLine(
    secret !== undefined && secret !== ''
      ? `Saved ${provider} server credential to ${FS.displayPath(secretPath)} (owner only).`
      : `No ${provider} server credential entered; an existing one, if present, was retained.`,
    out,
  )
  HCI.writeLine(
    provider === 'firebase'
      ? 'Next in Firebase Console: create a Firestore database, enable the sign-in method, and set Firestore Security Rules.'
      : 'Next in Appwrite Console: add the collection attributes and permissions, enable the sign-in method, and confirm the platform ID.',
    out,
  )
  HCI.writeLine(
    'This command stores local settings only; it has not provisioned resources or checked the connection.',
    out,
  )
  HCI.writeLine(
    'Only Apps/Hosted CRUD currently reads the public settings. A normal Tao app still needs a provider bridge.',
    out,
  )
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
