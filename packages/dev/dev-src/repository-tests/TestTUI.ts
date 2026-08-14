import { HCI, Switch } from '@shared'
import { Box, render, Text, useWindowSize } from 'ink'
import React from 'react'

import { type ColumnLayout, DashboardGrid, type TerminalSize } from '../cli/DashboardGrid'
import { OutputText } from '../cli/OutputText'
import { type SuiteState, type SuiteStatus, TestRunner, type TestRunOptions } from './TestRunner'

type DashboardProps = {
  suites: SuiteState[]
}

const ADAPTIVE_COLUMN_WIDTHS = [22, 20, 18, 16, 14] as const
const COLUMN_MIN_WIDTH = 24
const RENDER_INTERVAL_MS = 500
const ROW_GAP = 1

/** TestTUI owns the Ink dashboard for parallel test suite runs. */
export const TestTUI = {
  runTestSuites,
}

async function runTestSuites(pattern = '', options: TestRunOptions = {}): Promise<number> {
  const startedAt = Date.now()
  const suites = await TestRunner.discoverTestSuites(pattern)
  if (suites.length === 0) {
    HCI.writeLine('No test suites found.')
    return 0
  }

  const states = suites.map(TestRunner.createSuiteState)
  const app = render(React.createElement(TestDashboard, { suites: states }), {
    alternateScreen: false,
    exitOnCtrlC: true,
    incrementalRendering: true,
    maxFps: 3,
    patchConsole: false,
  })

  let renderTimeout: ReturnType<typeof setTimeout> | undefined
  const renderDashboard = () => {
    app.rerender(React.createElement(TestDashboard, { suites: states }))
  }
  const scheduleRender = () => {
    if (renderTimeout !== undefined) {
      return
    }
    renderTimeout = setTimeout(() => {
      renderTimeout = undefined
      renderDashboard()
    }, RENDER_INTERVAL_MS)
  }

  const timer = setInterval(() => {
    for (const state of states) {
      if (state.status === 'running') {
        state.elapsedMs = state.startedAt === undefined ? 0 : Date.now() - state.startedAt
      }
    }
    scheduleRender()
  }, RENDER_INTERVAL_MS)

  await TestRunner.runSuiteProcesses(states, { jobs: options.jobs, onChange: scheduleRender })
  clearInterval(timer)
  if (renderTimeout !== undefined) {
    clearTimeout(renderTimeout)
  }
  renderDashboard()
  await app.waitUntilRenderFlush()
  app.unmount()

  await TestRunner.writeSuiteLogs(states)
  TestRunner.printResultSummary(states, Date.now() - startedAt, { includeFailureOutput: true })
  return TestRunner.suiteExitCode(states)
}

function TestDashboard(props: DashboardProps): React.ReactElement {
  const size = useWindowSize()
  return React.createElement(BoxedTestDashboard, {
    layout: dashboardLayout(size, props.suites.length),
    size,
    suites: props.suites,
  })
}

function BoxedTestDashboard(props: DashboardProps & { layout: ColumnLayout; size: TerminalSize }): React.ReactElement {
  return React.createElement(DashboardGrid<SuiteState>, {
    height: DashboardGrid.availableRows(props.size),
    items: props.suites,
    layout: props.layout,
    renderItem: (suite, isLast) =>
      React.createElement(SuiteColumn, {
        isLast,
        key: suite.name,
        lineLimit: props.layout.lineLimit,
        suite,
        width: props.layout.columnWidth,
      }),
    width: props.size.columns,
  })
}

function SuiteColumn(
  props: { isLast: boolean; lineLimit: number; suite: SuiteState; width: number },
): React.ReactElement {
  const lines = props.lineLimit === 0 ? [] : visibleLines(props.suite).slice(-props.lineLimit)

  return React.createElement(
    Box,
    {
      borderColor: statusColor(props.suite.status),
      borderStyle: 'round',
      flexDirection: 'column',
      height: props.lineLimit + 3,
      marginRight: props.isLast ? 0 : DashboardGrid.COLUMN_GAP,
      overflow: 'hidden',
      paddingX: 1,
      width: props.width,
    },
    React.createElement(
      Text,
      { bold: true, color: statusColor(props.suite.status), wrap: 'truncate-end' },
      `${props.suite.name} ${statusLabel(props.suite.status)} ${OutputText.formatElapsed(props.suite.elapsedMs)}`,
    ),
    ...lines.map((line, index) =>
      React.createElement(
        Text,
        { dimColor: statusLineDimColor(props.suite.status), key: index, wrap: 'truncate-end' },
        line,
      )
    ),
  )
}

function dashboardLayout(size: TerminalSize, suiteCount: number): ColumnLayout {
  const fullLayout = DashboardGrid.columnLayout({
    size,
    itemCount: suiteCount,
    targetColumnWidth: COLUMN_MIN_WIDTH,
    lineLimit: TestRunner.OUTPUT_LINE_LIMIT,
    rowGap: ROW_GAP,
  })
  if (DashboardGrid.layoutHeight(fullLayout, suiteCount) <= DashboardGrid.availableRows(size)) {
    return fullLayout
  }

  for (const targetColumnWidth of ADAPTIVE_COLUMN_WIDTHS) {
    const layout = DashboardGrid.columnLayout({
      size,
      itemCount: suiteCount,
      targetColumnWidth,
      lineLimit: TestRunner.OUTPUT_LINE_LIMIT,
      rowGap: 0,
    })
    const rowCount = Math.ceil(suiteCount / layout.columnsPerRow)
    const columnHeight = Math.floor(DashboardGrid.availableRows(size) / Math.max(1, rowCount))
    if (columnHeight >= DashboardGrid.MIN_COLUMN_HEIGHT) {
      return {
        ...layout,
        lineLimit: Math.min(TestRunner.OUTPUT_LINE_LIMIT, Math.max(0, columnHeight - DashboardGrid.MIN_COLUMN_HEIGHT)),
      }
    }
  }

  return DashboardGrid.columnLayout({
    size,
    itemCount: suiteCount,
    targetColumnWidth: ADAPTIVE_COLUMN_WIDTHS.at(-1)!,
    lineLimit: 0,
    rowGap: 0,
  })
}

function statusColor(status: SuiteStatus): 'gray' | 'green' | 'red' | 'yellow' {
  return Switch<SuiteStatus, 'gray' | 'green' | 'red' | 'yellow'>(status, {
    failed: () => 'red',
    passed: () => 'green',
    pending: () => 'gray',
    running: () => 'yellow',
  })
}

function statusLineDimColor(status: SuiteStatus): boolean {
  return Switch<SuiteStatus, boolean>(status, {
    failed: () => false,
    passed: () => false,
    pending: () => true,
    running: () => false,
  })
}

function visibleLines(suite: SuiteState): string[] {
  if (suite.lines.length > 0) {
    return suite.lines
  }
  return [emptySuiteLine(suite.status)]
}

function emptySuiteLine(status: SuiteStatus): string {
  return Switch<SuiteStatus, string>(status, {
    failed: () => 'failed',
    passed: () => 'ok',
    pending: () => 'waiting',
    running: () => 'running',
  })
}

function statusLabel(status: SuiteStatus): string {
  return Switch(status, {
    failed: () => 'x',
    passed: () => 'ok',
    pending: () => '-',
    running: () => '...',
  })
}
