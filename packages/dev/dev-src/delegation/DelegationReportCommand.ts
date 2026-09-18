import { HCI, Repo } from '@shared'
import { DELEGATION_EVENTS_PATH, type DelegationSummary, readDelegationLog, UNNAMED_MODEL } from './DelegationLog'

type RunDelegationReportOptions = { json?: boolean }

const COLUMNS = ['Profile', 'Spawns', 'Model', 'Effort', 'Done', 'Median', 'Longest'] as const

function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) {
    return '—'
  }
  const seconds = Math.round(milliseconds / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

function formatDay(time: string | undefined): string {
  return time === undefined ? 'never' : time.slice(0, 10)
}

function count(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`
}

function writeTable(rows: readonly (readonly string[])[]): void {
  const widths = COLUMNS.map((column, index) => Math.max(column.length, ...rows.map(row => (row[index] ?? '').length)))
  const line = (cells: readonly string[]) =>
    cells.map((cell, index) => (index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join('  ')
  HCI.writeLine(line(COLUMNS))
  for (const row of rows) {
    HCI.writeLine(line(row))
  }
}

function writeDelegationReport(summary: DelegationSummary, options: RunDelegationReportOptions): void {
  if (options.json === true) {
    HCI.writeLine(JSON.stringify(summary, null, 2))
    return
  }
  if (summary.spawns === 0 && summary.profiles.length === 0) {
    HCI.writeLine(`No delegations recorded in ${DELEGATION_EVENTS_PATH}.`)
    return
  }
  HCI.writeLine(
    `${count(summary.spawns, 'delegation', 'delegations')}, ${summary.completed} timed, ${
      formatDay(summary.firstTime)
    } to ${formatDay(summary.lastTime)} (${DELEGATION_EVENTS_PATH})`,
  )
  HCI.writeLine('')
  writeTable(summary.profiles.map(profile => [
    profile.profile,
    String(profile.spawns),
    [...profile.models, ...(profile.unnamedModels > 0 ? [UNNAMED_MODEL] : [])].join(', ') || UNNAMED_MODEL,
    profile.efforts.join(', ') || '—',
    String(profile.completed),
    formatDuration(profile.medianMs),
    formatDuration(profile.longestMs),
  ]))
  HCI.writeLine('')
  if (summary.unnamedModels > 0) {
    HCI.writeLine(
      `${summary.unnamedModels} of ${summary.spawns} delegations named no model, so each inherited the caller's.`,
    )
    HCI.writeLine('The `delegation` skill asks for an explicit tier; an inherited one is usually the expensive one.')
  }
  if (summary.completed < summary.spawns) {
    HCI.writeLine('A delegation is timed only when its start and stop both reach the log; the rest are counted only.')
  }
  if (summary.unreadableLines > 0) {
    const lines = count(summary.unreadableLines, 'log line was', 'log lines were')
    HCI.writeLine(`${lines} unreadable, most likely a truncated payload.`)
  }
}

async function run(options: RunDelegationReportOptions = {}): Promise<number> {
  writeDelegationReport(await readDelegationLog(Repo.getRoot()), options)
  return 0
}

export const DelegationReportCommand = { run, write: writeDelegationReport }
