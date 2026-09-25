import { FS, Text } from '@shared'

export const SUBAGENTS_DIRECTORY = 'agents/subagents'
const SKILLS_DIRECTORY = 'agents/skills'
export const DELEGATION_SKILL_PATH = 'agents/skills/delegation/SKILL.md'

/** The phrases that make a description route work to a profile instead of describing one. */
const TRIGGER_PHRASES = ['use proactively', 'use when', 'use for']

export type AgentDocument = {
  path: string
  name?: string
  description?: string
  /** Per-harness frontmatter blocks, keyed by harness then by field. */
  sections: Record<string, Record<string, string>>
}

/**
 * parseAgentFrontmatter reads the subset of YAML these files are written in: top-level scalars, a
 * folded `>-` description, and one level of per-harness nesting. It is deliberately not a YAML
 * parser — the lint that uses it would rather miss an exotic spelling than make the repository
 * depend on one to check six files.
 */
export function parseAgentFrontmatter(path: string, source: string): AgentDocument {
  const document: AgentDocument = { path, sections: {} }
  const lines = source.split('\n')
  if (lines[0]?.trim() !== '---') {
    return document
  }
  let section: string | undefined
  let folded: { indent: number; key: string; text: string[] } | undefined
  const closeFolded = () => {
    if (folded !== undefined) {
      assign(document, section, folded.key, folded.text.join(' ').trim())
      folded = undefined
    }
  }
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') {
      break
    }
    const indent = line.length - line.trimStart().length
    if (folded !== undefined && line.trim() !== '' && indent > folded.indent) {
      folded.text.push(line.trim())
      continue
    }
    closeFolded()
    const match = line.match(/^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (match === null) {
      continue
    }
    const [, spaces = '', key = '', rawValue = ''] = match
    const value = rawValue.trim()
    if (spaces.length === 0) {
      section = undefined
    }
    if (value === '>-' || value === '>' || value === '|') {
      folded = { indent: spaces.length, key, text: [] }
      continue
    }
    if (value === '') {
      section = spaces.length === 0 ? key : section
      continue
    }
    assign(document, spaces.length === 0 ? undefined : section, key, value)
  }
  closeFolded()
  return document
}

function assign(document: AgentDocument, section: string | undefined, key: string, value: string): void {
  if (section === undefined) {
    if (key === 'name') {
      document.name = value
    }
    if (key === 'description') {
      document.description = value
    }
    return
  }
  document.sections[section] = { ...document.sections[section], [key]: value }
}

/**
 * tierModels reads the tier-to-model table out of the delegation skill, which is the one place this
 * repository spells a model name in prose. A profile may only name a model the table offers, so
 * that a model release is one edit rather than a search.
 */
export type HarnessColumn = 'claude' | 'codex' | 'cursor'

const COLUMN_INDEX: Record<HarnessColumn, number> = { claude: 2, codex: 3, cursor: 4 }

