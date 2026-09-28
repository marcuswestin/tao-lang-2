// The committed secret store: readable keys, readable metadata, encrypted values.
//
// Each value is encrypted on its own rather than the file being encrypted as a whole. That is the difference
// between a store several worktrees can edit and one they cannot: two people adding different keys touch
// different lines and merge, where a whole-file scheme (SOPS included, whose MAC covers every value) produces
// a conflict no one can resolve by hand because both sides are opaque.
//
// One credential opens everything. Values are encrypted to one store key rather than to each machine, and
// only the store key's secret half is encrypted to each machine. Reading one secret, many, or all of them,
// and adding one, each use the machine's credential exactly once, to unwrap that key, and check the unwrapped
// key against the public half the store records. A value not encrypted to the store key is refused rather
// than decrypted with the machine's credential, so a Secure Enclave identity never asks once per value.
//
// Nothing here does cryptography. `Cipher` is the seam to `age`, which owns all of it.

import { Errors, Json } from '@shared'

/** Cipher is the encryption boundary. The real one shells out to `age`; a test supplies its own. */
export type Cipher = {
  /** Encrypts to every recipient, returning ASCII armor. It needs only public keys, so it never prompts. */
  encrypt: (plaintext: string, recipients: readonly string[]) => Promise<string>
  /**
   * Decrypts armor with the machine's identity. With a Secure Enclave identity this prompts for Touch ID or the
   * login passcode, so the store calls it only to unwrap the store key, never for a value.
   */
  decrypt: (armor: string) => Promise<string>
  /** Decrypts armor with a software secret key such as the store key, which never prompts. */
  decryptWithKey: (armor: string, secretKey: string) => Promise<string>
  /** Creates a fresh software key pair; the secret half must be wrapped before anything stores it. */
  generateKey: () => Promise<{ recipient: string; secretKey: string }>
  /** Derives the public recipient of a software secret key, which proves an unwrapped key is the recorded one. */
  recipientOfKey: (secretKey: string) => Promise<string>
}

/** StoreKey is the key every value is encrypted to. Only its public half is readable in the committed file. */
export type StoreKey = {
  /** The public half, which values are encrypted to and which an unwrapped secret half must match. */
  recipient: string
  /**
   * The machine recipients `wrappedKey` is encrypted to. A recipient listed in the store but missing here was
   * recorded after the last wrap, and the next read on a machine that has the key grants it.
   */
  wrappedFor: readonly string[]
  /** The secret half, age armor encrypted to `wrappedFor`, one line per array entry. */
  wrappedKey: readonly string[]
}

type SecretEntry = {
  /** When this value was first added, so a stale credential is visible without decrypting anything. */
  addedAt: string
  /** When it was last replaced, absent until it has been. */
  updatedAt?: string
  /** Why this exists and what would break without it. Written by a person, never generated. */
  note?: string
  /** The armor, one line per array entry, so a diff shows a changed secret as changed lines. */
  value: readonly string[]
}

export type SecretStore = {
  /**
   * The machines that can read the store, one age recipient each. The store key is wrapped to these; reading
   * needs the matching identity, which for a Secure Enclave recipient exists on exactly one Mac.
   */
  recipients: readonly string[]
  /** Absent until the first value is added; a store holding values without one cannot be read. */
  storeKey?: StoreKey
  secrets: Readonly<Record<string, SecretEntry>>
}

const HEADER = `// Tao's committed secrets. Values are encrypted with age; keys, notes and dates are not.
//
// Every value is encrypted to the store key, whose secret half is itself encrypted to each machine in the
// recipients below. Reading or adding unwraps that key once with this machine's credential, so one
// fingerprint covers the whole store, and a value not encrypted to the store key is refused, never decrypted.
// A Secure Enclave recipient lives in one Mac's hardware, so a copy of this file is useless to anyone else.
//
// Do not hand-edit a value. Use \`just secrets add <KEY>\`, which encrypts what you paste and never echoes it.
`

/** parseStore reads the committed JSONC, rejecting a shape that would silently lose a secret. */
export function parseStore(text: string): SecretStore {
  const stripped = text.replace(/^\s*\/\/.*$/gm, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.trim() === '' ? '{}' : stripped)
  } catch (error) {
    Errors.throwUserInput(
      `The secret store is not valid JSONC: ${String(error instanceof Error ? error.message : error)}`,
    )
  }
  if (!Json.isRecord(parsed)) {
    Errors.throwUserInput('The secret store must be a JSON object.')
  }
  const record = parsed as { recipients?: unknown; secrets?: unknown; storeKey?: unknown }
  if (
    record.recipients !== undefined
    && (!Array.isArray(record.recipients) || record.recipients.some(recipient => typeof recipient !== 'string'))
  ) {
    Errors.throwUserInput("The secret store's recipients must be an array of strings.")
  }
  if (record.secrets !== undefined && !Json.isRecord(record.secrets)) {
    Errors.throwUserInput("The secret store's secrets must be an object.")
  }
  const recipients = record.recipients === undefined ? [] : record.recipients as string[]
  const storeKey = record.storeKey === undefined ? undefined : parseStoreKey(record.storeKey)
  const secrets: Record<string, SecretEntry> = {}
  const rawSecrets = Json.isRecord(record.secrets) ? record.secrets : {}
  for (const [name, entry] of Object.entries(rawSecrets)) {
    if (!Json.isRecord(entry)) {
      Errors.throwUserInput(`Secret '${name}' is not an object.`)
    }
    const value = (entry as { value?: unknown }).value
    if (!Array.isArray(value) || value.some(line => typeof line !== 'string')) {
      Errors.throwUserInput(`Secret '${name}' has no armor lines; its value must be an array of strings.`)
    }
    const addedAt = (entry as { addedAt?: unknown }).addedAt
    secrets[name] = {
      addedAt: typeof addedAt === 'string' ? addedAt : '',
      value: value as string[],
      ...(typeof (entry as { note?: unknown }).note === 'string' ? { note: (entry as { note: string }).note } : {}),
      ...(typeof (entry as { updatedAt?: unknown }).updatedAt === 'string'
        ? { updatedAt: (entry as { updatedAt: string }).updatedAt }
        : {}),
    }
  }
  return { recipients, ...(storeKey === undefined ? {} : { storeKey }), secrets }
}

