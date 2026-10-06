import { CLI, Errors, FS, HCI, Platform, ProjectLocal } from '@shared'
import { createAgeCipher } from 'tao-cli-kit/age-cipher'
import {
  type Cipher,
  formatStore,
  isStoreKeyArmor,
  parseStore,
  requireSecretName,
  type SecretStore,
  type StoreKey,
  withSecret,
} from 'tao-cli-kit/secrets'
import { findTaoProjectSource } from './project-root'

const STORE_PATH = 'secrets.jsonc'
const IDENTITY_PATH = '.config/tao/secrets-identity.txt'
const HEADER =
  `// Tao project secrets. Commit this file; it contains encrypted values, public recipients, and readable names.
// Every recipient can read every value. Grant access with \`tao secrets grant <recipient>\`.
// Removing a recipient does not revoke values already present in Git history; rotate provider credentials.
// Do not edit ciphertext by hand. Use \`tao secrets set <NAME>\`.
`

export type ProjectSecretsEnvironment = {
  cipher: Cipher
  identityRecipient: () => Promise<string>
  now: () => Date
  promptSecret: (name: string) => Promise<string>
}

function machineIdentityPath(): string {
  const home = Platform.runtimeProcess.env['HOME']
  if (home === undefined || home === '') {
    Errors.throwHostEnvironment('HOME is required to locate the Tao secrets identity.')
  }
  return FS.resolvePath(IDENTITY_PATH, home)
}

function liveEnvironment(): ProjectSecretsEnvironment {
  return {
    cipher: createAgeCipher(machineIdentityPath(), 'tao secrets identity'),
    identityRecipient: ensureMachineIdentity,
    now: () => new Date(),
    promptSecret: async name => (await HCI.askSecret({ message: `Value for ${name} (hidden):` })).value,
  }
}

/** The identity is machine-wide; its private half stays in the Mac Secure Enclave. */
async function ensureMachineIdentity(): Promise<string> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Tao project secrets currently require macOS with a Secure Enclave.')
  }
  const path = machineIdentityPath()
  if (!await FS.exists(path)) {
    await FS.mkdir(FS.dirname(path))
    let created: CLI.CommandResult
    try {
      created = await CLI.run('age-plugin-se', {
        args: ['keygen', '--access-control', 'any-biometry-or-passcode', '--output', path],
      })
    } catch {
      Errors.throwHostEnvironment('Could not run age-plugin-se. Install age and age-plugin-se, then retry.')
    }
    if (created.exitCode !== 0) {
      Errors.throwHostEnvironment(`Could not create the Secure Enclave identity: ${created.stderr.trim()}`)
    }
    await FS.chmod(path, 0o600)
  }
  const identity = await FS.readText(path)
  const recorded = /^#\s*public key:\s*(age1\S+)\s*$/m.exec(identity)?.[1]
  if (recorded !== undefined) {
    return recorded
  }
  const derived = await CLI.run('age-plugin-se', { args: ['recipients', '--input', path] })
  const recipient = derived.stdout.trim()
  if (derived.exitCode !== 0 || !recipient.startsWith('age1')) {
    Errors.throwHostEnvironment(`Could not read the Secure Enclave recipient from ${FS.displayPath(path)}.`)
  }
  return recipient
}

async function storeLocation(target: string): Promise<{ path: string; root: string }> {
  const project = await findTaoProjectSource(target)
  await ProjectLocal.prepare(project.root)
  return { root: project.root, path: ProjectLocal.storeResolve(STORE_PATH, project.root) }
}

async function readStore(path: string): Promise<SecretStore> {
  if (!await FS.exists(path)) {
    Errors.throwUserInput(`No Tao project secret store at ${FS.displayPath(path)}. Run \`tao secrets init\` first.`)
  }
  const store = parseStore(await FS.readText(path))
  if (store.storeKey === undefined || store.recipients.length === 0) {
    Errors.throwUserInput(`The Tao project secret store at ${FS.displayPath(path)} has no usable store key.`)
  }
  return store
}

