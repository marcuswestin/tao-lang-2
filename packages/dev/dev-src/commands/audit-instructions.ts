import type { Command } from '@commander-js/extra-typings'
import { FS, HCI, Platform, Repo } from '@shared'

type InstructionAuditOptions = {
  json?: boolean
  strict?: boolean
}

/** InstructionAuditFile provides text for one audited instruction file. */
export type InstructionAuditFile = {
  path: string
  text: string
}

/** InstructionAuditFinding reports a stale or duplicated instruction concern. */
export type InstructionAuditFinding = {
  id: string
  level: 'info' | 'warn'
  path: string
  line: number
  message: string
}

type AuditPattern = {
  id: string
  level: InstructionAuditFinding['level']
  message: string
  regex: RegExp
}

const AUDIT_PATTERNS: readonly AuditPattern[] = [
  {
    id: 'blanket-clarification',
    level: 'warn',
    message: 'Prefer inspect-first autonomy over blanket clarification.',
    regex: /ALWAYS ask Ro questions|When in doubt,\s*ask/g,
  },
  {
    id: 'plan-mode',
    level: 'warn',
    message: 'Do not require PLAN mode; confirm step, branch/state, and validation target instead.',
    regex: /First switch to PLAN mode/g,
  },
  {
    id: 'redundant-root-read',
    level: 'info',
    message: 'Avoid telling project skills to read root AGENTS.md; root instructions are already loaded.',
    regex: /\bread\s+`?AGENTS\.md`?/gi,
  },
]

/** registerAuditInstructionsCommand registers the instruction audit command. */
export function registerAuditInstructionsCommand(commands: Command): void {
  commands
    .command('audit-instructions')
    .description('Audit repo-owned agent instructions and Tao skills for stale or duplicated mechanics.')
    .option('--strict', 'Exit non-zero when findings are present.')
    .option('--json', 'Print a machine-readable audit report.')
    .action(async (options: InstructionAuditOptions = {}) => {
      Platform.runtimeProcess.setExitCode(await runAuditInstructions(options))
    })
}

/** runAuditInstructions audits repo-owned instruction files without mutating them. */
export async function runAuditInstructions(options: InstructionAuditOptions = {}): Promise<number> {
  const repoRoot = Repo.getRoot()
  const files = await collectInstructionFiles(repoRoot)
  const findings = auditInstructionFiles(files)

  if (options.json === true) {
    HCI.writeLine(JSON.stringify({ fileCount: files.length, findings }, null, 2))
  } else {
    HCI.write(formatInstructionAuditReport(files.length, findings))
  }

  return options.strict === true && findings.length > 0 ? 1 : 0
}

/** auditInstructionFiles scans instruction text for stale and duplicated patterns. */
export function auditInstructionFiles(files: readonly InstructionAuditFile[]): InstructionAuditFinding[] {
  return files.flatMap(auditInstructionFile)
}

/** formatInstructionAuditReport formats human-readable audit output. */
export function formatInstructionAuditReport(
  fileCount: number,
  findings: readonly InstructionAuditFinding[],
): string {
  if (findings.length === 0) {
    return `instruction audit ok: ${fileCount} files scanned.\n`
  }

  const lines = [`instruction audit found ${findings.length} item(s) across ${fileCount} files:`]
  for (const finding of findings) {
    lines.push(`- [${finding.level}] ${finding.path}:${finding.line} ${finding.id}: ${finding.message}`)
  }
  return `${lines.join('\n')}\n`
}

async function collectInstructionFiles(repoRoot: string): Promise<InstructionAuditFile[]> {
  const knownPaths = [
    'AGENTS.md',
    'CLAUDE.md',
    'packages/AGENTS.md',
    'Apps/Test Apps/AGENTS.md',
    'Apps/Test Apps/README.md',
  ]
  const paths = new Set<string>()

  for (const path of knownPaths) {
    const absolutePath = FS.resolvePath(path, { cwd: repoRoot })
    if (await FS.exists(absolutePath)) {
      paths.add(absolutePath)
    }
  }

  const agentsRoot = FS.resolvePath('agents', { cwd: repoRoot })
  for await (const path of FS.walk(agentsRoot, { extensions: ['.md'] })) {
    paths.add(path)
  }

  const files: InstructionAuditFile[] = []
  for (const path of [...paths].sort()) {
    files.push({
      path: relativeToRepoRoot(path, repoRoot),
      text: await FS.readText(path),
    })
  }
  return files
}

function auditInstructionFile(file: InstructionAuditFile): InstructionAuditFinding[] {
  const findings: InstructionAuditFinding[] = []
  for (const pattern of AUDIT_PATTERNS) {
    for (const match of file.text.matchAll(pattern.regex)) {
      findings.push({
        id: pattern.id,
        level: pattern.level,
        path: file.path,
        line: lineNumberAt(file.text, match.index ?? 0),
        message: pattern.message,
      })
    }
  }
  return findings
}

function lineNumberAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

function relativeToRepoRoot(path: string, repoRoot: string): string {
  const prefix = `${repoRoot}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}
