import { Describe, Expect, Test } from '@shared/test'
import { StudioPanelBounds, StudioPanelProjection } from '../studio-src/client/StudioPanelProjection'
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

    Expect(panels.Drawer.Compile).toMatchObject({
      AppliedRevision: 4,
      CompileRevision: 5,
      DiagnosticCount: 1,
      Message: 'Compile failed',
      Status: 'error',
    })
    Expect(panels.Drawer.Problems.Rows).toEqual(panels.Drawer.Compile.Diagnostics)
    Expect(panels.Drawer.Problems.Rows[0]).toMatchObject({
      Action: { Name: 'open-diagnostic' },
      Actionable: true,
      Column: 3,
      Detail: 'Unknown view',
      HasPosition: true,
      Label: '/project/Main.tao:3',
      Line: 2,
      Path: '/project/Main.tao',
      SourceVersion: 'version:7',
    })
    Expect(JSON.parse(panels.Drawer.Problems.Rows[0]!.Action.Payload)).toMatchObject({
      filePath: '/project/Main.tao',
      message: 'Unknown view',
    })
    Expect(Object.isFrozen(panels.Drawer.Problems.Rows)).toBe(true)
  })

  Test('keeps a project-wide diagnostic navigable-looking but not actionable', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      compile: { ...compile, diagnostics: [{ message: 'No entry app' }] },
    })

    Expect(panels.Drawer.Problems.Rows[0]).toEqual({
      Action: { Name: 'open-diagnostic', Payload: 'null' },
      Actionable: false,
      Column: -1,
      Detail: 'No entry app',
      HasPosition: false,
      Label: 'Project',
      Line: -1,
      Path: '',
      SourceVersion: '',
    })
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

    Expect(panels.Drawer.Data).toMatchObject({
      Error: 'Refresh failed',
      Loading: true,
      Source: 'cell:notes · revision 7',
    })
    Expect(panels.Drawer.Data.Tables[0]).toMatchObject({
      Datasource: 'Notes:local',
      Entity: 'Notes',
      RetainedRowCount: StudioPanelBounds.dataRowsPerTable,
      TotalRowCount: StudioPanelBounds.dataRowsPerTable + 3,
    })
    Expect(panels.Drawer.Data.Tables[0]!.Rows).toHaveLength(StudioPanelBounds.dataRowsPerTable)
    Expect(panels.Drawer.Data.Tables[0]!.Rows[6]).toBe('{"Id":6}')
    Expect(Object.isFrozen(panels.Drawer.Data.Tables[0]!.Rows)).toBe(true)
    Expect(panels.Drawer.Data.RefreshAction).toEqual({ Name: 'refresh-data', Payload: 'null' })
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

    Expect(panels.Drawer.Tests).toMatchObject({
      Available: true,
      Running: true,
      Summary: '2 passed · 1 failed · 42ms',
      Watch: true,
      WatchAction: { Name: 'test-watch', Payload: 'false' },
    })
    Expect(panels.Drawer.Tests.Output).toContain('characters omitted')
    Expect(panels.Drawer.Tests.Failures[0]).toMatchObject({
      Action: { Name: 'open-test-failure' },
      Column: 5,
      Detail: 'Expected Saved',
      HasPosition: true,
      Label: 'Main > saves',
      Line: 12,
      Path: '/project/Main.test.tao',
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
      logs: [...logs, { arguments: ['saved', { Id: 7 }], level: 'info', timestamp: 999 }],
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

    Expect(panels.Drawer.Logs).toMatchObject({
      RetainedCount: StudioPanelBounds.logs,
      Source: 'cell:active · revision 9',
      TotalCount: StudioPanelBounds.logs + 3,
    })
    Expect(panels.Drawer.Logs.Rows[0]?.Timestamp).toBe(3)
    Expect(panels.Drawer.Logs.Rows.at(-1)).toEqual({ Level: 'info', Message: 'saved {"Id":7}', Timestamp: 999 })
    Expect(panels.Search.Rows[0]).toMatchObject({
      Action: { Name: 'open-search-result' },
      Column: -1,
      Detail: 'Text("Needle")',
      End: 20,
      Kind: 'text',
      Label: 'Main.tao:2',
      Line: -1,
      Path: '/project/Main.tao',
      SourceVersion: 'version:3',
      Start: 14,
    })
    Expect(JSON.parse(panels.Search.Rows[0]!.Action.Payload)).toMatchObject({
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

  Test('empty panels wait for the first compile with nothing to show', () => {
    const panels = StudioPanelProjection.empty()

    Expect(panels.Drawer.Compile).toMatchObject({
      DiagnosticCount: 0,
      Message: 'Waiting for the first compile.',
      Status: 'idle',
    })
    Expect(panels.Drawer.Tab).toBe('Problems')
    Expect(panels.Drawer.Tests.Available).toBe(false)
    Expect(panels.Search.Rows).toEqual([])
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
