// `just secrets` — one step from a committed store to a usable environment file.
//
// The identity lives outside the repository, in the Secure Enclave of one Mac, so this is set up once per
// machine and never per worktree. It is the one credential for everything: reading the store and adding to it
// each unwrap the store key with it once, and an add or a read that cannot unwrap the key, or unwraps a key
// that does not match the one the store records, is refused before anything is decrypted or anyone pastes a
// value. The Mac asks for Touch ID or the login passcode because the kernel asks, not because this code does;
// nothing here ever sees or stores a passphrase.

import { CLI, Errors, FS, HCI, Platform, Repo, SecretsFile } from '@shared'
import {
  type Cipher,
  formatStore,
  isStoreKeyArmor,
  parseStore,
  renderEnvFile,
  requireSecretName,
  type SecretStore,
  type StoreKey,
  withSecret,
} from './SecretStore'

/** Committed: readable keys, readable metadata, encrypted values. */
const STORE_PATH = 'secrets/secrets.jsonc'
/** Outside the repository, so every worktree on this machine shares one identity. */
const IDENTITY_PATH = '~/.config/tao/secrets-identity.txt'

export type SecretsEnvironment = {
  cipher: Cipher
  /** Reads a secret from the terminal without echoing it. */
  promptSecret: (label: string) => Promise<string>
  now: () => Date
}

/**
 * liveEnvironment is what the command uses outside a test: real `age`, a real terminal, a real clock.
 *
 * Surrounding whitespace is questioned rather than silently removed. A copied credential often carries a
 * trailing newline that means nothing, but some secrets genuinely end in space, and a tool that quietly
 * trimmed one would produce a value that fails authentication with nothing on screen to explain it.
 */
function liveEnvironment(): SecretsEnvironment {
  return {
    cipher: ageCipher(),
    now: () => new Date(),
    promptSecret: async label => {
      const entered = await HCI.askSecret({ message: label })
      const surrounding = HCI.describeSurroundingWhitespace(entered.value)
      if (surrounding === undefined) {
        return entered.value
      }
      HCI.writeLine(`What you ${entered.wasPasted ? 'pasted' : 'typed'} has ${surrounding}.`)
      const trim = await HCI.askConfirm({ defaultValue: true, message: 'Remove it before storing?' })
      return trim ? entered.value.trim() : entered.value
    },
  }
}

/** run dispatches `./dev secrets [add <KEY> | list | setup]`. */
export async function runSecrets(args: readonly string[], environment = liveEnvironment()): Promise<number> {
  const [action, ...rest] = args
  if (action === undefined) {
    return await decryptSecrets(environment)
  }
  if (action === 'add') {
    const name = rest[0]
    if (name === undefined) {
      Errors.throwUserInput('Name the secret to add, as in `just secrets add ANTHROPIC_API_KEY`.')
    }
    return await addSecret(name, environment, rest.slice(1).join(' ') || undefined)
  }
  if (action === 'list') {
    return await listSecrets()
  }
  if (action === 'setup') {
    return await setupSecrets()
  }
  Errors.throwUserInput(`Unknown secrets action '${action}'. Use no action to decrypt, or add, list, or setup.`)
}

function identityFile(): string {
  return FS.resolvePath(IDENTITY_PATH.replace('~', Platform.runtimeProcess.env['HOME'] ?? '~'))
}

