import { Assert, Errors, FS, Text } from '@shared'
import { DELEGATION_SKILL_PATH, tierModels } from '../delegation/DelegationProfiles'
import { type AgentProfiles, PROFILES_SOURCE, readProfiles } from './AgentProfiles'

/**
 * Codex CLI's permission profile is generated here rather than by rulesync: rulesync's Codex
 * translator cannot express loopback binding, Unix sockets, or a curated domain allowlist, and
 * emits an open `"*" = "allow"` profile instead. This renderer reads the same canonical rules
 * Claude Code's settings come from, so the two policies cannot drift apart by hand.
 */
const PERMISSIONS_SOURCE = '.rulesync/permissions.jsonc'
const CODEX_CONFIG_OUTPUT = '.codex/config.toml'
const CODEX_RULES_OUTPUT = '.codex/rules/tao.rules'

/** The profile name every generated rule hangs off, and the Codex built-in it narrows. */
const PROFILE = 'tao-workspace'
const PROFILE_BASE = ':workspace'
const REVIEW_PROFILE = 'tao-review'
const UNRESTRICTED_PROFILE_BASE = ':danger-full-access'

/**
 * Paths and settings Codex needs that the canonical rules do not describe, because they are
 * Codex-shaped rather than policy-shaped. The Git directory is spelled for the primary checkout
 * on purpose: the generated file is committed, so it cannot carry a linked worktree's path.
 */
const PRIMARY_GIT_DIRECTORY = '~/code/tao-lang-2/.git'

/**
 * What a Codex subagent gets when its caller names nothing. The model is read from the tier table in
 * the `delegation` skill rather than written here, so the guidance an agent reads and the default a
 * harness applies cannot disagree. Standard is the default tier because inheritance would otherwise
 * hand mechanical work whatever the orchestrator happens to be running.
 */
const DEFAULT_SUBAGENT_TIER = 'standard'
const DEFAULT_SUBAGENT_EFFORT = 'medium'

/** The upper end of the concurrency the `delegation` skill calls the working range. */
const MAX_CONCURRENT_SUBAGENTS = 5

/** CanonicalPermissions is the subset of `.rulesync/permissions.jsonc` this renderer reads. */
type CanonicalPermissions = {
  codex?: {
    outsideSandboxCommands?: readonly string[]
  }
  claudecode?: {
    sandbox?: {
      excludedCommands?: readonly string[]
      filesystem?: {
        allowWrite?: readonly string[]
      }
      network?: {
        allowLocalBinding?: boolean
        allowUnixSockets?: readonly string[]
        allowedDomains?: readonly string[]
      }
    }
  }
  permission?: {
    bash?: Record<string, string>
    read?: Record<string, string>
  }
}

type GenerateCodexConfigOptions = {
  onSkip?: (message: string) => void
  root: string
  writeText?: (path: string, content: string) => Promise<void>
}

async function generateCodexConfig(options: GenerateCodexConfigOptions): Promise<void> {
  const permissions = parsePermissions(await FS.readText(FS.resolvePath(PERMISSIONS_SOURCE, options.root)))
  const profiles = await readProfiles(options.root)
  const skillPath = FS.resolvePath(DELEGATION_SKILL_PATH, options.root)
  const delegationSkill = await FS.isFile(skillPath) ? await FS.readText(skillPath) : ''
  const outputs = [
    {
      content: renderCodexConfig(permissions, profiles, delegationSkill),
      path: FS.resolvePath(CODEX_CONFIG_OUTPUT, options.root),
    },
    { content: renderCodexRules(permissions), path: FS.resolvePath(CODEX_RULES_OUTPUT, options.root) },
  ]
  for (const output of outputs) {
    if (await FS.isFile(output.path) && await FS.readText(output.path) === output.content) {
      continue
    }
    try {
      await (options.writeText ?? FS.writeText)(output.path, output.content)
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code !== 'EACCES' && code !== 'EPERM') {
        throw error
      }
      const message = `Codex permissions are stale but ${output.path} is not writable. `
        + 'Pause and ask Ro to approve an unsandboxed `./agent setup`; do not commit stale generated rules.'
      options.onSkip?.(message)
      Errors.throwHostEnvironment(message)
    }
  }
}

/** parsePermissions reads the canonical JSONC rules, whose comments JSON itself rejects. */
function parsePermissions(source: string): CanonicalPermissions {
  return JSON.parse(Text.stripJsonc(source)) as CanonicalPermissions
}

