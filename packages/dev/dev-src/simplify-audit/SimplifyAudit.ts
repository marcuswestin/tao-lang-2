import { CONVENTION_RULES } from '../repository-tests/repo-lint'
import { isAuditedSource } from './AuditedSource'
import { instructionBudget, instructionCharacterCount, instructionLineCount } from './InstructionBudgets'
import { type KindChain, kindChainsIn } from './KindChains'

/** AuditFile is one tracked repository file the audit reads. */
export type AuditFile = {
  path: string
  source: string
}

const LARGE_FILE_LINES = 800
const SWITCH_CALL_PATTERN = /\b(?:Runtime)?Switch(?:\.\w+)?(?:<[^\n()]*>)?\s*\(/g
const NATIVE_SWITCH_PATTERN = /^[ \t]*switch[ \t]*\(/gm
const COMPOUND_CONDITION_PATTERN = /\bif\s*\([^\n]*(?:&&|\|\|)[^\n]*(?:&&|\|\|)/g
const PACKAGE_IMPORT_PATTERN = /\bfrom\s*['"]@([a-z][\w-]*)(?:\/[^'"]*)?['"]/g
const LITERAL_CONSTANT_PATTERN = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*('[^'\n]*'|"[^"\n]*"|\d[\w.]*)\s*$/gm

type PackageAudit = {
  compoundConditions: number
  kindChainBranches: number
  kindChains: number
  lines: number
  name: string
  nativeSwitches: number
  switchCalls: number
}

export type SimplifyAuditReport = {
  allowlistEntries: Record<string, number>
  docs: { files: number; lines: number; subtree: string }[]
  duplicatedConstants: { name: string; paths: string[]; value: string }[]
  imports: { count: number; from: string; to: string }[]
  instructions: { budget?: number; characters: number; lines: number; path: string }[]
  kindChains: KindChain[]
  largeFiles: { lines: number; path: string }[]
  packages: PackageAudit[]
}

function matchCount(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length
}

// A top-level `packages/*` entry is either a package or a group of packages one level deeper; a
// moved package's name is then `<group>/<package>`, matching PackageGraph's own depth-two rule.
const PACKAGE_GROUPS = new Set(['ai', 'apps', 'cli', 'ides', 'language', 'providers', 'services', 'testing'])

function packageOf(path: string): string {
  const segments = path.split('/')
  const first = segments[1] ?? ''
  const second = segments[2]
  return PACKAGE_GROUPS.has(first) && second !== undefined ? `${first}/${second}` : first
}

function packageAudits(sources: readonly AuditFile[]): PackageAudit[] {
  const audits = new Map<string, PackageAudit>()
  for (const file of sources) {
    const name = packageOf(file.path)
    const audit = audits.get(name)
      ?? {
        compoundConditions: 0,
        kindChainBranches: 0,
        kindChains: 0,
        lines: 0,
        name,
        nativeSwitches: 0,
        switchCalls: 0,
      }
    const chains = kindChainsIn(file.path, file.source)
    audit.lines += instructionLineCount(file.source)
    audit.switchCalls += matchCount(file.source, SWITCH_CALL_PATTERN)
    audit.nativeSwitches += matchCount(file.source, NATIVE_SWITCH_PATTERN)
    audit.compoundConditions += matchCount(file.source, COMPOUND_CONDITION_PATTERN)
    audit.kindChains += chains.length
    audit.kindChainBranches += chains.reduce((sum, chain) => sum + chain.length, 0)
    audits.set(name, audit)
  }
  return [...audits.values()].sort((left, right) => right.lines - left.lines)
}

function importEdges(sources: readonly AuditFile[]): SimplifyAuditReport['imports'] {
  const packages = new Set(sources.map(file => packageOf(file.path)))
  const counts = new Map<string, number>()
  for (const file of sources) {
    const from = packageOf(file.path)
    for (const match of file.source.matchAll(PACKAGE_IMPORT_PATTERN)) {
      const to = match[1]!
      if (to !== from && packages.has(to)) {
        counts.set(`${from} ${to}`, (counts.get(`${from} ${to}`) ?? 0) + 1)
      }
    }
  }
  return [...counts]
    .map(([edge, count]) => ({ count, from: edge.split(' ')[0]!, to: edge.split(' ')[1]! }))
    .sort((left, right) => left.from.localeCompare(right.from) || right.count - left.count)
}

/** duplicatedConstants finds module-scope constants spelled with one name and one literal in two or more files. */
function duplicatedConstants(sources: readonly AuditFile[]): SimplifyAuditReport['duplicatedConstants'] {
  const sites = new Map<string, Set<string>>()
  for (const file of sources) {
    for (const match of file.source.matchAll(LITERAL_CONSTANT_PATTERN)) {
      const key = `${match[1]}\0${match[2]}`
      sites.set(key, (sites.get(key) ?? new Set()).add(file.path))
    }
  }
  return [...sites]
    .filter(([, paths]) => paths.size > 1)
    .map(([key, paths]) => ({ name: key.split('\0')[0]!, paths: [...paths].sort(), value: key.split('\0')[1]! }))
    .sort((left, right) => right.paths.length - left.paths.length || left.name.localeCompare(right.name))
}

function isInstructionPath(path: string): boolean {
  return path.endsWith('AGENTS.md') || (path.startsWith('agents/') && path.endsWith('.md'))
}

function docsSubtrees(files: readonly AuditFile[]): SimplifyAuditReport['docs'] {
  const subtrees = new Map<string, { files: number; lines: number; subtree: string }>()
  for (const file of files.filter(candidate => candidate.path.startsWith('Docs/') && candidate.path.endsWith('.md'))) {
    const segments = file.path.split('/')
    const subtree = segments.slice(0, segments[1] === 'Roadmap' && segments.length > 3 ? 3 : 2).join('/')
    const entry = subtrees.get(subtree) ?? { files: 0, lines: 0, subtree }
    entry.files += 1
    entry.lines += instructionLineCount(file.source)
    subtrees.set(subtree, entry)
  }
  return [...subtrees.values()].sort((left, right) => right.lines - left.lines)
}

/** simplifyAudit measures what a simplification pass targets, over the tracked files it is given. */
export function simplifyAudit(files: readonly AuditFile[]): SimplifyAuditReport {
  const sources = files.filter(file => isAuditedSource(file.path))
  return {
    allowlistEntries: Object.fromEntries(
      Object.entries(CONVENTION_RULES).map(([name, rule]) => [name, rule.allowlist.length]),
    ),
    docs: docsSubtrees(files),
    duplicatedConstants: duplicatedConstants(sources),
    imports: importEdges(sources),
    instructions: files
      .filter(file => isInstructionPath(file.path))
      .map(file => ({
        budget: instructionBudget(file.path),
        // Both are reported: the budget is in characters, and the spread between the two is what
        // shows a file spending its budget on long bullets rather than on more of them.
        characters: instructionCharacterCount(file.source),
        lines: instructionLineCount(file.source),
        path: file.path,
      }))
      .sort((left, right) => right.characters - left.characters),
    kindChains: sources
      .flatMap(file => kindChainsIn(file.path, file.source))
      .sort((left, right) => right.length - left.length || left.path.localeCompare(right.path)),
    largeFiles: sources
      .map(file => ({ lines: instructionLineCount(file.source), path: file.path }))
      .filter(file => file.lines > LARGE_FILE_LINES)
      .sort((left, right) => right.lines - left.lines),
    packages: packageAudits(sources),
  }
}
