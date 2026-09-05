import { Assert } from '@shared/core'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import type { StudioJsonValue } from '../StudioProtocol'
import type { StudioTestFailure, StudioTestStatus } from '../StudioTestRunner'
import type { StudioCompileDiagnostic, StudioCompileState } from './StudioApiClient'
import { studioCellLabel } from './StudioEditor'
import type { StudioRuntimeDataTable, StudioRuntimeLog } from './StudioMatrixView'
import type { StudioSearchResult } from './StudioRailPanels'

export type StudioDrawerTab = 'Compile' | 'Data' | 'Logs' | 'Problems' | 'Tests'

export const StudioPanelBounds = {
  dataRowsPerTable: 250,
  logs: 500,
  testOutputCharacters: 40_000,
} as const

type StudioPanelCellIdentity = Readonly<{ cellId: string; cellRevision: number }>

type StudioPanelActionName =
  | 'capture-fixture'
  | 'clear-logs'
  | 'open-diagnostic'
  | 'open-search-result'
  | 'open-test-failure'
  | 'refresh-data'
  | 'run-tests'
  | 'test-watch'

/**
 * The panel models below are Tao item values: capitalized fields, no optionals, and every source
 * position spelled as a number with `-1` and `HasPosition` standing in for "unknown". The Tao Studio
 * client (`TaoStudioClient.tao`) reads them straight from the ProductHost state.
 */
export type StudioPanelAction = Readonly<{ Name: StudioPanelActionName; Payload: string }>

export type StudioProblemPanelRow = Readonly<{
  Action: StudioPanelAction
  Actionable: boolean
  Column: number
  Detail: string
  HasPosition: boolean
  Label: string
  Line: number
  Path: string
  SourceVersion: string
}>

type StudioDataPanelTable = Readonly<{
  Datasource: string
  Entity: string
  RetainedRowCount: number
  Rows: readonly string[]
  TotalRowCount: number
}>

type StudioTestFailurePanelRow = Readonly<{
  Action: StudioPanelAction
  Column: number
  Detail: string
  HasPosition: boolean
  Label: string
  Line: number
  Path: string
}>

type StudioLogPanelRow = Readonly<{
  Level: string
  Message: string
  Timestamp: number
}>

export type StudioSearchPanelRow = Readonly<{
  Action: StudioPanelAction
  Column: number
  Detail: string
  End: number
  Kind: string
  Label: string
  Line: number
  Path: string
  SourceVersion: string
  Start: number
}>

export type StudioTestsPanelModel = Readonly<{
  Available: boolean
  Error: string
  Failures: readonly StudioTestFailurePanelRow[]
  Output: string
  Reason: string
  RunAction: StudioPanelAction
  Running: boolean
  Summary: string
  Watch: boolean
  WatchAction: StudioPanelAction
}>

export type StudioDrawerPanelModel = Readonly<{
  Compile: Readonly<{
    AppliedRevision: number
    CompileRevision: number
    DiagnosticCount: number
    Diagnostics: readonly StudioProblemPanelRow[]
    Message: string
    Status: StudioCompileState['status']
  }>
  Data: Readonly<{
    CaptureAction: StudioPanelAction
    Error: string
    Loading: boolean
    RefreshAction: StudioPanelAction
    Source: string
    Tables: readonly StudioDataPanelTable[]
  }>
  Logs: Readonly<{
    ClearAction: StudioPanelAction
    RetainedCount: number
    Rows: readonly StudioLogPanelRow[]
    Source: string
    TotalCount: number
  }>
  Problems: Readonly<{ Rows: readonly StudioProblemPanelRow[] }>
  Tab: StudioDrawerTab
  Tests: StudioTestsPanelModel
}>

/** StudioProductHostPanels is the structured panel state the browser publishes to the Tao ProductHost. */
export type StudioProductHostPanels = Readonly<{
  Drawer: StudioDrawerPanelModel
  Search: Readonly<{ Rows: readonly StudioSearchPanelRow[] }>
}>

