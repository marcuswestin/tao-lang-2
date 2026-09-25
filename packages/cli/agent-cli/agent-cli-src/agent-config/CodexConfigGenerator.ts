import { Errors, FS, Text } from '@shared'
import * as CLI from '@shared/CLI'
import { DELEGATION_SKILL_PATH, tierModels } from '../delegation/DelegationProfiles'
import { agentHostCommands } from './AgentHostCommands'
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
 * gitDirectory is the Git directory every worktree of the checkout at `root` shares, which Codex
 * needs as a write rule the canonical rules do not describe. It is read from the checkout rather
 * than spelled here so a root that is not a checkout gets its own `.git`. Home-relative paths
 * stay portable between logins when the clone has the same location under each home directory.
 */
async function gitDirectory(root: string): Promise<string> {
  const common = await CLI.run('git', { args: ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd: root })
  const absolute = common.exitCode === 0 ? common.stdout.trim() : FS.resolvePath('.git', root)
  const home = FS.homeDir()
  return absolute.startsWith(`${home}/`) ? `~/${absolute.slice(home.length + 1)}` : absolute
}

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
  agentHostCommands?: unknown
  claudecode?: {
    sandbox?: {
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
      content: renderCodexConfig(permissions, profiles, delegationSkill, await gitDirectory(options.root)),
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
        + 'Pause and ask the Developer to approve an unsandboxed `./agent setup`; do not commit stale generated rules.'
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
  /** The checkout's shared Git directory, from `gitDirectory`. */
  sharedGitDirectory = '.git',
): string {
  const read = permissions.permission?.read ?? {}
  // Codex refuses to bypass its sandbox for an explicit host allow rule when the active profile
  // contains any denied-read path. Keep those protections in the read-only review profile, but
  // leave them out of the default workspace profile so its exact host commands can run.
  const hostCapableRead = Object.fromEntries(Object.entries(read).filter(([, action]) => action !== 'deny'))
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
    ...filesystemSection(REVIEW_PROFILE, read, [], sharedGitDirectory),
    '',
    ...workspaceRootsSection(REVIEW_PROFILE, read),
    '',
    ...networkSection(REVIEW_PROFILE, { ...network, allowLocalBinding: false }, []),
    '',
    `[permissions.${PROFILE}]`,
    `extends = ${quote(PROFILE_BASE)}`,
    'description = "Tao worktree: write the workspace, read the reference repo, reach documentation and package hosts."',
    '',
    ...filesystemSection(PROFILE, hostCapableRead, allowWrite, sharedGitDirectory),
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

/** Render only the canonical wrapper prefixes; no direct command has host access. */
function renderCodexRules(permissions: CanonicalPermissions): string {
  const wrapperCommands = agentHostCommands(permissions).map(prefix => ['./agent', 'unsandboxed', ...prefix])
  return [
    '# Generated by `./agent setup` from .rulesync/permissions.jsonc. Edit that file, not this one.',
    '# Only the listed ./agent unsandboxed prefixes run on the host. The wrapper checks argv again.',
    '',
    ...wrapperCommands.map(tokens =>
      `prefix_rule(pattern=${
        JSON.stringify(tokens)
      }, decision="allow", justification="Repository-approved host command.")`
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
    '# Tracked so a new worktree has its permission profile before setup or session hooks run.',
    '# It names no login: Codex accepts only absolute Unix socket paths, so a home-relative socket',
    '# in the canonical rules is left out here and reached through a named host operation instead.',
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

function filesystemSection(
  profile: string,
  read: Record<string, string>,
  allowWrite: readonly string[],
  sharedGitDirectory: string,
): string[] {
  return [
    `[permissions.${profile}.filesystem]`,
    ...(profile === PROFILE ? [`${quote(sharedGitDirectory)} = "write"`] : []),
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
  const denied = workspaceRules(read, 'deny')
  if (denied.length === 0) {
    return []
  }
  return [
    `[permissions.${profile}.filesystem.":workspace_roots"]`,
    "# Not `.env*`: that pattern also matches this repository's own `.envrc`.",
    ...denied.map(pattern => `${quote(pattern)} = "deny"`),
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
  const portable = codexSockets(sockets)
  if (portable.length === 0) {
    return []
  }
  return [
    ...comments,
    `[permissions.${profile}.network.unix_sockets]`,
    ...portable.map(socket => `${quote(socket)} = "allow"`),
  ]
}

/**
 * codexSockets keeps the socket paths Codex can be given in a tracked file: absolute ones that name
 * no login. Codex accepts nothing else here — a `~/`, `$HOME`, or relative entry, even read from
 * the config file, stops its network proxy from starting (`invalid network.allow_unix_sockets`,
 * measured on Codex 0.155.1) — and expanding `~` would write one developer's home directory into
 * the tracked config. A home-relative socket therefore reaches Claude Code only; Codex gets it
 * through a login-free system path such as `/var/run/docker.sock`, which it follows to the
 * per-user socket, or through a named host operation that runs outside the sandbox.
 */
function codexSockets(sockets: readonly string[]): string[] {
  return [...new Set(sockets.filter(path => !path.startsWith('~')))]
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
  gitDirectory,
  parsePermissions,
  render: renderCodexConfig,
  renderRules: renderCodexRules,
}
