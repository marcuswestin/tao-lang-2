import { Assert } from '@shared/core'
import { StudioPanelPayloads } from '../StudioPanelPayloads'
import type { StudioJsonObject, StudioJsonValue } from '../StudioProtocol'
import type { StudioTestFailure, StudioTestStatus } from '../StudioTestRunner'
import type { StudioCompileDiagnostic, StudioCompileState } from './StudioApiClient'
import type { StudioRuntimeDataTable, StudioRuntimeLog } from './StudioMatrixView'
import type { StudioSearchResult } from './StudioRailPanels'

export type StudioDrawerTab = 'Compile' | 'Data' | 'Logs' | 'Problems' | 'Tests'

export const StudioPanelBounds = {
  dataRowsPerTable: 250,
  logs: 500,
  testOutputCharacters: 40_000,
} as const

export type StudioPanelCellIdentity = Readonly<{ cellId: string; cellRevision: number }>

export type StudioPanelAction = Readonly<{
  name:
    | 'capture-fixture'
    | 'clear-logs'
    | 'open-diagnostic'
    | 'open-search-result'
    | 'open-test-failure'
    | 'refresh-data'
    | 'run-tests'
    | 'test-watch'
  payload: string
}>

export type StudioPanelSourceIdentity = Readonly<{
  end?: number
  path: string
  range?: StudioCompileDiagnostic['range']
  sourceVersion?: string
  start?: number
}>

export type StudioProblemPanelRow = Readonly<{
  action?: StudioPanelAction
  detail: string
  label: string
  source?: StudioPanelSourceIdentity
}>

export type StudioCompilePanelModel = Readonly<{
  appliedRevision: number
  compileRevision: number
  diagnosticCount: number
  diagnostics: readonly StudioProblemPanelRow[]
  message: string
  status: StudioCompileState['status']
}>

export type StudioProblemsPanelModel = Readonly<{
  rows: readonly StudioProblemPanelRow[]
}>

export type StudioDataPanelTable = Readonly<{
  datasource: string
  entity: string
  retainedRowCount: number
  rows: readonly StudioJsonObject[]
  totalRowCount: number
}>

export type StudioDataPanelModel = Readonly<{
  captureAction: StudioPanelAction
  error?: string
  loading: boolean
  refreshAction: StudioPanelAction
  source?: StudioPanelCellIdentity
  tables: readonly StudioDataPanelTable[]
}>

export type StudioTestFailurePanelRow = Readonly<{
  action: StudioPanelAction
  detail: string
  label: string
  source: Readonly<{
    column?: number
    line?: number
    path: string
  }>
}>

export type StudioTestsPanelModel = Readonly<{
  available: boolean
  error?: string
  failures: readonly StudioTestFailurePanelRow[]
  output?: string
  reason?: string
  runAction: StudioPanelAction
  running: boolean
  summary?: string
  watch: boolean
  watchAction: StudioPanelAction
}>

export type StudioLogPanelRow = Readonly<{
  arguments: readonly StudioJsonValue[]
  level: StudioRuntimeLog['level']
  timestamp: number
}>

export type StudioLogsPanelModel = Readonly<{
  clearAction: StudioPanelAction
  retainedCount: number
  rows: readonly StudioLogPanelRow[]
  source?: StudioPanelCellIdentity
  totalCount: number
}>

export type StudioDrawerPanelModel = Readonly<{
  compile: StudioCompilePanelModel
  data: StudioDataPanelModel
  logs: StudioLogsPanelModel
  problems: StudioProblemsPanelModel
  tab: StudioDrawerTab
  tests: StudioTestsPanelModel
}>

export type StudioSearchPanelRow = Readonly<{
  action: StudioPanelAction
  detail: string
  kind: StudioSearchResult['kind']
  label: string
  source: StudioPanelSourceIdentity
}>

export type StudioSearchPanelModel = Readonly<{
  rows: readonly StudioSearchPanelRow[]
}>

export type StudioProductHostPanels = Readonly<{
  drawer: StudioDrawerPanelModel
  search: StudioSearchPanelModel
}>

export type StudioTaoPanelAction = Readonly<{ Name: string; Payload: string }>

export type StudioTaoProblemRow = Readonly<{
  Action: StudioTaoPanelAction
  Actionable: boolean
  Column: number
  Detail: string
  HasPosition: boolean
  Label: string
  Line: number
  Path: string
  SourceVersion: string
}>