/** A store key missing any part is refused: guessing would re-encrypt values to a key no machine can unwrap. */
function parseStoreKey(value: unknown): StoreKey {
  const isStrings = (lines: unknown): lines is string[] =>
    Array.isArray(lines) && lines.every(line => typeof line === 'string')
  const key = Json.isRecord(value) ? value as { recipient?: unknown; wrappedFor?: unknown; wrappedKey?: unknown } : {}
  if (
    typeof key.recipient !== 'string' || !isStrings(key.wrappedFor) || !isStrings(key.wrappedKey)
    || key.wrappedKey.length === 0
  ) {
    Errors.throwUserInput(
      "The secret store's storeKey needs a recipient string and wrappedFor and wrappedKey string arrays.",
    )
  }
  return { recipient: key.recipient, wrappedFor: key.wrappedFor, wrappedKey: key.wrappedKey }
}

/**
 * isStoreKeyArmor says whether armor was encrypted to the store key rather than straight to a machine, by
 * reading the recipient types in its age header. The store key is the store's only software (X25519)
 * recipient; a machine recipient is a Secure Enclave one, whose header stanza is of another type.
 */
export function isStoreKeyArmor(armor: string): boolean {
  const body = armor.split('\n').filter(line => !line.startsWith('-----')).join('')
  const header = Buffer.from(body, 'base64').toString('latin1').split('\n--- ')[0] ?? ''
  return header.split('\n').some(line => line.startsWith('-> X25519 '))
}

/**
 * formatStore writes the store back with its keys sorted, so an added secret is a clean insertion.
 *
 * The body is ordinary two-space JSON because dprint formats this file too, and a formatter of our own with
 * different taste would rewrite the file on every `add` and dprint would rewrite it back.
 */
export function formatStore(store: SecretStore, options: { header?: string } = {}): string {
  const ordered: Record<string, SecretEntry> = {}
  for (const name of Object.keys(store.secrets).sort()) {
    const entry = store.secrets[name]!
    ordered[name] = {
      addedAt: entry.addedAt,
      ...(entry.note === undefined ? {} : { note: entry.note }),
      ...(entry.updatedAt === undefined ? {} : { updatedAt: entry.updatedAt }),
      value: entry.value,
    }
  }
  const storeKey = store.storeKey === undefined ? {} : {
    storeKey: {
      recipient: store.storeKey.recipient,
      wrappedFor: store.storeKey.wrappedFor,
      wrappedKey: store.storeKey.wrappedKey,
    },
  }
  return `${options.header ?? HEADER}${
    JSON.stringify({ recipients: store.recipients, ...storeKey, secrets: ordered }, undefined, 2)
  }\n`
}

/** withSecret returns a store with one secret added or replaced, keeping the date it was first added. */
export function withSecret(
  store: SecretStore,
  name: string,
  armor: string,
  options: { now: Date; note?: string },
): SecretStore {
  const existing = store.secrets[name]
  const stamp = options.now.toISOString()
  return {
    ...store,
    secrets: {
      ...store.secrets,
      [name]: {
        addedAt: existing?.addedAt !== undefined && existing.addedAt !== '' ? existing.addedAt : stamp,
        value: armor.trimEnd().split('\n'),
        ...(options.note === undefined ? existing?.note === undefined ? {} : { note: existing.note } : {
          note: options.note,
        }),
        ...(existing === undefined ? {} : { updatedAt: stamp }),
      },
    },
  }
}

/** SECRET_NAME is the shape of an environment variable, which is all a secret is ever used as. */
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/

export function requireSecretName(name: string): string {
  if (!SECRET_NAME.test(name)) {
    Errors.throwUserInput(
      `'${name}' is not a usable secret name. Use the environment variable it becomes: capitals, digits and underscores, such as ANTHROPIC_API_KEY.`,
    )
  }
  return name
}

/**
 * renderEnvFile writes the generated environment file. It is wholly owned by this command: it carries a
 * header saying so, and anything a person wants to keep belongs in the file the tooling never writes.
 */
export function renderEnvFile(values: ReadonlyMap<string, string>, options: { generatedAt: Date }): string {
  const lines = [...values.keys()].sort().map(name => `${name}=${JSON.stringify(values.get(name)!)}`)
  return `# Generated by \`just secrets\` at ${options.generatedAt.toISOString()}. Do not edit.
# Every run replaces this file. Put anything you maintain by hand in .env.local, which nothing generates.
# tao-secret-format: json-v1
${lines.join('\n')}
`
}
