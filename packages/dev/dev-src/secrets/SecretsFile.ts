// Reading the decrypted secrets back, for the one command that needs them.
//
// These are deliberately not exported into the process environment. Studio starts Metro, Expo, a Swift
// helper and whatever an agent asks it to run, and all of them inherit an environment; a key that only the
// chat provider needs should not travel that far. The values are handed to the provider as a plain object
// instead, so nothing Studio spawns can read them.

import { FS, Repo } from '@shared'

/** Written by `just secrets`; absent until someone has run it. */
const ENV_PATH = '.env.secrets'
/** Written by hand, never by tooling, and read second so it wins. */
const LOCAL_PATH = '.env.local'

/** parseEnvFile reads the `KEY='value'` lines this repository generates, and plain `KEY=value` besides. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const name = trimmed.slice(0, separator).trim()
    const raw = trimmed.slice(separator + 1).trim()
    values[name] = raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2
      // The generator quotes with the shell's own escape, so undo exactly that.
      ? raw.slice(1, -1).replaceAll("'\\''", "'")
      : raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
      ? raw.slice(1, -1)
      : raw
  }
  return values
}

/**
 * readDecryptedSecrets returns what `just secrets` last wrote, with anything hand-maintained layered over it.
 * It returns nothing rather than failing when the files are absent: not having run `just secrets` is an
 * ordinary state, and the command that wanted a secret says so in its own words.
 */
export async function readDecryptedSecrets(): Promise<Record<string, string>> {
  const merged: Record<string, string> = {}
  for (const relative of [ENV_PATH, LOCAL_PATH]) {
    const path = Repo.resolvePath(relative)
    try {
      if (await FS.exists(path)) {
        Object.assign(merged, parseEnvFile(await FS.readText(path)))
      }
    } catch {
      // Unreadable is not fatal, and it is not even unusual: an agent's sandbox denies these paths on
      // purpose. Studio starts either way and says the chat has no key, which is the truth of the matter.
    }
  }
  return merged
}
