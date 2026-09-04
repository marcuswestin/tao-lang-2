// `just secrets` — one step from a committed store to a usable environment file.
//
// The identity lives outside the repository, in the Secure Enclave of one Mac, so this is set up once per
// machine and never per worktree. Decrypting asks for a fingerprint because the kernel asks, not because
// this code does; nothing here ever sees or stores a passphrase.

import { CLI, Errors, FS, HCI, Repo } from '@shared'
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
/** Generated, git-ignored, wholly owned by this command. */
const ENV_PATH = '.env.secrets'
/** Hand-written, git-ignored, never written by this command. Named here only to say so in messages. */
const LOCAL_PATH = '.env.local'
/** Outside the repository, so every worktree on this machine shares one identity. */
const IDENTITY_PATH = '~/.config/tao/secrets-identity.txt'

export type SecretsEnvironment = {
  cipher: Cipher
  /** Reads a secret from the terminal without echoing it. */
  promptSecret: (label: string) => Promise<string>
  now: () => Date
}

/** liveEnvironment is what the command uses outside a test: real `age`, a real terminal, a real clock. */
export function liveEnvironment(): SecretsEnvironment {
  return {
    cipher: ageCipher(),
    now: () => new Date(),
    promptSecret: async label => await HCI.askSecret({ message: label }),
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
  return FS.resolvePath(IDENTITY_PATH.replace('~', process.env['HOME'] ?? '~'))
}

/** ageCipher shells out to `age`; the Secure Enclave plugin is what turns decryption into a Touch ID prompt. */
export function ageCipher(): Cipher {
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
export async function decryptSecrets(environment: SecretsEnvironment): Promise<number> {
  const store = await readStore()
  const names = Object.keys(store.secrets)
  if (names.length === 0) {
    HCI.writeLine(`No secrets are stored yet. Add one with \`just secrets add <KEY>\`.`)
    return 0
  }
  const values = new Map<string, string>()
  // One `age` call per secret means one Touch ID prompt per secret. The plugin coalesces prompts that arrive
  // together, and a store this size is a handful of keys, so this stays one interaction in practice.
  for (const name of names.sort()) {
    values.set(name, (await environment.cipher.decrypt(store.secrets[name]!.value.join('\n'))).trimEnd())
  }
  const path = Repo.resolvePath(ENV_PATH)
  await FS.writeText(path, renderEnvFile(values, { generatedAt: environment.now() }))
  HCI.writeSuccess(`Wrote ${values.size} ${values.size === 1 ? 'secret' : 'secrets'} to ${ENV_PATH}.`)
  HCI.writeLine(`Anything you maintain by hand belongs in ${LOCAL_PATH}, which this never writes.`)
  return 0
}

/** add encrypts one pasted secret into the store, without echoing it or writing it anywhere in the clear. */
export async function addSecret(name: string, environment: SecretsEnvironment, note?: string): Promise<number> {
  const key = requireSecretName(name)
  const store = await readStore()
  const secret = await environment.promptSecret(`Paste the value for ${key} (input is hidden):`)
  if (secret.trim() === '') {
    Errors.throwUserInput('No value was entered, so nothing was stored.')
  }
  const armor = await environment.cipher.encrypt(secret, store.recipients)
  await writeStore(withSecret(store, key, armor, { now: environment.now(), ...(note === undefined ? {} : { note }) }))
  const replaced = store.secrets[key] !== undefined
  HCI.writeSuccess(`${replaced ? 'Replaced' : 'Added'} ${key} in ${STORE_PATH}.`)
  HCI.writeLine(`Run \`just secrets\` to write it into ${ENV_PATH}.`)
  return 0
}

/** list says what is stored without decrypting anything, which is the common question. */
export async function listSecrets(): Promise<number> {
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
export async function setupSecrets(): Promise<number> {
  const identity = identityFile()
  if (await FS.exists(identity)) {
    HCI.writeLine(`This machine already has a secrets identity at ${FS.displayPath(identity)}.`)
    return 0
  }
  await FS.mkdir(FS.dirname(identity))
  const created = await CLI.run('age-plugin-se', {
    args: ['keygen', '--access-control', 'any-biometry', '--output', identity],
  })
  if (created.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Could not create a Secure Enclave identity: ${
        created.stderr.trim() || `exit code ${created.exitCode ?? 'unknown'}`
      }`,
    )
  }
  const recipient = await CLI.run('age-plugin-se', { args: ['recipient', '--input', identity] })
  if (recipient.exitCode !== 0 || recipient.stdout.trim() === '') {
    Errors.throwHostEnvironment('Created an identity but could not read its recipient.')
  }
  const store = await readStore()
  const line = recipient.stdout.trim()
  if (!store.recipients.includes(line)) {
    await writeStore({ ...store, recipients: [...store.recipients, line] })
  }
  HCI.writeSuccess(`This machine can now read the repository's secrets. Its identity stays in the Secure Enclave.`)
  HCI.writeLine(`Recipient added to ${STORE_PATH}; commit that so this machine keeps access.`)
  HCI.writeLine(
    'Secrets added before this machine existed cannot be read by it yet: whoever can read them must re-add them.',
  )
  return 0
}