export type StudioPanelProjectionInput = Readonly<{
  compile: StudioCompileState
  data: readonly StudioRuntimeDataTable[]
  dataError?: string
  dataLoading: boolean
  dataSource?: StudioPanelCellIdentity
  logs: readonly StudioRuntimeLog[]
  logSource?: StudioPanelCellIdentity
  search: readonly StudioSearchResult[]
  sourceVersions?: Readonly<Record<string, string>>
  tab: StudioDrawerTab
  testError?: string
  testStatus?: StudioTestStatus
  testWatch: boolean
}>

/** Pure bounded projections shared by the browser renderer and the ProductHost panel state. */
export const StudioPanelModels = {
  dataRows<RowT extends Readonly<Record<string, unknown>>>(rows: readonly RowT[]): readonly RowT[] {
    return rows.slice(0, StudioPanelBounds.dataRowsPerTable)
  },
  logs(logs: readonly StudioRuntimeLog[]): readonly StudioRuntimeLog[] {
    return logs.slice(-StudioPanelBounds.logs)
  },
  testOutput(output: string): string {
    return boundedText(output, StudioPanelBounds.testOutputCharacters)
  },
} as const

/** StudioPanelProjection validates, bounds, and freezes the ProductHost panel state as Tao item values. */
export const StudioPanelProjection = {
  empty(): StudioProductHostPanels {
    return this.project({
      compile: {
        appliedRevision: 0,
        compileRevision: 0,
        diagnostics: [],
        message: 'Waiting for the first compile.',
        status: 'idle',
      },
      data: [],
      dataLoading: false,
      logs: [],
      search: [],
      tab: 'Problems',
      testWatch: false,
    })
  },

  project(input: StudioPanelProjectionInput): StudioProductHostPanels {
    const sourceVersions = input.sourceVersions ?? {}
    const diagnostics = Object.freeze(
      (input.compile.diagnostics ?? []).map(diagnostic => problemRow(diagnostic, sourceVersions)),
    )
    const tables = Object.freeze(input.data.map(table => {
      const rows = StudioPanelModels.dataRows(table.rows)
      return Object.freeze({
        Datasource: table.datasource,
        Entity: table.entity,
        RetainedRowCount: rows.length,
        Rows: Object.freeze(rows.map(row => JSON.stringify(row))),
        TotalRowCount: table.rows.length,
      })
    }))
    const retainedLogs = Object.freeze(
      StudioPanelModels.logs(input.logs).map(log =>
        Object.freeze({
          Level: log.level,
          Message: log.arguments.map(argument => jsonDisplay(argument)).join(' '),
          Timestamp: finiteNumber(log.timestamp, 'log timestamp'),
        })
      ),
    )
    return Object.freeze({
      Drawer: Object.freeze({
        Compile: Object.freeze({
          AppliedRevision: nonNegativeInteger(input.compile.appliedRevision, 'applied compile revision'),
          CompileRevision: nonNegativeInteger(input.compile.compileRevision, 'compile revision'),
          DiagnosticCount: diagnostics.length,
          Diagnostics: diagnostics,
          Message: input.compile.message,
          Status: input.compile.status,
        }),
        Data: Object.freeze({
          CaptureAction: action('capture-fixture'),
          Error: input.dataError ?? '',
          Loading: input.dataLoading,
          RefreshAction: action('refresh-data'),
          Source: cellSource(input.dataSource, 'panel source cell'),
          Tables: tables,
        }),
        Logs: Object.freeze({
          ClearAction: action('clear-logs'),
          RetainedCount: retainedLogs.length,
          Rows: retainedLogs,
          Source: cellSource(input.logSource, 'panel source cell'),
          TotalCount: input.logs.length,
        }),
        Problems: Object.freeze({ Rows: diagnostics }),
        Tab: input.tab,
        Tests: testsModel(input.testStatus, input.testWatch, input.testError),
      }),
      Search: Object.freeze({ Rows: Object.freeze(input.search.map(searchRow)) }),
    })
  },
} as const

function cellSource(identity: StudioPanelCellIdentity | undefined, label: string): string {
  if (identity === undefined) {
    return ''
  }
  Assert.input(identity.cellId.trim() !== '', 'Studio panel source cell identity must not be empty.')
  return `${studioCellLabel(identity.cellId)} · revision ${
    nonNegativeInteger(identity.cellRevision, `${label} revision`)
  }`
}