export function tierModels(skillSource: string, column: HarnessColumn): Map<string, string> {
  const tiers = new Map<string, string>()
  for (const line of skillSource.split('\n')) {
    const cells = line.split('|').map(cell => cell.trim())
    if (cells.length < 5 || cells[1] === undefined) {
      continue
    }
    const model = cells[COLUMN_INDEX[column]]?.match(/^`([^`]+)`$/)?.[1]
    if (model !== undefined && /^[a-z]+$/.test(cells[1])) {
      tiers.set(cells[1], model)
    }
  }
  return tiers
}

/** Cursor spells effort inside the model string, so the tier is the part before the parameters. */
function baseModel(model: string): string {
  return model.replace(/\[.*\]$/, '')
}

type DelegationSources = {
  claudeEnv?: Record<string, unknown>
  profiles: readonly AgentDocument[]
  skills: readonly AgentDocument[]
  skillSource: string
}

/** delegationIssues keeps the profiles, the skills, and the routing table saying the same thing. */
export function delegationIssues(sources: DelegationSources): string[] {
  const issues: string[] = []
  const claudeTiers = tierModels(sources.skillSource, 'claude')
  const cursorTiers = tierModels(sources.skillSource, 'cursor')
  const claudeModels = new Set(tierModels(sources.skillSource, 'claude').values())
  const cursorModels = new Set(cursorTiers.values())
  if (claudeModels.size === 0) {
    issues.push(`${DELEGATION_SKILL_PATH} must keep a tier table naming a Claude Code model per tier.`)
  }
  if (sources.profiles.length === 0) {
    issues.push(`${SUBAGENTS_DIRECTORY} holds no profile; the routing table would have nothing to govern.`)
  }
  if (sources.claudeEnv !== undefined) {
    const env = sources.claudeEnv
    if (env['CLAUDE_CODE_SUBAGENT_MODEL'] !== claudeTiers.get('standard')) {
      issues.push('.rulesync/permissions.jsonc must set CLAUDE_CODE_SUBAGENT_MODEL to the Claude standard tier.')
    }
    if (env['ANTHROPIC_DEFAULT_OPUS_MODEL'] !== undefined) {
      issues.push(
        '.rulesync/permissions.jsonc must not pin the opus alias with ANTHROPIC_DEFAULT_OPUS_MODEL; '
          + 'unpinned, it follows each install to the newest Opus.',
      )
    }
    if (env['CLAUDE_CODE_SUBAGENT_MODEL_FORCE'] !== undefined) {
      issues.push('.rulesync/permissions.jsonc must not force the Claude subagent default over explicit models.')
    }
  }

  for (const profile of sources.profiles) {
    const expected = FS.basename(profile.path, '.md')
    if (profile.name !== expected) {
      issues.push(`${profile.path} declares name '${profile.name ?? ''}'; it must match the file name '${expected}'.`)
    }
    const description = profile.description ?? ''
    if (!TRIGGER_PHRASES.some(phrase => description.toLowerCase().includes(phrase))) {
      issues.push(`${profile.path} description must say when to reach for the profile, not only what it is.`)
    }
    issues.push(...modelIssues(profile, 'claudecode', 'Claude Code', claudeModels))
    issues.push(...modelIssues(profile, 'cursor', 'Cursor', cursorModels))
    if (['reviewer', 'oracle', 'architectural-reviewer'].includes(profile.name ?? '')) {
      if (profile.sections['codexcli']?.['model'] !== tierModels(sources.skillSource, 'codex').get('deep')) {
        issues.push(`${profile.path} must pin the Codex deep-tier model for review.`)
      }
      if (
        profile.sections['claudecode']?.['model'] !== claudeTiers.get('deep')
        || baseModel(profile.sections['cursor']?.['model'] ?? '') !== cursorTiers.get('deep')
      ) {
        issues.push(`${profile.path} must keep its Claude and Cursor deep-tier reviewer pins.`)
      }
    }
    issues.push(...readOnlyDriftIssues(profile))
    issues.push(...toolAllowlistIssues(profile))
  }

  for (const skill of sources.skills) {
    const expected = FS.basename(FS.dirname(skill.path))
    if (skill.name !== expected) {
      issues.push(`${skill.path} declares name '${skill.name ?? ''}'; it must match its directory '${expected}'.`)
    }
    if ((skill.description ?? '').trim() === '') {
      issues.push(`${skill.path} must carry a description; it is what decides whether the skill is ever loaded.`)
    }
  }
  return issues
}

/** Each harness spells the model differently, and a profile that names none inherits its caller's. */
function modelIssues(
  profile: AgentDocument,
  section: string,
  harness: string,
  offered: ReadonlySet<string>,
): string[] {
  const model = profile.sections[section]?.['model']
  if (model === undefined) {
    return [`${profile.path} must name a ${harness} model, so a caller inherits nothing by accident.`]
  }
  if (offered.size === 0 || offered.has(baseModel(model))) {
    return []
  }
  return [`${profile.path} names ${harness} model '${model}', which no tier in ${DELEGATION_SKILL_PATH} offers.`]
}

/** The Claude Code tools that let a subagent change the worktree. */
const MUTATING_TOOLS = ['Edit', 'Write', 'NotebookEdit']

/**
 * A subagent that names no tools inherits every tool schema its caller was given, which is the
 * largest fixed cost in its context and is paid again on every one of its requests — measured at
 * roughly 44k tokens of schema against the 8k a repository profile actually uses. The allowlist is
 * also the only per-harness expression of what a read-only profile may do, since Claude Code's
 * `permissionMode: plan` governs approval rather than availability.
 */
function toolAllowlistIssues(profile: AgentDocument): string[] {
  const declared = profile.sections['claudecode']?.['tools']
  if (declared === undefined) {
    return [
      `${profile.path} must name the Claude Code tools it needs; a profile that names none loads `
      + 'every tool schema into every request it makes.',
    ]
  }
  const tools = declared.split(',').map(tool => tool.trim()).filter(tool => tool !== '')
  if (tools.length === 0) {
    return [`${profile.path} declares an empty Claude Code tool list; it would have nothing to work with.`]
  }
  if (profile.sections['claudecode']?.['permissionMode'] !== 'plan') {
    return []
  }
  const mutating = tools.filter(tool => MUTATING_TOOLS.includes(tool))
  if (mutating.length === 0) {
    return []
  }
  return [`${profile.path} is read-only but lists ${mutating.join(' and ')}; drop them from its tool list.`]
}

/** A profile that cannot write under one harness must not be able to write under another. */
function readOnlyDriftIssues(profile: AgentDocument): string[] {
  const readOnly = {
    'Claude Code': profile.sections['claudecode']?.['permissionMode'] === 'plan',
    Codex: profile.sections['codexcli']?.['sandbox_mode'] === 'read-only',
    Cursor: profile.sections['cursor']?.['readonly'] === 'true',
  }
  const restricted = Object.entries(readOnly).filter(([, value]) => value).map(([harness]) => harness)
  if (restricted.length === 0 || restricted.length === Object.keys(readOnly).length) {
    return []
  }
  return [
    `${profile.path} is read-only under ${restricted.join(' and ')} but writable under the rest; `
    + 'pair `sandbox_mode: read-only` with `permissionMode: plan` and `readonly: true`.',
  ]
}

async function readDocuments(directory: string, fileName: string | undefined, root: string): Promise<AgentDocument[]> {
  const directoryPath = FS.resolvePath(directory, root)
  if (!(await FS.isDirectory(directoryPath))) {
    return []
  }
  const documents: AgentDocument[] = []
  for (const entry of await FS.listDir(directoryPath)) {
    const path = fileName === undefined ? `${directory}/${entry}` : `${directory}/${entry}/${fileName}`
    const absolutePath = FS.resolvePath(path, root)
    if ((fileName !== undefined || entry.endsWith('.md')) && await FS.isFile(absolutePath)) {
      documents.push(parseAgentFrontmatter(path, await FS.readText(absolutePath)))
    }
  }
  return documents
}

/**
 * readDelegationIssues gathers the canonical sources; the generated adapters are never read. A tree
 * with no `agents/subagents` is not a checkout of this repository — the lint's own fixtures are such
 * trees — so it is out of scope rather than in violation. Once the directory exists, an empty one is
 * a finding, which is what keeps this check from passing by reading nothing.
 */
export async function readDelegationIssues(root: string): Promise<string[]> {
  if (!(await FS.isDirectory(FS.resolvePath(SUBAGENTS_DIRECTORY, root)))) {
    return []
  }
  const skillPath = FS.resolvePath(DELEGATION_SKILL_PATH, root)
  const permissionsPath = FS.resolvePath('.rulesync/permissions.jsonc', root)
  const permissions = await FS.isFile(permissionsPath)
    ? JSON.parse(Text.stripJsonc(await FS.readText(permissionsPath))) as {
      claudecode?: { env?: Record<string, unknown> }
    }
    : undefined
  return delegationIssues({
    claudeEnv: permissions?.claudecode?.env,
    profiles: await readDocuments(SUBAGENTS_DIRECTORY, undefined, root),
    skills: await readDocuments(SKILLS_DIRECTORY, 'SKILL.md', root),
    skillSource: await FS.isFile(skillPath) ? await FS.readText(skillPath) : '',
  })
}
