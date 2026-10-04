import { Errors, FS, HCI, Json, Platform, Repo } from '@shared'
import { primaryCheckout, siblingWorktreeRoot } from '../agent-hooks/WorktreePlacement'
import { DELEGATION_SKILL_PATH, tierModels } from './DelegationProfiles'
import { auditModelRouting, type ModelAuditOptions, type ModelAuditReport } from './ModelAudit'

type RunModelAuditOptions = { brief?: boolean; days?: number; json?: boolean; repoRoot?: string; until?: string }

const DEFAULT_WINDOW_DAYS = 7

/** homeDirectory honours the override variable the harness itself reads. */
function homeDirectory(variable: string, fallback: string): string {
  const configured = Platform.runtimeProcess.env[variable]
  return configured !== undefined && configured !== '' ? configured : FS.resolvePath(fallback, FS.homeDir())
}

/**
 * checkoutRoots are where this repository's sessions run: the primary checkout, which holds the
 * harness's default `.claude/worktrees`, and the sibling directory WorktreePlacement moves worktrees
 * to. Outside a git checkout it is the root alone.
 */
async function checkoutRoots(repoRoot: string): Promise<string[]> {
  const primary = await primaryCheckout(repoRoot).catch(() => undefined)
  return primary === undefined ? [repoRoot] : [primary, siblingWorktreeRoot(primary)]
}

async function resolvedOptions(options: RunModelAuditOptions): Promise<ModelAuditOptions> {
  const repoRoot = options.repoRoot ?? Repo.getRoot()
  const untilMs = options.until === undefined ? undefined : Date.parse(options.until)
  if (untilMs !== undefined && Number.isNaN(untilMs)) {
    Errors.throwUserInput('--until must be a date or time, such as 2026-09-25 or 2026-09-25T14:58:00Z.')
  }
  return {
    brief: options.brief === true,
    checkoutRoots: options.brief === true ? [] : await checkoutRoots(repoRoot),
    claudeDir: homeDirectory('CLAUDE_CONFIG_DIR', '.claude'),
    codexHome: homeDirectory('CODEX_HOME', '.codex'),
    days: options.days ?? DEFAULT_WINDOW_DAYS,
    // `Time.nowMs` is monotonic, for elapsed work; transcripts and the catalog carry wall-clock time.
    nowMs: Date.now(),
    repoRoot,
    untilMs,
  }
}

/**
 * briefLine is all `--brief` prints, and only when there is a finding: session start runs it every
 * time, so a routing table that matches the machine stays silent.
 */
function briefLine(findings: readonly string[]): string | undefined {
  return findings.length === 0
    ? undefined
    : `Model routing may be behind this machine: ${findings.join('; ')}. Run ./agent model-audit and tell `
      + 'the Developer; do not change the routing table unasked.'
}

/** briefFindings is the one-day, tail-only audit that session start and `./agent doctor` share. */
async function briefFindings(repoRoot: string): Promise<string[]> {
  return (await audit(await resolvedOptions({ brief: true, repoRoot }))).findings
}

/** Personal configuration stays local: only its subagent model is reflected in the report. */
async function audit(options: ModelAuditOptions): Promise<ModelAuditReport> {
  const report = await auditModelRouting(options)
  const configPath = FS.resolvePath('config.toml', options.codexHome)
  if (!(await FS.isFile(configPath))) {
    return report
  }
  let parsed: unknown
  try {
    parsed = Platform.parseToml(await FS.readText(configPath))
  } catch {
    report.notes.push('personal Codex configuration could not be read; its subagent default was not compared')
    return report
  }
  const agents = Json.isRecord(parsed) ? parsed['agents'] : undefined
  const personal = Json.isRecord(agents) ? agents['default_subagent_model'] : undefined
  if (personal === undefined) {
    return report
  }
  if (typeof personal !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(personal)) {
    report.notes.push('personal Codex subagent default is not a model ID; it was not compared')
    return report
  }
  const skillPath = FS.resolvePath(DELEGATION_SKILL_PATH, options.repoRoot)
  const standard = await FS.isFile(skillPath)
    ? tierModels(await FS.readText(skillPath), 'codex').get('standard')
    : undefined
  if (standard !== undefined && personal !== standard) {
    report.findings.push(
      `personal Codex subagent default names '${personal}', differing from repository standard '${standard}'`,
    )
  }
  return report
}

function formatStats(stats: { count: number; max: number; p50: number; p90: number }): string {
  return stats.count === 0
    ? 'none'
    : `p50 ${stats.p50}, p90 ${stats.p90}, max ${stats.max} over ${stats.count}`
}

function writeInfo(info: NonNullable<ModelAuditReport['info']>): void {
  HCI.writeLine("This checkout's sessions, in tokens:")
  HCI.writeLine(`  context per main-session request: ${formatStats(info.context.main)}`)
  HCI.writeLine(`  context per subagent request: ${formatStats(info.context.subagents)}`)
  if (info.autoCompactWindow !== undefined) {
    HCI.writeLine(
      `  requests over the ${info.autoCompactWindow} autoCompactWindow: ${info.context.overAutoCompactWindow ?? 0}`,
    )
  }
  HCI.writeLine(
    `  compactions: ${info.compactions.auto} automatic, ${info.compactions.manual} manual; `
      + `context before each: ${formatStats(info.compactions.preTokens)}`,
  )
}

function writeModelAuditReport(report: ModelAuditReport, options: RunModelAuditOptions): void {
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(report, null, 2))
    return
  }
  if (options.brief === true) {
    const line = briefLine(report.findings)
    if (line !== undefined) {
      HCI.writeLine(line)
    }
    return
  }
  const days = report.windowDays === 1 ? '1 day' : `${report.windowDays} days`
  HCI.writeLine(`Model audit from ${report.sinceIso} to ${report.untilIso} (${days}).`)
  HCI.writeLine('')
  if (report.findings.length === 0) {
    HCI.writeLine('No finding: the routing table matches what this machine ran.')
  }
  for (const finding of report.findings) {
    HCI.writeLine(`- ${finding}.`)
  }
  for (const note of report.notes) {
    HCI.writeLine(`Note: ${note}.`)
  }
  if (report.info !== undefined) {
    HCI.writeLine('')
    writeInfo(report.info)
  }
}

async function run(options: RunModelAuditOptions = {}): Promise<number> {
  writeModelAuditReport(await audit(await resolvedOptions(options)), options)
  return 0
}

export const ModelAuditCommand = { audit, briefFindings, run, write: writeModelAuditReport }