/** homePath shows a path under the home directory as `~/...`; the repository-relative form is nonsense here. */
function homePath(path: string): string {
  const home = Platform.runtimeProcess.env['HOME']
  return home !== undefined && path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

/**
 * recipientOf reads the public key age-plugin-se records in the identity file's comments. Asking the plugin
 * for it instead would reach into the Secure Enclave and prompt for a fingerprint, which is a strange thing
 * to ask during setup for a value that is not secret.
 */
async function recipientOf(identity: string): Promise<string> {
  const comment = /^#\s*public key:\s*(\S+)\s*$/m.exec(await FS.readText(identity))
  if (comment !== null) {
    return comment[1]!
  }
  const derived = await CLI.run('age-plugin-se', { args: ['recipients', '--input', identity] })
  if (derived.exitCode !== 0 || derived.stdout.trim() === '') {
    Errors.throwHostEnvironment(
      `Could not read the recipient from ${homePath(identity)}: ${
        derived.stderr.trim() || `exit code ${derived.exitCode ?? 'unknown'}`
      }`,
    )
  }
  return derived.stdout.trim()
}

function failureOf(result: CLI.CommandResult): string {
  return result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

/**
 * ageCipher shells out to `age`. Only `decrypt` uses the machine identity, and the Secure Enclave plugin is
 * what turns that into a Touch ID or passcode prompt; everything else is software and silent. A test passes a
 * stand-in identity file; the command always reads the machine's.
 */
function ageCipher(identityPath?: string): Cipher {
  return {
    decrypt: async armor => {
      const identity = identityPath ?? identityFile()
      if (!await FS.exists(identity)) {
        Errors.throwHostEnvironment(
          `No secrets identity at ${FS.displayPath(identity)}. Run \`just secrets setup\` once on this machine.`,
        )
      }
      const result = await CLI.run('age', { args: ['--decrypt', '--identity', identity], stdin: armor })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`age could not decrypt a secret: ${failureOf(result)}`)
      }
      return result.stdout
    },
    // The key reaches age on stdin (`--identity -`), never in argv, where any process listing would show it,
    // and never in a file. That leaves the ciphertext, which is committed anyway, to go through a file.
    decryptWithKey: async (armor, secretKey) => {
      const directory = await FS.mkTmpDir('tao-secrets-')
      try {
        const input = FS.resolvePath('value.age', directory)
        await FS.writeText(input, armor, { mode: 0o600 })
        const result = await CLI.run('age', { args: ['--decrypt', '--identity', '-', input], stdin: secretKey })
        if (result.exitCode !== 0) {
          Errors.throwHostEnvironment(
            `age could not decrypt a secret with the store key: ${
              failureOf(result).replaceAll(secretKey, '<store key>')
            }`,
          )
        }
        return result.stdout
      } finally {
        await FS.remove(directory)
      }
    },
    generateKey: async () => {
      const result = await CLI.run('age-keygen', {})
      const recipient = /^#\s*public key:\s*(age1\S+)\s*$/m.exec(result.stdout)?.[1]
      const secretKey = /^AGE-SECRET-KEY-1\S+$/m.exec(result.stdout)?.[0]
      if (result.exitCode !== 0 || recipient === undefined || secretKey === undefined) {
        Errors.throwHostEnvironment(`age-keygen could not create the store key: ${failureOf(result)}`)
      }
      return { recipient, secretKey }
    },
    // The key reaches age-keygen on stdin, for the same reason as in `decryptWithKey`.
    recipientOfKey: async secretKey => {
      const result = await CLI.run('age-keygen', { args: ['-y'], stdin: secretKey })
      const recipient = result.stdout.trim()
      if (result.exitCode !== 0 || !recipient.startsWith('age1')) {
        Errors.throwHostEnvironment(
          `age-keygen could not read the store key's recipient: ${
            failureOf(result).replaceAll(secretKey, '<store key>')
          }`,
        )
      }
      return recipient
    },
    encrypt: async (plaintext, recipients) => {
      if (recipients.length === 0) {
        Errors.throwUserInput('The secret store lists no recipients. Run `just secrets setup` first.')
      }
      const result = await CLI.run('age', {
        args: ['--armor', ...recipients.flatMap(recipient => ['--recipient', recipient])],
        stdin: plaintext,
      })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(`age could not encrypt a secret: ${failureOf(result)}`)
      }
      return result.stdout
    },
  }
}

async function readStore(): Promise<SecretStore> {
  const path = Repo.resolvePath(STORE_PATH)
  if (!await FS.exists(path)) {
    return { recipients: [], secrets: {} }
  }
  return parseStore(await FS.readText(path))
}

/** StoreAccess is what reading or writing the store needs; a test supplies an in-memory store and stand-in keys. */
type StoreAccess = {
  cipher: Cipher
  now: () => Date
  read: () => Promise<SecretStore>
  write: (store: SecretStore) => Promise<void>
}

function liveStoreAccess(cipher: Cipher = ageCipher(), now = () => new Date()): StoreAccess {
  return { cipher, now, read: readStore, write: writeStore }
}

/** Every encrypted-store writer uses this lock; prompts and encryption happen before entering it. */
async function withStoreMutation<Value>(work: () => Promise<Value>): Promise<Value> {
  return await FS.withFileMutationLock(Repo.resolvePath(STORE_PATH), Repo.getRoot(), work)
}

async function writeStore(store: SecretStore): Promise<void> {
  const path = Repo.resolvePath(STORE_PATH)
  const temporary = `${path}.${Platform.randomUUID()}.tmp`
  await FS.mkdir(FS.dirname(path))
  try {
    await FS.writeText(temporary, formatStore(store), { mode: 0o600 })
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary)
  }
}

