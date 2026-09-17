import { FS } from '@shared'

export const SUBAGENTS_DIRECTORY = 'agents/subagents'
export const SKILLS_DIRECTORY = 'agents/skills'
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
export function tierModels(skillSource: string, column: 'claude' | 'codex'): Map<string, string> {
  const tiers = new Map<string, string>()
  for (const line of skillSource.split('\n')) {
    const cells = line.split('|').map(cell => cell.trim())
    if (cells.length < 5 || cells[1] === undefined) {
      continue
    }
    const model = (column === 'claude' ? cells[2] : cells[3])?.match(/^`([^`]+)`$/)?.[1]
    if (model !== undefined && /^[a-z]+$/.test(cells[1])) {
      tiers.set(cells[1], model)
    }
  }
  return tiers
}

type DelegationSources = {
  profiles: readonly AgentDocument[]
  skills: readonly AgentDocument[]
  skillSource: string
}

/** delegationIssues keeps the profiles, the skills, and the routing table saying the same thing. */
export function delegationIssues(sources: DelegationSources): string[] {
  const issues: string[] = []
  const claudeModels = new Set(tierModels(sources.skillSource, 'claude').values())
  if (claudeModels.size === 0) {
    issues.push(`${DELEGATION_SKILL_PATH} must keep a tier table naming a Claude Code model per tier.`)
  }
  if (sources.profiles.length === 0) {
    issues.push(`${SUBAGENTS_DIRECTORY} holds no profile; the routing table would have nothing to govern.`)
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
    const model = profile.sections['claudecode']?.['model']
    if (model === undefined) {
      issues.push(`${profile.path} must name a Claude Code model, so a caller inherits nothing by accident.`)
    } else if (claudeModels.size > 0 && !claudeModels.has(model)) {
      issues.push(`${profile.path} names model '${model}', which no tier in ${DELEGATION_SKILL_PATH} offers.`)
    }
    issues.push(...readOnlyDriftIssues(profile))
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

/** A profile that cannot write under one harness must not be able to write under the other. */
function readOnlyDriftIssues(profile: AgentDocument): string[] {
  const readOnlyForCodex = profile.sections['codexcli']?.['sandbox_mode'] === 'read-only'
  const readOnlyForClaude = profile.sections['claudecode']?.['permissionMode'] === 'plan'
  if (readOnlyForCodex === readOnlyForClaude) {
    return []
  }
  return [
    `${profile.path} is read-only under ${readOnlyForCodex ? 'Codex' : 'Claude Code'} but writable under the other; `
    + 'pair `sandbox_mode: read-only` with `permissionMode: plan`.',
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
  return delegationIssues({
    profiles: await readDocuments(SUBAGENTS_DIRECTORY, undefined, root),
    skills: await readDocuments(SKILLS_DIRECTORY, 'SKILL.md', root),
    skillSource: await FS.isFile(skillPath) ? await FS.readText(skillPath) : '',
  })
}