/** renderCodexConfig renders the whole `.codex/config.toml` from the canonical rules and profiles. */
function renderCodexConfig(
  permissions: CanonicalPermissions,
  profiles: AgentProfiles,
  /** Empty when the skill is unreadable, which drops the delegation defaults rather than guessing. */
  delegationSkill = '',
): string {
  const read = permissions.permission?.read ?? {}
  const allowWrite = permissions.claudecode?.sandbox?.filesystem?.allowWrite ?? []
  const network = permissions.claudecode?.sandbox?.network ?? {}
  return [
    ...header(),
    '',
    `default_permissions = ${quote(PROFILE)}`,
    'approval_policy = "on-request"',
    'approvals_reviewer = "auto_review"',
    '',
    '# Live retrieval so agents can research language, tooling, and dependency questions',
    '# without an approval round-trip.',
    'web_search = "live"',
    '',
    '# Required for the per-profile domain rules below to be enforced.',
    '[features]',
    'network_proxy = true',
    '',
    ...agentsSection(delegationSkill),
    `[permissions.${REVIEW_PROFILE}]`,
    'extends = ":read-only"',
    'description = "Tao review: inspect the worktree and reference repository without editing them."',
    '',
    ...filesystemSection(REVIEW_PROFILE, read, []),
    '',
    ...workspaceRootsSection(REVIEW_PROFILE, read),
    '',
    ...networkSection(REVIEW_PROFILE, { ...network, allowLocalBinding: false }, []),
    '',
    `[permissions.${PROFILE}]`,
    `extends = ${quote(PROFILE_BASE)}`,
    'description = "Tao worktree: write the workspace, read the reference repo, reach documentation and package hosts."',
    '',
    ...filesystemSection(PROFILE, read, allowWrite),
    '',
    ...workspaceRootsSection(PROFILE, read),
    '',
    ...networkSection(PROFILE, network, network.allowUnixSockets ?? []),
    '',
    ...Object.entries(profiles).flatMap(([name, profile]) => renderOverlayProfile(name, profile)),
    '',
  ].join('\n')
}

/**
 * agentsSection gives Codex the delegation defaults that `.codex/agents/*.toml` cannot carry,
 * because those files describe one role each and say nothing about the role a caller did not name.
 * Per-role `[agents.<name>]` tables are deliberately absent: Codex already discovers the generated
 * role files, and declaring each role twice would let the two spellings drift.
 */
function agentsSection(delegationSkill: string): string[] {
  const model = tierModels(delegationSkill, 'codex').get(DEFAULT_SUBAGENT_TIER)
  if (model === undefined) {
    return []
  }
  return [
    `# Delegation defaults. The model is the ${DEFAULT_SUBAGENT_TIER} tier of the routing table in`,
    `# ${DELEGATION_SKILL_PATH}, which is the one place this repository spells a model name.`,
    '[agents]',
    'enabled = true',
    `default_subagent_model = ${quote(model)}`,
    `default_subagent_reasoning_effort = ${quote(DEFAULT_SUBAGENT_EFFORT)}`,
    `max_concurrent_threads_per_session = ${MAX_CONCURRENT_SUBAGENTS}`,
    '',
  ]
}

/** Each canonical overlay becomes a matching opt-in Codex profile without a name-specific branch. */
function renderOverlayProfile(name: string, profile: AgentProfiles[string]): string[] {
  const codexName = overlayProfileName(name)
  const base = profile.sandbox === false
    ? UNRESTRICTED_PROFILE_BASE
    : profile.extends === undefined
    ? PROFILE
    : overlayProfileName(profile.extends)
  const lines = [
    `[permissions.${codexName}]`,
    `extends = ${quote(base)}`,
    `description = ${quote(profile.description)}`,
  ]
  if (profile.sandbox === false) {
    // AgentProfiles defines every other field as meaningless once the sandbox is disabled. Keeping
    // this profile to a known Codex built-in avoids accidentally layering partial sandbox grants on
    // an unrestricted profile while still requiring a person to opt in to it by name.
    return lines
  }
  if ((profile.allowWrite?.length ?? 0) > 0) {
    lines.push('', ...directFilesystemSection(codexName, profile.allowWrite ?? []))
  }
  if ((profile.unixSockets?.length ?? 0) > 0) {
    lines.push('', ...unixSocketSection(codexName, profile.unixSockets ?? []))
  }
  return [...lines, '']
}

function overlayProfileName(name: string): string {
  return `tao-${name}`
}

/**
 * renderCodexRules normally emits only fixed command shapes that are both auto-approved and
 * excluded from Claude's sandbox. Mutable entrypoints need a separate, explicit Codex grant:
 * a prefix rule runs the command and everything it spawns with host access, including edited
 * repository code. The canonical list is validated against Claude's allow and exclusion rules.
 */
