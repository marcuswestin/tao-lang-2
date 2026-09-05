// The committed secret store: readable keys, readable metadata, encrypted values.
//
// Each value is encrypted on its own rather than the file being encrypted as a whole. That is the difference
// between a store several worktrees can edit and one they cannot: two people adding different keys touch
// different lines and merge, where a whole-file scheme (SOPS included, whose MAC covers every value) produces
// a conflict no one can resolve by hand because both sides are opaque.
//
// Nothing here does cryptography. `Cipher` is the seam to `age`, which owns all of it.

import { Errors } from '@shared'

/** Cipher is the encryption boundary. The real one shells out to `age`; a test supplies its own. */
export type Cipher = {
  /** Encrypts to every recipient, returning ASCII armor. */
  encrypt: (plaintext: string, recipients: readonly string[]) => Promise<string>
  /** Decrypts armor with the machine's identity. With a Secure Enclave identity this prompts for Touch ID. */
  decrypt: (armor: string) => Promise<string>
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
   * The age recipients every value is encrypted to. A machine can add a secret with only these; reading one
   * needs the matching identity, which for a Secure Enclave recipient exists on exactly one Mac.
   */
  recipients: readonly string[]
  secrets: Readonly<Record<string, SecretEntry>>
}

const HEADER = `// Tao's committed secrets. Values are encrypted with age; keys, notes and dates are not.
//
// Reading one needs the identity named in the recipients below. A Secure Enclave recipient lives in one
// Mac's hardware, so a copy of this file is useless to anyone else, including whoever clones the repository.
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
  if (typeof parsed !== 'object' || parsed === null) {
    Errors.throwUserInput('The secret store must be a JSON object.')
  }
  const record = parsed as { recipients?: unknown; secrets?: unknown }
  const recipients = Array.isArray(record.recipients) ? record.recipients.map(String) : []
  const secrets: Record<string, SecretEntry> = {}
  const rawSecrets = typeof record.secrets === 'object' && record.secrets !== null ? record.secrets : {}
  for (const [name, entry] of Object.entries(rawSecrets as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) {
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
  return { recipients, secrets }
}

/**
 * formatStore writes the store back with its keys sorted, so an added secret is a clean insertion.
 *
 * The body is ordinary two-space JSON because dprint formats this file too, and a formatter of our own with
 * different taste would rewrite the file on every `add` and dprint would rewrite it back.
 */
export function formatStore(store: SecretStore): string {
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
  return `${HEADER}${JSON.stringify({ recipients: store.recipients, secrets: ordered }, undefined, 2)}\n`
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
    recipients: store.recipients,
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
  const lines = [...values.keys()].sort().map(name => `${name}=${quoteEnvValue(values.get(name)!)}`)
  return `# Generated by \`just secrets\` at ${options.generatedAt.toISOString()}. Do not edit.
# Every run replaces this file. Put anything you maintain by hand in .env.local, which nothing generates.
${lines.join('\n')}
`
}

/** quoteEnvValue keeps a secret on one line and safe for a dotenv reader to hand back unchanged. */
function quoteEnvValue(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}