/**
 * createStoreKey makes the key every value is encrypted to and wraps its secret half to the machines. Wrapping
 * needs only their public keys, so the first `add` gives a store its key without anyone being prompted.
 */
async function createStoreKey(cipher: Cipher, recipients: readonly string[]): Promise<StoreKey> {
  const { recipient, secretKey } = await cipher.generateKey()
  const wrapped = await cipher.encrypt(secretKey, recipients)
  return { recipient, wrappedFor: [...recipients], wrappedKey: armorLines(wrapped) }
}

function armorLines(armor: string): string[] {
  return armor.trimEnd().split('\n')
}

/**
 * Prepare an encrypted batch without decrypting existing values or writing partial credentials.
 *
 * A store that has a store key is unlocked first, with the one use of this machine's credential, so a machine
 * that cannot read the store is refused before anyone is asked for a value. The unwrapped key is only proof;
 * values are encrypted to its public half, which needs nothing secret. The first value added to a store with
 * no store key creates one, and so establishes the credential rather than proving it.
 */
export async function prepareSecretBatch(environment: StoreAccess = liveStoreAccess()) {
  const original = await environment.read()
  if (original.recipients.length === 0) {
    Errors.throwUserInput('The secret store lists no recipients. Run `just secrets setup` first.')
  }
  if (original.storeKey !== undefined) {
    await unlockStoreKey(environment.cipher, original.storeKey)
  }
  return {
    existingNames: Object.keys(original.secrets),
    save: async (values: Readonly<Record<string, string>>, notes: Readonly<Record<string, string>> = {}) => {
      for (const [name, value] of Object.entries(values)) {
        requireSecretName(name)
        if (value.trim() === '') {
          Errors.throwUserInput('No value was entered, so nothing was stored.')
        }
      }
      const target = original.storeKey ?? await createStoreKey(environment.cipher, original.recipients)
      const encrypted: Record<string, string> = {}
      for (const [name, value] of Object.entries(values)) {
        encrypted[name] = await environment.cipher.encrypt(value, [target.recipient])
      }
      await withStoreMutation(async () => {
        const current = await environment.read()
        if (
          JSON.stringify(current.recipients) !== JSON.stringify(original.recipients)
          || Object.keys(values).some(name =>
            JSON.stringify(current.secrets[name]) !== JSON.stringify(original.secrets[name])
          )
        ) {
          Errors.throwUserInput(
            'The recipients or selected secrets changed during setup. Run setup again to preserve those changes.',
          )
        }
        // A key this batch did not unlock or create is one its values are not encrypted to. A grant keeps the
        // recipient, so it is kept here as well.
        if (current.storeKey?.recipient !== original.storeKey?.recipient) {
          Errors.throwUserInput(`The store key in ${STORE_PATH} changed while saving. Run the command again.`)
        }
        let updated: SecretStore = { ...current, storeKey: current.storeKey ?? target }
        for (const [name, armor] of Object.entries(encrypted)) {
          const note = notes[name]
          updated = withSecret(updated, name, armor, {
            now: environment.now(),
            ...(note === undefined ? {} : { note }),
          })
        }
        await environment.write(updated)
      })
    },
  }
}

/** decrypt writes every secret into the generated environment file, replacing it wholesale. */
async function decryptSecrets(environment: SecretsEnvironment): Promise<number> {
  const opened = await openSecrets(liveStoreAccess(environment.cipher, environment.now))
  const values = opened.values
  if (values.size === 0) {
    HCI.writeLine(`No secrets are stored yet. Add one with \`just secrets add <KEY>\`.`)
    return 0
  }
  const path = Repo.resolvePath(SecretsFile.ENV_PATH)
  // The plaintext store is owner-only. `mode` applies to a fresh file and this command rewrites an
  // existing one every run, so the mode is asserted afterwards as well.
  await FS.writeText(path, renderEnvFile(values, { generatedAt: environment.now() }), { mode: 0o600 })
  await FS.chmod(path, 0o600)
  HCI.writeSuccess(`Wrote ${values.size} ${values.size === 1 ? 'secret' : 'secrets'} to ${SecretsFile.ENV_PATH}.\n`)
  HCI.writeLine(`Anything you maintain by hand belongs in ${SecretsFile.LOCAL_PATH}, which this never writes.`)
  if (opened.granted > 0) {
    HCI.writeLine(
      `Granted the store key to ${opened.granted} newly recorded ${
        opened.granted === 1 ? 'machine' : 'machines'
      } in ${STORE_PATH}; commit it so they can read the secrets.`,
    )
  }
  if (opened.unsaved) {
    HCI.writeLine(`${STORE_PATH} changed while decrypting, so it was left alone; the next run updates it.`)
  }
  return 0
}

