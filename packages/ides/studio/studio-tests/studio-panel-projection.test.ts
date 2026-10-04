import type TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { studioPanelLogs } from '../studio-src/client/app/StudioProductHostState'
import { StudioPanelBounds, StudioPanelProjection } from '../studio-src/client/StudioPanelProjection'
import { StudioRailPanels } from '../studio-src/client/StudioRailPanels'
import { StudioSearchHit } from '../studio-src/product-host/StudioPanelRows'
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
    const search = StudioRailPanels.search(
      [{
        content: 'view Main() {\n   Text("Needle")\n}',
        path: '/project/Main.tao',
      }],
      [],
      'needle',
    )
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      logs: [...logs, { arguments: ['saved', { Id: 7 }], level: 'info', timestamp: 999 }],
      logSource: { cellId: 'cell:active', cellRevision: 9 },
      search,
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
      Column: 9,
      Detail: 'Text("Needle")',
      End: 29,
      Kind: 'text',
      Label: 'Main.tao:2',
      Line: 1,
      Path: '/project/Main.tao',
      SourceVersion: '',
      Start: 23,
    })
    const actionPayload = JSON.parse(panels.Search.Rows[0]!.Action.Payload)
    Expect(actionPayload).toMatchObject({ path: '/project/Main.tao', start: 23 })
    Expect(actionPayload).not.toHaveProperty('sourceVersion')
    const row = panels.Search.Rows[0]!
    const html = renderToStaticMarkup(React.createElement(StudioSearchHit, {
      Column: row.Column,
      Detail: row.Detail,
      Kind: row.Kind,
      Label: row.Label,
      Line: row.Line,
      Open: { invoke() {} } as unknown as TR.ActionValue<[]>,
      Path: row.Path,
    }))
    Expect(html).toContain('Main.tao:2:10')
  })

  Test('shows connected device lines beside browser lines with a device label', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      logs: studioPanelLogs(
        [{ arguments: ['browser ready'], level: 'log', timestamp: 20 }],
        [{ deviceName: 'the Developer’s iPhone', level: 'warn', message: 'network slow', sequence: 1, timestamp: 10 }],
      ),
    })
    Expect(panels.Drawer.Logs.Rows).toEqual([
      { Level: 'warn', Message: 'Device the Developer’s iPhone: network slow', Timestamp: 10 },
      { Level: 'log', Message: 'browser ready', Timestamp: 20 },
    ])
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

  Test('Feed projects bounded schema-backed rows and disables edits during pending work', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      feed: {
        entities: ['Posts'],
        entity: 'Posts',
        source: 'Generated',
        seed: 'replay-42',
        rows: Array.from({ length: 251 }, (_, index) => ({
          rowId: `row-${index}`,
          label: `Post ${index}`,
          fields: [{
            path: ['author', 'avatar'],
            label: 'Avatar',
            value: 'https://example.test/a.png',
            presentation: 'image' as const,
          }],
        })),
        selectedRowId: 'row-0',
        loading: false,
        pending: true,
        error: 'Keep failed',
        canKeep: true,
        canDiscard: true,
        canUndo: true,
      },
    })
    const feed = panels.Drawer.Data.Feed
    Expect(feed.Rows).toHaveLength(250)
    Expect(feed).toMatchObject({
      Entity: 'Posts',
      Source: 'Generated',
      Seed: 'replay-42',
      Pending: true,
      CanKeep: false,
      CanDiscard: false,
      CanUndo: false,
      Error: 'Keep failed',
      Sources: ['Fixture', 'Generated', 'Live', 'Library'],
    })
    Expect(feed.Rows[0]?.Selected).toBe(true)
    Expect(feed.Rows[1]?.Selected).toBe(false)
    const selectAction = feed.Rows[0]!.SelectAction
    Expect({ Name: selectAction.Name, Payload: JSON.parse(selectAction.Payload) }).toEqual({
      Name: 'feed-action',
      Payload: { type: 'select-row', rowId: 'row-0' },
    })
    Expect(JSON.parse(feed.Rows[0]?.DragPayload ?? '{}')).toEqual({ kind: 'entity', entity: 'Posts', rowId: 'row-0' })
    Expect(JSON.parse(feed.Rows[0]?.Fields[0]?.DragPayload ?? '{}')).toEqual({
      kind: 'field',
      entity: 'Posts',
      rowId: 'row-0',
      path: ['author', 'avatar'],
      presentation: 'image',
    })
    Expect(feed.KeepAction.Payload).toBe('{"type":"keep"}')
    Expect(feed.DiscardAction.Payload).toBe('{"type":"discard"}')
    Expect(feed.UndoAction.Payload).toBe('{"type":"undo"}')
    Expect(Object.isFrozen(feed.Rows[0]?.Fields)).toBe(true)
  })

  Test('Feed keeps Discard available while refreshing a pending example', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      feed: {
        entities: [],
        entity: '',
        source: 'Fixture',
        seed: 'seed',
        rows: [],
        loading: true,
        pending: false,
        canKeep: true,
        canDiscard: true,
      },
    })
    Expect(panels.Drawer.Data.Feed).toMatchObject({ CanKeep: false, CanDiscard: true })
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
    Expect(panels.Drawer.Data.Feed).toMatchObject({
      Rows: [],
      CanKeep: false,
      CanDiscard: false,
      Loading: false,
      Pending: false,
    })
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
