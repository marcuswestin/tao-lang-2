import { CLI, Errors, FS, HCI, Repo } from '@shared'
import { type AuditFile, simplifyAudit, type SimplifyAuditReport } from './SimplifyAudit'

type RunSimplifyAuditOptions = { json?: boolean }

const AUDITED_ROOTS = ['AGENTS.md', 'Apps', 'Docs', 'agents', 'packages']
const AUDITED_EXTENSIONS = ['.md', '.ts', '.tsx']
const LISTED_ROWS = 15

async function readAuditFiles(repoRoot: string): Promise<AuditFile[]> {
  const tracked = await CLI.run('git', { args: ['ls-files', '-z', '--', ...AUDITED_ROOTS], cwd: repoRoot })
  if (tracked.exitCode !== 0) {
    Errors.throwHostEnvironment(`git ls-files failed: ${tracked.stderr.trim()}`)
  }
  const paths = tracked.stdout.split('\0')
    .filter(path => AUDITED_EXTENSIONS.some(extension => path.endsWith(extension)) && !path.includes('/_gen_'))
  const files: AuditFile[] = []
  for (const path of paths) {
    const absolutePath = FS.resolvePath(path, repoRoot)
    if (await FS.isFile(absolutePath)) {
      files.push({ path: FS.slashPath(path), source: await FS.readText(absolutePath) })
    }
  }
  return files
}

function writeSection(title: string, rows: readonly string[], total = rows.length): void {
  HCI.writeLine('')
  HCI.writeLine(title)
  rows.slice(0, LISTED_ROWS).forEach(row => HCI.writeLine(`  ${row}`))
  if (total > LISTED_ROWS) {
    HCI.writeLine(`  … ${total - LISTED_ROWS} more; --json lists all`)
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function writeReport(report: SimplifyAuditReport): void {
  const pad = (value: number) => String(value).padStart(7)
  const instructionLines = sum(report.instructions.map(file => file.lines))
  HCI.writeLine(
    `${sum(report.packages.map(entry => entry.lines))} non-test source lines in ${report.packages.length} packages; `
      + `${sum(report.packages.map(entry => entry.kindChains))} kind chains; `
      + `${sum(report.packages.map(entry => entry.compoundConditions))} compound conditions; `
      + `${sum(Object.values(report.allowlistEntries))} allowlist entries; `
      + `${instructionLines} instruction lines; ${sum(report.docs.map(entry => entry.lines))} Docs lines.`,
  )
  writeSection(
    'Packages:   lines  Switch  switch  chains(branches)  compound-ifs',
    report.packages.map(entry =>
      `${entry.name.padEnd(22)}${pad(entry.lines)}${pad(entry.switchCalls)}${pad(entry.nativeSwitches)}`
      + `${pad(entry.kindChains)}(${entry.kindChainBranches})${pad(entry.compoundConditions)}`
    ),
  )
  writeSection('Files over 800 lines:', report.largeFiles.map(file => `${pad(file.lines)}  ${file.path}`))
  writeSection(
    'Dispatch chains over one discriminant:',
    report.kindChains.map(chain => `${pad(chain.length)}  ${chain.path}:${chain.line}  on \`${chain.discriminant}\``),
  )
  writeSection(
    'Allowlist entries per rule:',
    Object.entries(report.allowlistEntries).map(([name, count]) => `${pad(count)}  ${name}`),
  )
  writeSection(
    'Constants declared identically in several files:',
    report.duplicatedConstants.map(entry =>
      `${entry.name} = ${entry.value}  ×${entry.paths.length}  ${entry.paths[0]}`
    ),
  )
  writeSection(
    'Cross-package imports:',
    report.imports.map(edge => `${edge.from} → ${edge.to} (${edge.count})`),
  )
  writeSection(
    'Instruction files (over budget marked !):',
    report.instructions.map(file =>
      `${pad(file.lines)}${file.budget !== undefined && file.lines > file.budget ? ' !' : '  '} ${file.path}`
    ),
  )
  writeSection(
    'Docs:',
    report.docs.map(entry => `${pad(entry.lines)}  ${String(entry.files).padStart(4)} files  ${entry.subtree}`),
  )
}

/** runSimplifyAudit prints the measurements the `simplify-repo` skill plans from; it changes nothing. */
async function runSimplifyAudit(options: RunSimplifyAuditOptions = {}): Promise<number> {
  const report = simplifyAudit(await readAuditFiles(Repo.getRoot()))
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
  } else {
    writeReport(report)
  }
  return 0
}

export const SimplifyAuditCommand = { run: runSimplifyAudit }