type OpenedSecrets = {
  values: Map<string, string>
  /** Machine recipients the store key was newly wrapped to. */
  granted: number
  /** Whether a grant was abandoned because the store changed underneath it. */
  unsaved: boolean
}

/**
 * openSecrets decrypts every value with one use of the machine identity: that one unwraps the store key, and
 * the store key decrypts the rest in software.
 *
 * A value not encrypted to the store key is refused, by name, before anything is decrypted: decrypting it with
 * the machine's credential would cost a prompt of its own. The same read wraps the store key to any machine
 * `setup` recorded since, which needs only that machine's public key; that is written back only if the store
 * did not change meanwhile, and otherwise is left for the next read.
 */
async function openSecrets(access: StoreAccess): Promise<OpenedSecrets> {
  const original = await access.read()
  const names = Object.keys(original.secrets).sort()
  const armorOf = (name: string) => original.secrets[name]!.value.join('\n')
  const unkeyed = names.filter(name => original.storeKey === undefined || !isStoreKeyArmor(armorOf(name)))
  if (unkeyed.length > 0) {
    const problem = original.storeKey === undefined
      ? `${STORE_PATH} holds secrets but records no store key to read them with`
      : `${STORE_PATH} holds secrets not encrypted to its store key, which would each need this machine's credential`
    Errors.throwUserInput(
      `${problem}: ${
        unkeyed.join(', ')
      }. Nothing was decrypted. Re-add each with \`just secrets add <NAME>\`, then run \`just secrets\` again.`,
    )
  }
  const opened: OpenedSecrets = { values: new Map(), granted: 0, unsaved: false }
  const storeKey = original.storeKey
  if (storeKey === undefined) {
    return opened
  }
  const ungranted = original.recipients.filter(recipient => !storeKey.wrappedFor.includes(recipient))
  if (names.length === 0 && ungranted.length === 0) {
    return opened
  }
  const secretKey = await unlockStoreKey(access.cipher, storeKey)
  for (const name of names) {
    // Decrypt without normalizing any byte represented by the UTF-8 plaintext string.
    try {
      opened.values.set(name, await access.cipher.decryptWithKey(armorOf(name), secretKey))
    } catch (error) {
      // Armor encrypted to another software key passes the header check and fails only here.
      Errors.throwUserInput(
        `${name} in ${STORE_PATH} does not decrypt with the store key (${
          Errors.asError(error).message
        }). Re-add it with \`just secrets add ${name}\`.`,
      )
    }
  }
  if (ungranted.length === 0) {
    return opened
  }
  const granted: StoreKey = {
    ...storeKey,
    wrappedFor: [...original.recipients],
    wrappedKey: armorLines(await access.cipher.encrypt(secretKey, original.recipients)),
  }
  await withStoreMutation(async () => {
    const current = await access.read()
    if (
      JSON.stringify(current.recipients) !== JSON.stringify(original.recipients)
      || JSON.stringify(current.storeKey) !== JSON.stringify(storeKey)
    ) {
      opened.unsaved = true
      return
    }
    opened.granted = ungranted.length
    await access.write({ ...current, storeKey: granted })
  })
  return opened
}

/**
 * unlockStoreKey is the one use of the machine identity that a read or an add makes, and so its one
 * fingerprint. The unwrapped key must be the one whose public half the store records: values are encrypted to
 * that half, so a different key would read nothing or, on an add, prove nothing about this machine.
 */
async function unlockStoreKey(cipher: Cipher, storeKey: StoreKey): Promise<string> {
  let secretKey: string
  try {
    secretKey = (await cipher.decrypt(storeKey.wrappedKey.join('\n'))).trim()
  } catch (error) {
    Errors.throwHostEnvironment(
      `This machine's credential does not unlock the secret store (${
        Errors.asError(error).message
      }). Its store key is wrapped for ${storeKey.wrappedFor.length} ${
        storeKey.wrappedFor.length === 1 ? 'machine' : 'machines'
      }. Run \`just secrets setup\` here if you have not, then run \`just secrets\` on a machine that can read the store, which grants every recorded machine, commit ${STORE_PATH} there, and pull it here.`,
    )
  }
  if (await cipher.recipientOfKey(secretKey) !== storeKey.recipient) {
    Errors.throwUserInput(
      `The store key this machine unwrapped is not the one ${STORE_PATH} records in storeKey.recipient, so nothing was read or written. Restore the storeKey block from the last commit that changed it.`,
    )
  }
  return secretKey
}