async function writeStore(root: string, path: string, store: SecretStore): Promise<void> {
  const temporary = ProjectLocal.stagingPath(path, root)
  await FS.mkdir(FS.dirname(path))
  try {
    await FS.writeText(temporary, formatStore(store, { header: HEADER }), { mode: 0o600 })
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary)
  }
}

async function mutateStore<Value>(root: string, path: string, work: () => Promise<Value>): Promise<Value> {
  return await FS.withFileMutationLock(path, root, work, {
    lockDirectory: ProjectLocal.cacheResolve('locks', root),
  })
}

async function unlockStoreKey(store: SecretStore, cipher: Cipher): Promise<string> {
  const key = store.storeKey
  if (key === undefined) {
    Errors.throwUserInput('The Tao project secret store has no store key.')
  }
  let secretKey: string
  try {
    secretKey = (await cipher.decrypt(key.wrappedKey.join('\n'))).trim()
  } catch {
    Errors.throwHostEnvironment(
      'This machine cannot unlock the project secrets. Ask an enrolled collaborator to run '
        + '`tao secrets grant <recipient>` with the recipient from `tao secrets identity`.',
    )
  }
  if (await cipher.recipientOfKey(secretKey) !== key.recipient) {
    Errors.throwUserInput('The project store key does not match its recorded public recipient.')
  }
  return secretKey
}

/** Initialize a committed store in the nearest Tao project directory. */
export async function initProjectSecrets(target = '.', environment = liveEnvironment()): Promise<string> {
  const { root, path } = await storeLocation(target)
  if (await FS.exists(path)) {
    Errors.throwUserInput(`Project secrets already exist at ${FS.displayPath(path)}.`)
  }
  const recipient = await environment.identityRecipient()
  const generated = await environment.cipher.generateKey()
  const wrapped = await environment.cipher.encrypt(generated.secretKey, [recipient])
  await mutateStore(root, path, async () => {
    if (await FS.exists(path)) {
      Errors.throwUserInput(`Project secrets were initialized concurrently at ${FS.displayPath(path)}.`)
    }
    await writeStore(root, path, {
      recipients: [recipient],
      storeKey: { recipient: generated.recipient, wrappedFor: [recipient], wrappedKey: armorLines(wrapped) },
      secrets: {},
    })
  })
  return path
}

/** Show this machine's public recipient for an existing collaborator to grant. */
export async function projectSecretsIdentity(environment = liveEnvironment()): Promise<string> {
  return await environment.identityRecipient()
}

/** Explicitly grant one recipient access to every project secret. */
export async function grantProjectSecrets(
  recipient: string,
  target = '.',
  environment = liveEnvironment(),
): Promise<boolean> {
  if (!/^age1[a-z0-9]+$/u.test(recipient)) {
    Errors.throwUserInput('Expected an age public recipient from `tao secrets identity`.')
  }
  const { root, path } = await storeLocation(target)
  const original = await readStore(path)
  if (original.storeKey?.wrappedFor.includes(recipient) === true) {
    return false
  }
  const secretKey = await unlockStoreKey(original, environment.cipher)
  // Wrap only to machines already granted plus this one. `recipients` is unauthenticated text in a
  // committed file, so a name added there by hand must not ride along on someone else's grant.
  const wrappedFor = [...original.storeKey!.wrappedFor, recipient]
  const recipients = original.recipients.includes(recipient) ? original.recipients : [...original.recipients, recipient]
  const wrapped = await environment.cipher.encrypt(secretKey, wrappedFor)
  await mutateStore(root, path, async () => {
    const current = await readStore(path)
    if (
      JSON.stringify(current.storeKey) !== JSON.stringify(original.storeKey)
      || JSON.stringify(current.recipients) !== JSON.stringify(original.recipients)
    ) {
      Errors.throwUserInput('Project recipients changed while granting access. Retry the command.')
    }
    const storeKey: StoreKey = { ...current.storeKey!, wrappedFor, wrappedKey: armorLines(wrapped) }
    await writeStore(root, path, { ...current, recipients, storeKey })
  })
  return true
}

