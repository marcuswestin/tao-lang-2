import { FS, Text } from '@shared'

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
const NATIVE_PROFILE = 'tao-native'
const LOCAL_SERVICES_PROFILE = 'tao-local-services'
const RELEASE_PROFILE = 'tao-release'

/**
 * Paths and settings Codex needs that the canonical rules do not describe, because they are
 * Codex-shaped rather than policy-shaped. The Git directory is spelled for the primary checkout
 * on purpose: the generated file is committed, so it cannot carry a linked worktree's path.
 */
const PRIMARY_GIT_DIRECTORY = '~/code/tao-lang-2/.git'
const DOCKER_SOCKETS = ['/var/run/docker.sock', '~/.docker/run/docker.sock'] as const
const NATIVE_WRITE_PATHS = [
  '~/Library/Developer/CoreSimulator',
  '~/Library/Developer/Xcode/DerivedData',
  '~/Library/Logs/CoreSimulator',
] as const
const RELEASE_WRITE_PATHS = ['~/Library/Developer/Xcode/Archives'] as const

/** CanonicalPermissions is the subset of `.rulesync/permissions.jsonc` this renderer reads. */
type CanonicalPermissions = {
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
  const outputs = [
    { content: renderCodexConfig(permissions), path: FS.resolvePath(CODEX_CONFIG_OUTPUT, options.root) },
    { content: renderCodexRules(permissions), path: FS.resolvePath(CODEX_RULES_OUTPUT, options.root) },
  ]
  for (const output of outputs) {
    try {
      await (options.writeText ?? FS.writeText)(output.path, output.content)
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException
      if (code !== 'EACCES' && code !== 'EPERM') {
        throw error
      }
      ;(options.onSkip ?? console.warn)(`Skipped codexcli permissions: ${output.path} is not writable.`)
    }
  }
}

/** parsePermissions reads the canonical JSONC rules, whose comments JSON itself rejects. */
function parsePermissions(source: string): CanonicalPermissions {
  return JSON.parse(Text.stripJsonc(source)) as CanonicalPermissions
}

/** renderCodexConfig renders the whole `.codex/config.toml` from canonical permission rules. */
function renderCodexConfig(permissions: CanonicalPermissions): string {
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
    `[permissions.${NATIVE_PROFILE}]`,
    `extends = ${quote(PROFILE)}`,
    'description = "Tao native host: add Simulator and Xcode working directories; host commands still follow project rules."',
    '',
    ...directFilesystemSection(NATIVE_PROFILE, NATIVE_WRITE_PATHS),
    '',
    `[permissions.${LOCAL_SERVICES_PROFILE}]`,
    `extends = ${quote(PROFILE)}`,
    'description = "Tao local services: opt in to the Docker daemon used by the local InstantDB stack."',
    '',
    ...unixSocketSection(LOCAL_SERVICES_PROFILE, DOCKER_SOCKETS, [
      '# Docker can control the host through mounts and networking, so it is not in the default profile.',
    ]),
    '',
    `[permissions.${RELEASE_PROFILE}]`,
    `extends = ${quote(NATIVE_PROFILE)}`,
    'description = "Tao release: add the local Xcode archive destination; credentials and publication remain denied or reviewed."',
    '',
    ...directFilesystemSection(RELEASE_PROFILE, RELEASE_WRITE_PATHS),
    '',
  ].join('\n')
}

/** renderCodexRules emits only commands both auto-approved and explicitly excluded from Claude's sandbox. */
function renderCodexRules(permissions: CanonicalPermissions): string {
  const allowed = Object.entries(permissions.permission?.bash ?? {})
    .filter(([, action]) => action === 'allow')
    .map(([pattern]) => pattern)
  const excluded = permissions.claudecode?.sandbox?.excludedCommands ?? []
  const prefixes = allowed
    .filter(pattern => excluded.some(exclusion => commandPatternCovers(exclusion, pattern)))
    .map(commandPatternPrefix)
    .filter((tokens): tokens is string[] => tokens !== undefined)
  const unique = new Map(prefixes.map(tokens => [JSON.stringify(tokens), tokens]))
  return [
    '# Generated by `./agent setup` from .rulesync/permissions.jsonc. Edit that file, not this one.',
    '# These exact prefixes need host capabilities the sandbox cannot express. Every other allowed',
    '# command remains inside the active filesystem and network permission profile.',
    '',
    ...[...unique.values()].map(tokens =>
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
    `# Generated with .codex/rules/tao.rules by \`./agent setup\` from ${PERMISSIONS_SOURCE}.`,
    '# Edit that canonical file, not either generated Codex output:',
    "# rulesync's own Codex translator cannot express loopback binding, Unix sockets, or a",
    '# curated domain allowlist, so this profile is rendered by',
    '# packages/dev/dev-src/agent-config/CodexConfigGenerator.ts instead.',
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

function commandPatternPrefix(pattern: string): string[] | undefined {
  return parseCommandPattern(pattern)?.prefix
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