/**
 * add encrypts one pasted secret into the store, without echoing it or writing it anywhere in the clear. The
 * store is unlocked before the prompt, so a machine that cannot read it is refused before anything is pasted.
 */
async function addSecret(
  name: string,
  environment: SecretsEnvironment,
  note?: string,
  access: StoreAccess = liveStoreAccess(environment.cipher, environment.now),
): Promise<number> {
  const key = requireSecretName(name)
  const batch = await prepareSecretBatch(access)
  const secret = await environment.promptSecret(`Paste the value for ${key} (hidden; a paste submits itself):`)
  await batch.save({ [key]: secret }, note === undefined ? {} : { [key]: note })
  const replaced = batch.existingNames.includes(key)
  HCI.writeSuccess(`${replaced ? 'Replaced' : 'Added'} ${key} in ${STORE_PATH}.\n`)
  HCI.writeLine(`Run \`just secrets\` to write it into ${SecretsFile.ENV_PATH}.`)
  return 0
}

/** list says what is stored without decrypting anything, which is the common question. */
async function listSecrets(): Promise<number> {
  const store = await readStore()
  const names = Object.keys(store.secrets).sort()
  if (names.length === 0) {
    HCI.writeLine('No secrets are stored yet.')
    return 0
  }
  HCI.writeLine(`${names.length} ${names.length === 1 ? 'secret' : 'secrets'} in ${STORE_PATH}:`)
  for (const name of names) {
    const entry = store.secrets[name]!
    const when = entry.updatedAt ?? entry.addedAt
    HCI.writeLine(
      `  ${name.padEnd(28)} ${when === '' ? '' : when.slice(0, 10)}${
        entry.note === undefined ? '' : `  ${entry.note}`
      }`,
    )
  }
  return 0
}

/**
 * setup creates the machine's identity in the Secure Enclave and records its recipient. It is the one step a
 * person runs per machine; every worktree afterwards only needs `just secrets`.
 */
async function setupSecrets(): Promise<number> {
  const identity = identityFile()
  const existed = await FS.exists(identity)
  if (!existed) {
    await FS.mkdir(FS.dirname(identity))
    const created = await CLI.run('age-plugin-se', {
      args: ['keygen', '--access-control', 'any-biometry-or-passcode', '--output', identity],
    })
    if (created.exitCode !== 0) {
      Errors.throwHostEnvironment(
        `Could not create a Secure Enclave identity: ${
          created.stderr.trim() || `exit code ${created.exitCode ?? 'unknown'}`
        }`,
      )
    }
  }
  // Every run ends with the recipient recorded, whether or not this run created the identity. Stopping early
  // on an existing identity left a machine whose key worked and whose store listed no one to encrypt to, and
  // no command that would fix it.
  const recipient = await recipientOf(identity)
  const result = await withStoreMutation(async () => {
    const store = await readStore()
    if (store.recipients.includes(recipient)) {
      return { added: false, count: 0 }
    }
    await writeStore({ ...store, recipients: [...store.recipients, recipient] })
    return { added: true, count: Object.keys(store.secrets).length }
  })
  if (!result.added) {
    HCI.writeLine(`This machine can already read the repository's secrets. Identity: ${homePath(identity)}`)
    return 0
  }
  HCI.writeSuccess(
    existed
      ? `Recorded this machine's existing identity as a recipient.\n`
      : `This machine can now read the repository's secrets. Its key stays in the Secure Enclave.\n`,
  )
  HCI.writeLine(`Recipient added to ${STORE_PATH}; commit that so this machine keeps access.`)
  if (result.count > 0) {
    HCI.writeLine(
      `The ${result.count} secret(s) already stored were encrypted without this machine. The next \`just secrets\` on a machine that already reads them grants this one access; commit the store there and pull it here.`,
    )
  }
  return 0
}

/** Narrow test seam: a stand-in identity for the Secure Enclave, and the read and add paths over an in-memory store. */
export const SecretsCommand = { testing: { addSecret, ageCipher, openSecrets } } as const
