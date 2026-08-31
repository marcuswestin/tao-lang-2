import { Describe, Expect, Test } from '@shared/test'
import {
  StudioPanelBounds,
  StudioPanelProjection,
  StudioTaoPanelProjection,
} from '../studio-src/client/StudioPanelProjection'
import type { StudioTestStatus } from '../studio-src/StudioTestRunner'

const compile = {
  appliedRevision: 4,
  compileRevision: 5,
  diagnostics: [{
    filePath: '/project/Main.tao',
    message: 'Unknown view',
    range: {
      end: { character: 8, line: 2 },
      start: { character: 3, line: 2 },
    },
  }],
  message: 'Compile failed',
  status: 'error' as const,
}

Describe('Studio structured panel projection', () => {
  Test('projects compile and Problems rows with validated source actions', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      sourceVersions: { '/project/Main.tao': 'version:7' },
    })

    Expect(panels.drawer.compile).toMatchObject({
      appliedRevision: 4,
      compileRevision: 5,
      diagnosticCount: 1,
      message: 'Compile failed',
      status: 'error',
    })
    Expect(panels.drawer.problems.rows).toEqual(panels.drawer.compile.diagnostics)
    Expect(panels.drawer.problems.rows[0]).toMatchObject({
      action: { name: 'open-diagnostic' },
      detail: 'Unknown view',
      label: '/project/Main.tao:3',
      source: { path: '/project/Main.tao', sourceVersion: 'version:7' },
    })
    Expect(JSON.parse(panels.drawer.problems.rows[0]!.action!.payload)).toMatchObject({
      filePath: '/project/Main.tao',
      message: 'Unknown view',
    })
    Expect(Object.isFrozen(panels.drawer.problems.rows)).toBe(true)
  })

  Test('retains bounded Data rows with loading, error, and active-cell source identity', () => {
    const rows = Array.from({ length: StudioPanelBounds.dataRowsPerTable + 3 }, (_, Id) => ({ Id }))
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      data: [{ datasource: 'Notes:local', entity: 'Notes', rows }],
      dataError: 'Refresh failed',
      dataLoading: true,
      dataSource: { cellId: 'cell:notes', cellRevision: 7 },
    })

    Expect(panels.drawer.data).toMatchObject({
      error: 'Refresh failed',
      loading: true,
      source: { cellId: 'cell:notes', cellRevision: 7 },
    })
    Expect(panels.drawer.data.tables[0]).toMatchObject({
      datasource: 'Notes:local',
      entity: 'Notes',
      retainedRowCount: StudioPanelBounds.dataRowsPerTable,
      totalRowCount: StudioPanelBounds.dataRowsPerTable + 3,
    })
    Expect(panels.drawer.data.tables[0]!.rows).toHaveLength(StudioPanelBounds.dataRowsPerTable)
    Expect(panels.drawer.data.refreshAction).toEqual({ name: 'refresh-data', payload: 'null' })
  })

  Test('projects running/watch test state, bounded output, summaries, and navigable failures', () => {
    const status: StudioTestStatus = {
      available: true,
      lastRun: {
        durationMs: 42,
        failed: 1,
        failures: [{
          column: 5,
          filePath: '/project/Main.test.tao',
          line: 12,
          message: 'Expected Saved',
          name: 'Main > saves',
        }],
        finishedAt: '2026-08-31T00:00:00.000Z',
        id: 'run-1',
        output: `head:${'x'.repeat(StudioPanelBounds.testOutputCharacters)}:tail`,
        passed: 2,
        status: 'failed',
        testFiles: ['/project/Main.test.tao'],
      },
      running: true,
    }
    const panels = StudioPanelProjection.project({ ...baseInput(), testStatus: status, testWatch: true })

    Expect(panels.drawer.tests).toMatchObject({
      available: true,
      running: true,
      summary: '2 passed · 1 failed · 42ms',
      watch: true,
      watchAction: { name: 'test-watch', payload: 'false' },
    })
    Expect(panels.drawer.tests.output).toContain('characters omitted')
    Expect(panels.drawer.tests.failures[0]).toMatchObject({
      action: { name: 'open-test-failure' },
      detail: 'Expected Saved',
      label: 'Main > saves',
      source: { column: 5, line: 12, path: '/project/Main.test.tao' },
    })
  })

  Test('retains only bounded active-cell Logs and structured Search source/action rows', () => {
    const logs = Array.from({ length: StudioPanelBounds.logs + 2 }, (_, timestamp) => ({
      arguments: [timestamp],
      level: 'log' as const,
      timestamp,
    }))
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      logs,
      logSource: { cellId: 'cell:active', cellRevision: 9 },
      search: [{
        detail: 'Text("Needle")',
        end: 20,
        kind: 'text',
        label: 'Main.tao:2',
        path: '/project/Main.tao',
        sourceVersion: 'version:3',
        start: 14,
      }],
    })

    Expect(panels.drawer.logs).toMatchObject({
      retainedCount: StudioPanelBounds.logs,
      source: { cellId: 'cell:active', cellRevision: 9 },
      totalCount: StudioPanelBounds.logs + 2,
    })
    Expect(panels.drawer.logs.rows[0]?.timestamp).toBe(2)
    Expect(panels.search.rows[0]).toMatchObject({
      action: { name: 'open-search-result' },
      detail: 'Text("Needle")',
      kind: 'text',
      label: 'Main.tao:2',
      source: {
        end: 20,
        path: '/project/Main.tao',
        sourceVersion: 'version:3',
        start: 14,
      },
    })
    Expect(JSON.parse(panels.search.rows[0]!.action.payload)).toMatchObject({
      path: '/project/Main.tao',
      sourceVersion: 'version:3',
    })
  })

  Test('rejects invalid controller identities before publication', () => {
    Expect(() =>
      StudioPanelProjection.project({
        ...baseInput(),
        dataSource: { cellId: '', cellRevision: 1 },
      })
    ).toThrow('must not be empty')
    Expect(() =>
      StudioPanelProjection.project({
        ...baseInput(),
        logSource: { cellId: 'cell', cellRevision: -1 },
      })
    ).toThrow('non-negative integer')
  })

  Test('adapts validated models to structured Tao values without losing source or action identity', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      data: [{ datasource: 'Notes:local', entity: 'Notes', rows: [{ Id: 7, Title: 'Draft' }] }],
      dataSource: { cellId: 'cell:notes', cellRevision: 3 },
      logs: [{ arguments: ['saved', { Id: 7 }], level: 'info', timestamp: 42 }],
      logSource: { cellId: 'cell:notes', cellRevision: 3 },
      search: [{
        detail: 'Text("Needle")',
        end: 20,
        kind: 'text',
        label: 'Main.tao:2',
        path: '/project/Main.tao',
        sourceVersion: 'version:3',
        start: 14,
      }],
      sourceVersions: { '/project/Main.tao': 'version:7' },
    })
    const values = StudioTaoPanelProjection.project(panels)

    Expect(values.Drawer.Data).toMatchObject({
      Source: 'cell:notes · revision 3',
      Tables: [{ Rows: ['{"Id":7,"Title":"Draft"}'] }],
    })
    Expect(values.Drawer.Logs).toMatchObject({
      Rows: [{ Level: 'info', Message: 'saved {"Id":7}', Timestamp: 42 }],
      Source: 'cell:notes · revision 3',
    })
    Expect(values.Drawer.Problems.Rows[0]).toMatchObject({
      Action: { Name: 'open-diagnostic' },
      Actionable: true,
      Column: 3,
      Line: 2,
      Path: '/project/Main.tao',
      SourceVersion: 'version:7',
    })
    Expect(JSON.parse(values.Search.Rows[0]!.Action.Payload)).toMatchObject({
      path: '/project/Main.tao',
      sourceVersion: 'version:3',
    })
    Expect(Object.isFrozen(values.Drawer.Data.Tables[0]!.Rows)).toBe(true)
  })
})

function baseInput(): Parameters<typeof StudioPanelProjection.project>[0] {
  return {
    compile,
    data: [],
    dataLoading: false,
    logs: [],
    search: [],
    tab: 'Problems',
    testWatch: false,
  }
}