/** Encrypt one hidden value into the project store. */
export async function setProjectSecret(
  name: string,
  target = '.',
  environment = liveEnvironment(),
): Promise<{ replaced: boolean; path: string }> {
  requireSecretName(name)
  const { root, path } = await storeLocation(target)
  const original = await readStore(path)
  await unlockStoreKey(original, environment.cipher)
  HCI.writeStderr(
    `Obtain or create ${name} from the service or app that uses it. Tao encrypts the value you supply; it does not issue credentials. Enter the exact value in the hidden local prompt.\n`,
  )
  const value = await environment.promptSecret(name)
  if (value === '') {
    Errors.throwUserInput('No value was entered, so nothing was stored.')
  }
  const armor = await environment.cipher.encrypt(value, [original.storeKey!.recipient])
  await mutateStore(root, path, async () => {
    const current = await readStore(path)
    if (
      current.storeKey?.recipient !== original.storeKey?.recipient
      || JSON.stringify(current.secrets[name]) !== JSON.stringify(original.secrets[name])
    ) {
      Errors.throwUserInput(`The project store or ${name} changed while saving. Retry the command.`)
    }
    await writeStore(root, path, withSecret(current, name, armor, { now: environment.now() }))
  })
  return { replaced: original.secrets[name] !== undefined, path }
}

/** Decrypt one named value in memory, for CLI use or a provider command. */
export async function readProjectSecret(
  name: string,
  target = '.',
  environment = liveEnvironment(),
): Promise<string> {
  requireSecretName(name)
  const { path } = await storeLocation(target)
  const store = await readStore(path)
  return await decryptStoredSecret(name, store, environment.cipher)
}

/** A provider can use the project store when present without changing its existing prompt fallback. */
export async function projectSecretIfStored(
  name: string,
  projectRoot: string,
  environment?: ProjectSecretsEnvironment,
): Promise<string | undefined> {
  requireSecretName(name)
  await ProjectLocal.prepare(projectRoot)
  const path = ProjectLocal.storeResolve(STORE_PATH, projectRoot)
  if (!await FS.exists(path)) {
    return undefined
  }
  const store = await readStore(path)
  if (store.secrets[name] === undefined) {
    return undefined
  }
  return await decryptStoredSecret(name, store, (environment ?? liveEnvironment()).cipher)
}

async function decryptStoredSecret(name: string, store: SecretStore, cipher: Cipher): Promise<string> {
  const entry = store.secrets[name]
  if (entry === undefined) {
    Errors.throwUserInput(`No project secret named ${name} is stored.`)
  }
  const armor = entry.value.join('\n')
  if (!isStoreKeyArmor(armor)) {
    Errors.throwUserInput(`${name} is not encrypted to this project's store key.`)
  }
  const secretKey = await unlockStoreKey(store, cipher)
  try {
    return await cipher.decryptWithKey(armor, secretKey)
  } catch {
    Errors.throwUserInput(`${name} could not be decrypted with this project's store key.`)
  }
}

/** Names and notes are public metadata in the committed store. */
export async function listProjectSecrets(target = '.'): Promise<SecretStore['secrets']> {
  const { path } = await storeLocation(target)
  return (await readStore(path)).secrets
}

/** Remove the current ciphertext. Historical Git copies and provider credentials need separate handling. */
export async function removeProjectSecret(
  name: string,
  target = '.',
  environment = liveEnvironment(),
): Promise<string> {
  requireSecretName(name)
  const { root, path } = await storeLocation(target)
  const original = await readStore(path)
  if (original.secrets[name] === undefined) {
    Errors.throwUserInput(`No project secret named ${name} is stored.`)
  }
  await unlockStoreKey(original, environment.cipher)
  await mutateStore(root, path, async () => {
    const current = await readStore(path)
    if (
      current.storeKey?.recipient !== original.storeKey?.recipient
      || JSON.stringify(current.secrets[name]) !== JSON.stringify(original.secrets[name])
    ) {
      Errors.throwUserInput(`${name} changed while removing it. Retry the command.`)
    }
    const secrets = { ...current.secrets }
    delete secrets[name]
    await writeStore(root, path, { ...current, secrets })
  })
  return path
}

function armorLines(armor: string): string[] {
  return armor.trimEnd().split('\n')
}
