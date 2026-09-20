// `just secrets` — one step from a committed store to a usable environment file.
//
// The identity lives outside the repository, in the Secure Enclave of one Mac, so this is set up once per
// machine and never per worktree. Decrypting asks for a fingerprint because the kernel asks, not because
// this code does; nothing here ever sees or stores a passphrase.

import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'
import { ENV_PATH, LOCAL_PATH } from './SecretsFile'
import {
  type Cipher,
  formatStore,
  parseStore,
  renderEnvFile,
  requireSecretName,
  type SecretStore,
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

/** ageCipher shells out to `age`; the Secure Enclave plugin is what turns decryption into a Touch ID prompt. */
function ageCipher(): Cipher {
  return {
    decrypt: async armor => {
      const identity = identityFile()
      if (!await FS.exists(identity)) {
        Errors.throwHostEnvironment(
          `No secrets identity at ${FS.displayPath(identity)}. Run \`just secrets setup\` once on this machine.`,
        )
      }
      const result = await CLI.run('age', { args: ['--decrypt', '--identity', identity], stdin: armor })
      if (result.exitCode !== 0) {
        Errors.throwHostEnvironment(
          `age could not decrypt a secret: ${result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`}`,
        )
      }
      return result.stdout
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
        Errors.throwHostEnvironment(
          `age could not encrypt a secret: ${result.stderr.trim() || `exit code ${result.exitCode ?? 'unknown'}`}`,
        )
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

async function writeStore(store: SecretStore): Promise<void> {
  const path = Repo.resolvePath(STORE_PATH)
  await FS.mkdir(FS.dirname(path))
  await FS.writeText(path, formatStore(store))
}

/** decrypt writes every secret into the generated environment file, replacing it wholesale. */
async function decryptSecrets(environment: SecretsEnvironment): Promise<number> {
  const store = await readStore()
  const names = Object.keys(store.secrets)
  if (names.length === 0) {
    HCI.writeLine(`No secrets are stored yet. Add one with \`just secrets add <KEY>\`.`)
    return 0
  }
  const values = await decryptedValues(store, environment.cipher)
  const path = Repo.resolvePath(ENV_PATH)
  // The plaintext store is owner-only. `mode` applies to a fresh file and this command rewrites an
  // existing one every run, so the mode is asserted afterwards as well.
  await FS.writeText(path, renderEnvFile(values, { generatedAt: environment.now() }), { mode: 0o600 })
  await FS.chmod(path, 0o600)
  HCI.writeSuccess(`Wrote ${values.size} ${values.size === 1 ? 'secret' : 'secrets'} to ${ENV_PATH}.\n`)
  HCI.writeLine(`Anything you maintain by hand belongs in ${LOCAL_PATH}, which this never writes.`)
  return 0
}

/** Decrypt without normalizing any byte represented by the UTF-8 plaintext string. */
async function decryptedValues(store: SecretStore, cipher: Cipher): Promise<Map<string, string>> {
  const values = new Map<string, string>()
  // One `age` call per secret means one Touch ID prompt per secret. The plugin coalesces prompts that arrive
  // together, and a store this size is a handful of keys, so this stays one interaction in practice.
  for (const name of Object.keys(store.secrets).sort()) {
    values.set(name, await cipher.decrypt(store.secrets[name]!.value.join('\n')))
  }
  return values
}

/** add encrypts one pasted secret into the store, without echoing it or writing it anywhere in the clear. */
async function addSecret(name: string, environment: SecretsEnvironment, note?: string): Promise<number> {
  const key = requireSecretName(name)
  const store = await readStore()
  // Everything that can refuse this is checked before a secret is asked for. Asking someone to paste a
  // credential and only then saying it cannot be stored wastes the one action that has to be deliberate.
  if (store.recipients.length === 0) {
    Errors.throwUserInput(
      'The secret store lists no recipients, so nothing could read what you pasted. Run `just secrets setup` first.',
    )
  }
  const secret = await environment.promptSecret(`Paste the value for ${key} (hidden; a paste submits itself):`)
  if (secret.trim() === '') {
    Errors.throwUserInput('No value was entered, so nothing was stored.')
  }
  const armor = await environment.cipher.encrypt(secret, store.recipients)
  await writeStore(withSecret(store, key, armor, { now: environment.now(), ...(note === undefined ? {} : { note }) }))
  const replaced = store.secrets[key] !== undefined
  HCI.writeSuccess(`${replaced ? 'Replaced' : 'Added'} ${key} in ${STORE_PATH}.\n`)
  HCI.writeLine(`Run \`just secrets\` to write it into ${ENV_PATH}.`)
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
  const store = await readStore()
  if (store.recipients.includes(recipient)) {
    HCI.writeLine(`This machine can already read the repository's secrets. Identity: ${homePath(identity)}`)
    return 0
  }
  await writeStore({ ...store, recipients: [...store.recipients, recipient] })
  HCI.writeSuccess(
    existed
      ? `Recorded this machine's existing identity as a recipient.\n`
      : `This machine can now read the repository's secrets. Its key stays in the Secure Enclave.\n`,
  )
  HCI.writeLine(`Recipient added to ${STORE_PATH}; commit that so this machine keeps access.`)
  if (Object.keys(store.secrets).length > 0) {
    HCI.writeLine(
      `The ${
        Object.keys(store.secrets).length
      } secret(s) already stored were encrypted without this machine. Someone who can read them must run \`just secrets add\` again for each.`,
    )
  }
  return 0
}

/** Narrow test seam for proving the ciphertext-to-plaintext boundary is byte preserving. */
export const SecretsCommand = { testing: { decryptedValues } } as const