function jsonDisplay(value: StudioJsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function problemRow(
  diagnostic: StudioCompileDiagnostic,
  sourceVersions: Readonly<Record<string, string>>,
): StudioProblemPanelRow {
  const payload = JSON.stringify(diagnostic)
  const validated = StudioPanelPayloads.compileDiagnostic(payload)
  const actionable = validated.filePath !== undefined
  return Object.freeze({
    Action: action('open-diagnostic', actionable ? payload : undefined),
    Actionable: actionable,
    Column: validated.range?.start.character ?? -1,
    Detail: validated.message,
    HasPosition: actionable && validated.range !== undefined,
    Label: diagnosticLabel(validated),
    Line: validated.range?.start.line ?? -1,
    Path: validated.filePath ?? '',
    SourceVersion: (validated.filePath === undefined ? undefined : sourceVersions[validated.filePath]) ?? '',
  })
}

function testsModel(
  status: StudioTestStatus | undefined,
  watch: boolean,
  error: string | undefined,
): StudioTestsPanelModel {
  const lastRun = status?.lastRun
  const summary = lastRun === undefined
    ? ''
    : lastRun.status === 'no-tests'
    ? 'No Tao tests found.'
    : `${lastRun.passed} passed · ${lastRun.failed} failed · ${lastRun.durationMs}ms`
  return Object.freeze({
    Available: status?.available ?? false,
    Error: error ?? '',
    Failures: Object.freeze((lastRun?.failures ?? []).map(testFailureRow)),
    Output: lastRun === undefined ? '' : StudioPanelModels.testOutput(lastRun.output),
    Reason: status?.reason ?? '',
    RunAction: action('run-tests'),
    Running: status?.running ?? false,
    Summary: summary,
    Watch: watch,
    WatchAction: action('test-watch', JSON.stringify(!watch)),
  })
}

function testFailureRow(failure: StudioTestFailure): StudioTestFailurePanelRow {
  const payload = JSON.stringify(failure)
  const validated = StudioPanelPayloads.testFailure(payload)
  return Object.freeze({
    Action: action('open-test-failure', payload),
    Column: validated.column ?? -1,
    Detail: validated.message,
    HasPosition: validated.line !== undefined,
    Label: validated.name,
    Line: validated.line ?? -1,
    Path: validated.filePath,
  })
}

function searchRow(result: StudioSearchResult): StudioSearchPanelRow {
  const payload = JSON.stringify(result)
  const validated = StudioPanelPayloads.searchResult(payload)
  return Object.freeze({
    Action: action('open-search-result', payload),
    Column: validated.range?.start.character ?? -1,
    Detail: validated.detail,
    End: validated.end ?? -1,
    Kind: validated.kind,
    Label: validated.label,
    Line: validated.range?.start.line ?? -1,
    Path: validated.path,
    SourceVersion: validated.sourceVersion ?? '',
    Start: validated.start ?? -1,
  })
}

function action(name: StudioPanelActionName, payload = 'null'): StudioPanelAction {
  return Object.freeze({ Name: name, Payload: payload })
}

function nonNegativeInteger(value: number, label: string): number {
  Assert.input(Number.isInteger(value) && value >= 0, `Studio ${label} must be a non-negative integer.`)
  return value
}

function finiteNumber(value: number, label: string): number {
  Assert.input(Number.isFinite(value), `Studio ${label} must be finite.`)
  return value
}

function diagnosticLabel(diagnostic: StudioCompileDiagnostic): string {
  const line = diagnostic.range === undefined ? '' : `:${diagnostic.range.start.line + 1}`
  return `${diagnostic.filePath ?? 'Project'}${line}`
}

function boundedText(value: string, limit: number): string {
  if (value.length <= limit) {
    return value
  }
  const head = Math.floor(limit / 2)
  const tail = limit - head
  return `${value.slice(0, head)}\n… ${value.length - limit} characters omitted …\n${value.slice(-tail)}`
}