function renderCodexRules(permissions: CanonicalPermissions): string {
  const bash = Object.entries(permissions.permission?.bash ?? {})
  const allowed = bash
    .filter(([, action]) => action === 'allow')
    .map(([pattern]) => pattern)
  const excluded = permissions.claudecode?.sandbox?.excludedCommands ?? []
  const prefixes = allowed
    .filter(pattern => excluded.some(exclusion => commandPatternCovers(exclusion, pattern)))
    .map(fixedCommandPattern)
    .filter((tokens): tokens is string[] => tokens !== undefined)
  const hostCommands = (permissions.codex?.outsideSandboxCommands ?? []).map(command => {
    const tokens = fixedCommandPattern(command)
    Assert(
      tokens !== undefined && allowed.some(pattern => commandPatternCovers(pattern, command))
        && excluded.some(pattern => commandPatternCovers(pattern, command)),
      `Codex host command ${command} to be fixed, allowed, and excluded by Claude Code`,
    )
    return tokens
  })
  const unique = new Map([...prefixes, ...hostCommands].map(tokens => [JSON.stringify(tokens), tokens]))
  const denied = bash
    .filter(([, action]) => action === 'deny')
    .map(([pattern]) => parseCommandPattern(pattern)?.prefix)
    .filter((tokens): tokens is string[] => tokens !== undefined)
  const uniqueDenied = new Map(denied.map(tokens => [JSON.stringify(tokens), tokens]))
  return [
    '# Generated by `./agent setup` from .rulesync/permissions.jsonc. Edit that file, not this one.',
    '# These commands need host capabilities the sandbox cannot express. The explicitly listed',
    '# landing entrypoint also runs its repository code and child processes outside the sandbox.',
    '# Other allowed commands remain inside the active filesystem and network permission profile.',
    '',
    ...[...unique.values()].map(tokens =>
      `prefix_rule(pattern=${
        JSON.stringify(tokens)
      }, decision="allow", justification="Repository-approved host command.")`
    ),
    ...[...uniqueDenied.values()].map(tokens =>
      `prefix_rule(pattern=${
        JSON.stringify(tokens)
      }, decision="forbidden", justification="Use ./agent setup for repository dependencies.")`
    ),
    '',
  ].join('\n')
}

/**
 * Codex spells "this apex and everything under it" as `**.example.com`, where Claude Code needs
 * the apex and a `*.` wildcard as two entries. Collapsing them keeps one allowlist authoritative:
 * a bare host already covered by a wildcard apex is dropped rather than emitted twice.
 */
function codexDomains(allowedDomains: readonly string[]): string[] {
  const wildcardApexes = allowedDomains
    .filter(domain => domain.startsWith('*.'))
    .map(domain => domain.slice(2))
  const covered = (domain: string) => wildcardApexes.some(apex => domain === apex || domain.endsWith(`.${apex}`))
  const domains = allowedDomains.flatMap(domain =>
    domain.startsWith('*.') ? [`**.${domain.slice(2)}`] : covered(domain) ? [] : [domain]
  )
  return [...new Set(domains)].sort()
}

function header(): string[] {
  return [
    '# Repo-local filesystem, network, and approval settings for Tao development.',
    '# Git metadata writes outside the worktree are routed through Auto-review.',
    '#',
    `# Generated with .codex/rules/tao.rules by \`./agent setup\` from ${PERMISSIONS_SOURCE}`,
    `# and ${PROFILES_SOURCE}. Edit those canonical files, not either generated Codex output:`,
    "# rulesync's own Codex translator cannot express loopback binding, Unix sockets, or a",
    '# curated domain allowlist, so this profile is rendered by',
    '# packages/cli/agent-cli/agent-cli-src/agent-config/CodexConfigGenerator.ts instead.',
    '#',
    '# The sibling .codex/hooks.json is generated from .rulesync/hooks.jsonc by the same setup and',
    '# runs `./agent setup` when a session starts, the one setup entry Worktrunk (.config/wt.toml),',
    '# Claude Code (.claude/settings.json hooks), and Cursor (.cursor/worktrees.json) reach too.',
    '# Codex trusts a repository hook once per content hash through its /hooks command.',
  ]
}

function filesystemSection(profile: string, read: Record<string, string>, allowWrite: readonly string[]): string[] {
  return [
    `[permissions.${profile}.filesystem]`,
    ...(profile === PROFILE ? [`${quote(PRIMARY_GIT_DIRECTORY)} = "write"`] : []),
    ...(allowWrite.length === 0
      ? []
      : [
        '# Caches and shared state the pinned toolchain writes outside the worktree. One list serves',
        "# both harnesses: these are Claude Code's sandbox write paths, spelled as Codex rules.",
        ...allowWrite.map(path => `${quote(path)} = "write"`),
      ]),
    '# The previous repository is reference material only (see AGENTS.md).',
    ...homePathRules(read, 'allow').map(path => `${quote(path)} = "read"`),
    // Denies come last so a credential directory inside an allowed tree is still denied.
    ...homePathRules(read, 'deny').map(path => `${quote(path)} = "deny"`),
  ]
}

