import { Errors, FS, Text } from '@shared'

/** Where the opt-in profiles live; permissions.jsonc beside it holds the default policy. */
export const PROFILES_SOURCE = '.rulesync/profiles.jsonc'

/**
 * AgentProfile is one opt-in overlay: what it prompts for, what leaves the sandbox, and what it
 * may write or reach that the default policy does not. `extends` folds another profile's
 * filesystem grants in; command lists are never inherited, because each harness spells them per file.
 */
export type AgentProfile = {
  description: string
  extends?: string
  /** Commands a person confirms before they run; they also leave the sandbox. */
  ask?: readonly string[]
  /** Commands that run without a prompt. */
  allow?: readonly string[]
  /** Commands that leave the sandbox beyond those in `ask`. */
  excludedCommands?: readonly string[]
  allowWrite?: readonly string[]
  unixSockets?: readonly string[]
  /** `false` turns the sandbox off altogether; every other field is then meaningless. */
  sandbox?: boolean
}

export type AgentProfiles = Readonly<Record<string, AgentProfile>>

/** parseProfiles reads the canonical JSONC profiles, whose comments JSON itself rejects. */
export function parseProfiles(source: string): AgentProfiles {
  const parsed = JSON.parse(Text.stripJsonc(source)) as { profiles?: AgentProfiles }
  const profiles = parsed.profiles ?? {}
  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.extends !== undefined && profiles[profile.extends] === undefined) {
      Errors.throwUserInput(`Profile '${name}' extends unknown profile '${profile.extends}' in ${PROFILES_SOURCE}.`)
    }
  }
  return profiles
}

/** readProfiles loads the profiles for a repository root. */
export async function readProfiles(root: string): Promise<AgentProfiles> {
  return parseProfiles(await FS.readText(FS.resolvePath(PROFILES_SOURCE, root)))
}

/** inheritedWritePaths is a profile's own write paths after those of every profile it extends. */
export function inheritedWritePaths(profiles: AgentProfiles, name: string): string[] {
  const profile = profiles[name]
  if (profile === undefined) {
    Errors.throwUserInput(`Unknown agent profile '${name}' in ${PROFILES_SOURCE}.`)
  }
  const inherited = profile.extends === undefined ? [] : inheritedWritePaths(profiles, profile.extends)
  return [...new Set([...inherited, ...(profile.allowWrite ?? [])])]
}
