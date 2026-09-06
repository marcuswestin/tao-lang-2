import { FS, HCI } from '@shared'
import { type AgentProfiles, inheritedWritePaths, readProfiles } from './AgentProfiles'

/**
 * Claude Code's settings model has no named permission profiles, so each opt-in profile becomes a
 * whole settings file that `just claude-<name>` launches with. Rendering them from
 * `.rulesync/profiles.jsonc` keeps them in step with the Codex profiles rendered from the same source.
 */
const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json'

type ClaudeSettings = {
  $schema: string
  permissions?: { allow?: string[]; ask?: string[] }
  sandbox?: {
    enabled?: boolean
    excludedCommands?: string[]
    filesystem?: { allowWrite?: string[] }
  }
}

type GenerateClaudeProfilesOptions = {
  onSkip?: (message: string) => void
  root: string
  writeText?: (path: string, content: string) => Promise<void>
}

/** settingsPath names the file a profile renders to, relative to the repository root. */
function settingsPath(name: string): string {
  return `.claude/settings.${name}.json`
}

/** renderClaudeProfile renders one profile as a complete settings file. */
function renderClaudeProfile(profiles: AgentProfiles, name: string): string {
  const profile = profiles[name]!
  const settings: ClaudeSettings = { $schema: SETTINGS_SCHEMA }
  if (profile.sandbox === false) {
    settings.sandbox = { enabled: false }
    return `${JSON.stringify(settings, null, 2)}\n`
  }
  const ask = [...(profile.ask ?? [])].sort()
  const allow = [...(profile.allow ?? [])].sort()
  if (ask.length > 0 || allow.length > 0) {
    settings.permissions = {
      ...(allow.length === 0 ? {} : { allow: allow.map(pattern => `Bash(${pattern})`) }),
      ...(ask.length === 0 ? {} : { ask: ask.map(pattern => `Bash(${pattern})`) }),
    }
  }
  // A prompted command runs outside the sandbox: the prompt is the boundary, not the sandbox.
  const excludedCommands = [...new Set([...ask, ...(profile.excludedCommands ?? [])])].sort()
  const allowWrite = inheritedWritePaths(profiles, name).sort()
  if (excludedCommands.length > 0 || allowWrite.length > 0) {
    settings.sandbox = {
      ...(excludedCommands.length === 0 ? {} : { excludedCommands }),
      ...(allowWrite.length === 0 ? {} : { filesystem: { allowWrite } }),
    }
  }
  return `${JSON.stringify(settings, null, 2)}\n`
}

async function generateClaudeProfiles(options: GenerateClaudeProfilesOptions): Promise<void> {
  const profiles = await readProfiles(options.root)
  for (const name of Object.keys(profiles)) {
    const path = FS.resolvePath(settingsPath(name), options.root)
    try {
      await (options.writeText ?? FS.writeText)(path, renderClaudeProfile(profiles, name))
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code !== 'EACCES' && code !== 'EPERM') {
        throw error
      }
      ;(options.onSkip ?? HCI.writeErrorLine)(`Skipped claudecode profile '${name}': ${path} is not writable.`)
    }
  }
}

/** ClaudeProfilesGenerator renders Claude Code's opt-in settings files from the canonical profiles. */
export const ClaudeProfilesGenerator = {
  generate: generateClaudeProfiles,
  render: renderClaudeProfile,
  settingsPath,
}