function workspaceRootsSection(profile: string, read: Record<string, string>): string[] {
  return [
    `[permissions.${profile}.filesystem.":workspace_roots"]`,
    "# Not `.env*`: that pattern also matches this repository's own `.envrc`.",
    ...workspaceRules(read, 'deny').map(pattern => `${quote(pattern)} = "deny"`),
  ]
}

function directFilesystemSection(profile: string, writePaths: readonly string[]): string[] {
  return [
    `[permissions.${profile}.filesystem]`,
    ...writePaths.map(path => `${quote(path)} = "write"`),
  ]
}

function networkSection(
  profile: string,
  network: NonNullable<NonNullable<CanonicalPermissions['claudecode']>['sandbox']>['network'] = {},
  sockets: readonly string[],
): string[] {
  return [
    `[permissions.${profile}.network]`,
    'enabled = true',
    ...(network.allowLocalBinding === true
      ? [
        "# Tao's dev loop binds Metro, Studio, and the local InstantDB stack to loopback ports.",
        'allow_local_binding = true',
      ]
      : []),
    '',
    ...unixSocketSection(profile, sockets),
    '',
    "# Allowlist-first: shell egress is limited to the hosts Tao's toolchain and research need.",
    `[permissions.${profile}.network.domains]`,
    ...codexDomains(network.allowedDomains ?? []).map(domain => `${quote(domain)} = "allow"`),
  ]
}

function unixSocketSection(profile: string, sockets: readonly string[], comments: readonly string[] = []): string[] {
  if (sockets.length === 0) {
    return []
  }
  return [
    ...comments,
    `[permissions.${profile}.network.unix_sockets]`,
    ...[...new Set(sockets.map(codexSocketPath))].map(socket => `${quote(socket)} = "allow"`),
  ]
}

/** Codex requires Unix sockets to be absolute even though filesystem rules accept `~`. */
function codexSocketPath(path: string): string {
  return path === '~' ? FS.homeDir() : path.startsWith('~/') ? FS.resolvePath(path.slice(2), FS.homeDir()) : path
}

type CommandPattern = { prefix: string[]; trailingWildcard: boolean }

/** parseCommandPattern accepts the deliberately simple command globs this repository uses for host escapes. */
function parseCommandPattern(pattern: string): CommandPattern | undefined {
  const tokens = pattern.trim().split(/\s+/).filter(Boolean)
  const trailingWildcard = tokens.at(-1) === '*'
  if (trailingWildcard) {
    tokens.pop()
  }
  return tokens.length > 0 && tokens.every(token => !/[?*\[]/.test(token))
    ? { prefix: tokens, trailingWildcard }
    : undefined
}

function commandPatternCovers(exclusion: string, allowed: string): boolean {
  const outer = parseCommandPattern(exclusion)
  const inner = parseCommandPattern(allowed)
  if (outer === undefined || inner === undefined || outer.prefix.length > inner.prefix.length) {
    return false
  }
  const samePrefix = outer.prefix.every((token, index) => token === inner.prefix[index])
  return samePrefix && (outer.trailingWildcard || outer.prefix.length === inner.prefix.length)
}

function fixedCommandPattern(pattern: string): string[] | undefined {
  const parsed = parseCommandPattern(pattern)
  return parsed?.trailingWildcard === false ? parsed.prefix : undefined
}

/**
 * Home-scoped read rules become filesystem rules. Codex reads a directory prefix rather than a
 * glob, so a trailing `/**` is dropped; an allow additionally names the directory itself, because
 * Codex grants read access to a tree by naming its root.
 */
function homePathRules(read: Record<string, string>, action: string): string[] {
  return Object.entries(read)
    .filter(([pattern, value]) => pattern.startsWith('~') && value === action)
    .map(([pattern]) => (action === 'allow' ? pattern.replace(/\/\*\*$/, '') : pattern))
}

/** Repository-relative read rules bind inside every workspace root Codex opens. */
function workspaceRules(read: Record<string, string>, action: string): string[] {
  return Object.entries(read)
    .filter(([pattern, value]) => !pattern.startsWith('~') && value === action)
    .map(([pattern]) => pattern)
}

function quote(value: string): string {
  return JSON.stringify(value)
}

/** CodexConfigGenerator renders Codex CLI's permission profile from the canonical rules. */
export const CodexConfigGenerator = {
  codexDomains,
  generate: generateCodexConfig,
  parsePermissions,
  render: renderCodexConfig,
  renderRules: renderCodexRules,
}