export type StudioTaoDataTable = Readonly<{
  Datasource: string
  Entity: string
  RetainedRowCount: number
  Rows: readonly string[]
  TotalRowCount: number
}>

export type StudioTaoTestFailure = Readonly<{
  Action: StudioTaoPanelAction
  Column: number
  Detail: string
  HasPosition: boolean
  Label: string
  Line: number
  Path: string
}>

export type StudioTaoLogRow = Readonly<{
  Level: string
  Message: string
  Timestamp: number
}>

export type StudioTaoSearchRow = Readonly<{
  Action: StudioTaoPanelAction
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

export type StudioTaoDrawerPanelModel = Readonly<{
  Compile: Readonly<{
    AppliedRevision: number
    CompileRevision: number
    DiagnosticCount: number
    Diagnostics: readonly StudioTaoProblemRow[]
    Message: string
    Status: string
  }>
  Data: Readonly<{
    CaptureAction: StudioTaoPanelAction
    Error: string
    Loading: boolean
    Source: string
    Tables: readonly StudioTaoDataTable[]
    RefreshAction: StudioTaoPanelAction
  }>
  Logs: Readonly<{
    ClearAction: StudioTaoPanelAction
    RetainedCount: number
    Rows: readonly StudioTaoLogRow[]
    Source: string
    TotalCount: number
  }>
  Problems: Readonly<{ Rows: readonly StudioTaoProblemRow[] }>
  Tab: StudioDrawerTab
  Tests: Readonly<{
    Available: boolean
    Error: string
    Failures: readonly StudioTaoTestFailure[]
    Output: string
    Reason: string
    RunAction: StudioTaoPanelAction
    Running: boolean
    Summary: string
    Watch: boolean
    WatchAction: StudioTaoPanelAction
  }>
}>

export type StudioTaoPanelValues = Readonly<{
  Drawer: StudioTaoDrawerPanelModel
  Search: Readonly<{ Rows: readonly StudioTaoSearchRow[] }>
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

/** Pure bounded projections shared by the legacy browser renderer and Tao ProductHost migration. */
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

/** StudioPanelProjection validates and freezes the structured ProductHost panel state. */
export const StudioPanelProjection = {
  project(input: StudioPanelProjectionInput): StudioProductHostPanels {
    const diagnostics = Object.freeze(
      (input.compile.diagnostics ?? []).map(diagnostic => problemRow(diagnostic, input.sourceVersions ?? {})),
    )
    const compile = Object.freeze({
      appliedRevision: nonNegativeInteger(input.compile.appliedRevision, 'applied compile revision'),
      compileRevision: nonNegativeInteger(input.compile.compileRevision, 'compile revision'),
      diagnosticCount: diagnostics.length,
      diagnostics,
      message: input.compile.message,
      status: input.compile.status,
    })
    const source = optionalCellIdentity(input.dataSource)
    const logSource = optionalCellIdentity(input.logSource)
    const dataTables = Object.freeze(input.data.map(table => {
      const rows = Object.freeze(StudioPanelModels.dataRows(table.rows).map(row => freezeJsonObject(row)))
      return Object.freeze({
        datasource: table.datasource,
        entity: table.entity,
        retainedRowCount: rows.length,
        rows,
        totalRowCount: table.rows.length,
      })
    }))
    const retainedLogs = Object.freeze(
      StudioPanelModels.logs(input.logs).map(log =>
        Object.freeze({
          arguments: Object.freeze(log.arguments.map(argument => freezeJson(argument))),
          level: log.level,
          timestamp: finiteNumber(log.timestamp, 'log timestamp'),
        })
      ),
    )
    const tests = testsModel(input.testStatus, input.testWatch, input.testError)
    const searchRows = Object.freeze(input.search.map(searchRow))
    return Object.freeze({
      drawer: Object.freeze({
        compile,
        data: Object.freeze({
          captureAction: action('capture-fixture'),
          ...(input.dataError === undefined ? {} : { error: input.dataError }),
          loading: input.dataLoading,
          refreshAction: action('refresh-data'),
          ...(source === undefined ? {} : { source }),
          tables: dataTables,
        }),
        logs: Object.freeze({
          clearAction: action('clear-logs'),
          retainedCount: retainedLogs.length,
          rows: retainedLogs,
          ...(logSource === undefined ? {} : { source: logSource }),
          totalCount: input.logs.length,
        }),
        problems: Object.freeze({ rows: diagnostics }),
        tab: input.tab,
        tests,
      }),
      search: Object.freeze({ rows: searchRows }),
    })
  },
} as const

/** Adapts the validated panel projection to Tao's nominal item fields. */
export const StudioTaoPanelProjection = {
  empty(): StudioTaoPanelValues {
    return this.project(StudioPanelProjection.project({
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
    }))
  },

  project(panels: StudioProductHostPanels): StudioTaoPanelValues {
    const problemRows = Object.freeze(panels.drawer.problems.rows.map(taoProblemRow))
    return Object.freeze({
      Drawer: Object.freeze({
        Compile: Object.freeze({
          AppliedRevision: panels.drawer.compile.appliedRevision,
          CompileRevision: panels.drawer.compile.compileRevision,
          DiagnosticCount: panels.drawer.compile.diagnosticCount,
          Diagnostics: Object.freeze(panels.drawer.compile.diagnostics.map(taoProblemRow)),
          Message: panels.drawer.compile.message,
          Status: panels.drawer.compile.status,
        }),
        Data: Object.freeze({
          CaptureAction: taoAction(panels.drawer.data.captureAction),
          Error: panels.drawer.data.error ?? '',
          Loading: panels.drawer.data.loading,
          RefreshAction: taoAction(panels.drawer.data.refreshAction),
          Source: cellSource(panels.drawer.data.source),
          Tables: Object.freeze(panels.drawer.data.tables.map(table =>
            Object.freeze({
              Datasource: table.datasource,
              Entity: table.entity,
              RetainedRowCount: table.retainedRowCount,
              Rows: Object.freeze(table.rows.map(row => JSON.stringify(row))),
              TotalRowCount: table.totalRowCount,
            })
          )),
        }),
        Logs: Object.freeze({
          ClearAction: taoAction(panels.drawer.logs.clearAction),
          RetainedCount: panels.drawer.logs.retainedCount,
          Rows: Object.freeze(panels.drawer.logs.rows.map(row =>
            Object.freeze({
              Level: row.level,
              Message: row.arguments.map(argument => jsonDisplay(argument)).join(' '),
              Timestamp: row.timestamp,
            })
          )),
          Source: cellSource(panels.drawer.logs.source),
          TotalCount: panels.drawer.logs.totalCount,
        }),
        Problems: Object.freeze({ Rows: problemRows }),
        Tab: panels.drawer.tab,
        Tests: Object.freeze({
          Available: panels.drawer.tests.available,
          Error: panels.drawer.tests.error ?? '',
          Failures: Object.freeze(panels.drawer.tests.failures.map(failure =>
            Object.freeze({
              Action: taoAction(failure.action),
              Column: failure.source.column ?? -1,
              Detail: failure.detail,
              HasPosition: failure.source.line !== undefined,
              Label: failure.label,
              Line: failure.source.line ?? -1,
              Path: failure.source.path,
            })
          )),
          Output: panels.drawer.tests.output ?? '',
          Reason: panels.drawer.tests.reason ?? '',
          RunAction: taoAction(panels.drawer.tests.runAction),
          Running: panels.drawer.tests.running,
          Summary: panels.drawer.tests.summary ?? '',
          Watch: panels.drawer.tests.watch,
          WatchAction: taoAction(panels.drawer.tests.watchAction),
        }),
      }),
      Search: Object.freeze({
        Rows: Object.freeze(panels.search.rows.map(row =>
          Object.freeze({
            Action: taoAction(row.action),
            Column: row.source.range?.start.character ?? -1,
            Detail: row.detail,
            End: row.source.end ?? -1,
            Kind: row.kind,
            Label: row.label,
            Line: row.source.range?.start.line ?? -1,
            Path: row.source.path,
            SourceVersion: row.source.sourceVersion ?? '',
            Start: row.source.start ?? -1,
          })
        )),
      }),
    })
  },
} as const

function taoAction(value: StudioPanelAction): StudioTaoPanelAction {
  return Object.freeze({ Name: value.name, Payload: value.payload })
}

function taoProblemRow(row: StudioProblemPanelRow): StudioTaoProblemRow {
  return Object.freeze({
    Action: taoAction(row.action ?? action('open-diagnostic')),
    Actionable: row.action !== undefined,
    Column: row.source?.range?.start.character ?? -1,
    Detail: row.detail,
    HasPosition: row.source?.range !== undefined,
    Label: row.label,
    Line: row.source?.range?.start.line ?? -1,
    Path: row.source?.path ?? '',
    SourceVersion: row.source?.sourceVersion ?? '',
  })
}

function cellSource(source: StudioPanelCellIdentity | undefined): string {
  return source === undefined ? '' : `${source.cellId} · revision ${source.cellRevision}`
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
  const source = validated.filePath === undefined
    ? undefined
    : Object.freeze({
      path: validated.filePath,
      ...(validated.range === undefined ? {} : { range: validated.range }),
      ...(sourceVersions[validated.filePath] === undefined
        ? {}
        : { sourceVersion: sourceVersions[validated.filePath] }),
    })
  return Object.freeze({
    ...(source === undefined ? {} : { action: action('open-diagnostic', payload), source }),
    detail: validated.message,
    label: diagnosticLabel(validated),
  })
}

function testsModel(
  status: StudioTestStatus | undefined,
  watch: boolean,
  error: string | undefined,
): StudioTestsPanelModel {
  const lastRun = status?.lastRun
  const failures = Object.freeze((lastRun?.failures ?? []).map(testFailureRow))
  const summary = lastRun === undefined
    ? undefined
    : lastRun.status === 'no-tests'
    ? 'No Tao tests found.'
    : `${lastRun.passed} passed · ${lastRun.failed} failed · ${lastRun.durationMs}ms`
  return Object.freeze({
    available: status?.available ?? false,
    ...(error === undefined ? {} : { error }),
    failures,
    ...(lastRun === undefined ? {} : { output: StudioPanelModels.testOutput(lastRun.output) }),
    ...(status?.reason === undefined ? {} : { reason: status.reason }),
    runAction: action('run-tests'),
    running: status?.running ?? false,
    ...(summary === undefined ? {} : { summary }),
    watch,
    watchAction: action('test-watch', JSON.stringify(!watch)),
  })
}

function testFailureRow(failure: StudioTestFailure): StudioTestFailurePanelRow {
  const payload = JSON.stringify(failure)
  const validated = StudioPanelPayloads.testFailure(payload)
  return Object.freeze({
    action: action('open-test-failure', payload),
    detail: validated.message,
    label: validated.name,
    source: Object.freeze({
      ...(validated.column === undefined ? {} : { column: validated.column }),
      ...(validated.line === undefined ? {} : { line: validated.line }),
      path: validated.filePath,
    }),
  })
}

function searchRow(result: StudioSearchResult): StudioSearchPanelRow {
  const payload = JSON.stringify(result)
  const validated = StudioPanelPayloads.searchResult(payload)
  return Object.freeze({
    action: action('open-search-result', payload),
    detail: validated.detail,
    kind: validated.kind,
    label: validated.label,
    source: Object.freeze({
      ...(validated.end === undefined ? {} : { end: validated.end }),
      path: validated.path,
      ...(validated.range === undefined ? {} : { range: validated.range }),
      ...(validated.sourceVersion === undefined ? {} : { sourceVersion: validated.sourceVersion }),
      ...(validated.start === undefined ? {} : { start: validated.start }),
    }),
  })
}

function action(name: StudioPanelAction['name'], payload = 'null'): StudioPanelAction {
  return Object.freeze({ name, payload })
}

function optionalCellIdentity(identity: StudioPanelCellIdentity | undefined): StudioPanelCellIdentity | undefined {
  if (identity === undefined) {
    return undefined
  }
  Assert.input(identity.cellId.trim() !== '', 'Studio panel source cell identity must not be empty.')
  return Object.freeze({
    cellId: identity.cellId,
    cellRevision: nonNegativeInteger(identity.cellRevision, 'panel source cell revision'),
  })
}

function nonNegativeInteger(value: number, label: string): number {
  Assert.input(Number.isInteger(value) && value >= 0, `Studio ${label} must be a non-negative integer.`)
  return value
}

function finiteNumber(value: number, label: string): number {
  Assert.input(Number.isFinite(value), `Studio ${label} must be finite.`)
  return value
}

function freezeJsonObject(value: StudioJsonObject): StudioJsonObject {
  return freezeJson(value) as StudioJsonObject
}

function freezeJson(value: StudioJsonValue): StudioJsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(entry => freezeJson(entry)))
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
    ))
  }
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
