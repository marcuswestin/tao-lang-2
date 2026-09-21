import { type ColumnLayout, DashboardGrid, OutputText, type TerminalSize } from '@cli-kit'
import { Switch } from '@shared'
import { Box, render, Text, useWindowSize } from 'ink'
import React from 'react'

import { type WorkEvent, WorkGraph, type WorkState, type WorkStatus } from './WorkGraph'
import type { WorkReporterHandle } from './WorkReporter'

/**
 * The live dashboard, generalized from the test runner to any work graph: one status-colored tile
 * per node with its last output lines, under a lane header that says how far the run has got. It is
 * what a human watching `check`, `verify`, or `test` in a terminal sees; agents and pipes get the
 * quiet reporter instead, so dashboard frames never reach a log file.
 */

type DashboardProps = {
  lane: string
  startedAt: number
  states: readonly WorkState[]
}

type DashboardItem =
  | { key: string; kind: 'group'; name: string; states: readonly WorkState[] }
  | { key: string; kind: 'node'; state: WorkState }

type DashboardColumn = {
  lines: readonly string[]
  status: WorkStatus
  title: string
}

const ADAPTIVE_COLUMN_WIDTHS = [22, 20, 18, 16, 14] as const
const COLUMN_MIN_WIDTH = 24
const RENDER_INTERVAL_MS = 500
const ROW_GAP = 1

/** createReporter renders the dashboard for one run and tears it down when the run ends. */
function createReporter(options: { lane: string }): WorkReporterHandle {
  const startedAt = Date.now()
  let states: readonly WorkState[] = []
  let app: ReturnType<typeof render> | undefined
  let renderTimeout: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined

  const element = () => React.createElement(WorkDashboard, { lane: options.lane, startedAt, states })
  const renderNow = () => {
    app?.rerender(element())
  }
  const scheduleRender = () => {
    if (renderTimeout !== undefined) {
      return
    }
    renderTimeout = setTimeout(() => {
      renderTimeout = undefined
      renderNow()
    }, RENDER_INTERVAL_MS)
  }

  const start = (planned: readonly WorkState[]) => {
    states = planned
    app = render(element(), {
      alternateScreen: false,
      exitOnCtrlC: true,
      incrementalRendering: true,
      maxFps: 3,
      patchConsole: false,
    })
    timer = setInterval(() => {
      for (const state of states) {
        if (state.status === 'running') {
          state.elapsedMs = WorkGraph.elapsedMs(state)
        }
      }
      scheduleRender()
    }, RENDER_INTERVAL_MS)
  }

  return {
    finish: async () => {
      if (timer !== undefined) {
        clearInterval(timer)
      }
      if (renderTimeout !== undefined) {
        clearTimeout(renderTimeout)
      }
      renderNow()
      await app?.waitUntilRenderFlush()
      app?.unmount()
      app = undefined
    },
    handle: event =>
      Switch.kind<WorkEvent, void>(event, {
        complete: () => scheduleRender(),
        done: () => {},
        output: () => scheduleRender(),
        planned: ({ states: planned }) => start(planned),
        start: () => scheduleRender(),
        waiting: () => scheduleRender(),
      }),
  }
}

function WorkDashboard(props: DashboardProps): React.ReactElement {
  const size = useWindowSize()
  const summary = dashboardSummaryText(props.states)
  const headerRows = summary === undefined ? 1 : 2
  const items = dashboardItems(props.states)
  return React.createElement(
    Box,
    { flexDirection: 'column', height: DashboardGrid.availableRows(size), width: size.columns },
    React.createElement(
      Text,
      { bold: true, key: 'header', wrap: 'truncate-end' },
      headerText(props),
    ),
    summary === undefined
      ? null
      : React.createElement(Text, { dimColor: true, key: 'summary', wrap: 'truncate-end' }, summary),
    React.createElement(BoxedWorkDashboard, {
      headerRows,
      items,
      key: 'grid',
      layout: dashboardLayout(size, items.length, headerRows),
      size,
    }),
  )
}

function BoxedWorkDashboard(
  props: { headerRows: number; items: readonly DashboardItem[]; layout: ColumnLayout; size: TerminalSize },
): React.ReactElement {
  return React.createElement(DashboardGrid<DashboardItem>, {
    height: Math.max(1, DashboardGrid.availableRows(props.size) - props.headerRows),
    items: props.items,
    layout: props.layout,
    renderItem: (item, isLast) =>
      React.createElement(WorkColumn, {
        isLast,
        item,
        key: item.key,
        lineLimit: props.layout.lineLimit,
        width: props.layout.columnWidth,
      }),
    width: props.size.columns,
  })
}

/**
 * dashboardItems groups only nodes their producer explicitly marked. Names remain opaque: a node
 * called `example#1` is still its own card unless it belongs to a declared dashboard group.
 */
function dashboardItems(states: readonly WorkState[]): readonly DashboardItem[] {
  const items: DashboardItem[] = []
  const groups = new Map<string, { key: string; kind: 'group'; name: string; states: WorkState[] }>()
  for (const state of states) {
    if (state.dashboardGroup === undefined) {
      items.push({ key: `node:${state.name}`, kind: 'node', state })
      continue
    }
    const existing = groups.get(state.dashboardGroup)
    if (existing !== undefined) {
      existing.states.push(state)
      continue
    }
    const group = {
      key: `group:${state.dashboardGroup}`,
      kind: 'group' as const,
      name: state.dashboardGroup,
      states: [state],
    }
    groups.set(state.dashboardGroup, group)
    items.push(group)
  }
  return items
}

/**
 * dashboardSummaryText names the largest reason pending work is not running. A dense graph can have
 * dozens of identical waiting cards; the summary collapses the first two unresolved dependencies
 * into one causal chain, counting the intermediate node as blocked too.
 */
function dashboardSummaryText(states: readonly WorkState[]): string | undefined {
  const byName = new Map(states.map(state => [state.name, state]))
  const groups = new Map<string, number>()
  const add = (description: string) => groups.set(description, (groups.get(description) ?? 0) + 1)

  for (const state of states) {
    if (state.status !== 'pending') {
      continue
    }
    const dependencyPath = unresolvedDependencyPath(state, byName, new Set())
    if (dependencyPath.length > 1) {
      add(`blocked on ${dependencyPath.slice(0, 2).join(' → ')}`)
      continue
    }
    if (state.reason?.startsWith('waiting for machine capacity') === true) {
      add(state.reason)
      continue
    }
    const heldResource = (state.node.resources ?? []).find(resource =>
      states.some(candidate => candidate.status === 'running' && candidate.node.resources?.includes(resource))
    )
    add(heldResource === undefined ? 'waiting for local capacity' : `blocked on resource ${heldResource}`)
  }

  const largest = [...groups].toSorted(
    ([leftText, leftCount], [rightText, rightCount]) => rightCount - leftCount || leftText.localeCompare(rightText),
  )[0]
  return largest === undefined ? undefined : `${largest[1]} ${largest[1] === 1 ? 'node' : 'nodes'} ${largest[0]}`
}

function unresolvedDependencyPath(
  state: WorkState,
  byName: ReadonlyMap<string, WorkState>,
  visiting: ReadonlySet<string>,
): string[] {
  if (visiting.has(state.name)) {
    return [state.name]
  }
  const nextVisiting = new Set(visiting).add(state.name)
  for (const need of state.node.needs ?? []) {
    const dependency = byName.get(need)
    if (dependency !== undefined && dependency.status !== 'passed') {
      return [...unresolvedDependencyPath(dependency, byName, nextVisiting), state.name]
    }
  }
  return [state.name]
}

/** headerText says how far the lane has got, so progress is readable without counting tiles. */
function headerText(props: DashboardProps): string {
  const counts = { done: 0, pending: 0, running: 0 }
  for (const state of props.states) {
    if (state.status === 'running') {
      counts.running += 1
    } else if (state.status === 'pending') {
      counts.pending += 1
    } else {
      counts.done += 1
    }
  }
  return `${props.lane}: ${counts.done}/${props.states.length} done, ${counts.running} running,`
    + ` ${counts.pending} pending — ${OutputText.formatElapsed(Date.now() - props.startedAt)}`
}

function WorkColumn(
  props: { isLast: boolean; item: DashboardItem; lineLimit: number; width: number },
): React.ReactElement {
  const column = dashboardColumn(props.item, props.lineLimit)

  return React.createElement(
    Box,
    {
      borderColor: statusColor(column.status),
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
      { bold: true, color: statusColor(column.status), wrap: 'truncate-end' },
      column.title,
    ),
    ...column.lines.map((line, index) =>
      React.createElement(
        Text,
        { dimColor: statusLineDimColor(column.status), key: index, wrap: 'truncate-end' },
        line,
      )
    ),
  )
}

function dashboardColumn(item: DashboardItem, lineLimit: number): DashboardColumn {
  if (item.kind === 'node') {
    const { state } = item
    return {
      lines: lineLimit === 0 ? [] : visibleLines(state).slice(-lineLimit),
      status: state.status,
      title: `${WorkGraph.nodeLabel(state.node)} ${statusLabel(state.status)} ${
        OutputText.formatElapsed(state.elapsedMs)
      }`,
    }
  }

  const status = groupedStatus(item.states)
  const done = item.states.filter(state => state.status !== 'pending' && state.status !== 'running').length
  const elapsedMs = Math.max(0, ...item.states.map(state => state.elapsedMs))
  const failed = item.states.filter(state => state.status === 'failed').map(state => shardLabel(item.name, state))
  const title = failed.length === 0
    ? `${item.name} ${done}/${item.states.length} ${statusLabel(status)} ${OutputText.formatElapsed(elapsedMs)}`
    : `${failed.join(',')} ${statusLabel(status)} ${item.name} ${done}/${item.states.length} ${
      OutputText.formatElapsed(elapsedMs)
    }`
  if (lineLimit === 0) {
    return { lines: [], status, title }
  }
  // `toSorted` is stable, so equal-status shards retain the numeric plan order TestNodes supplied.
  const ordered = [...item.states].toSorted((left, right) => statusPriority(left.status) - statusPriority(right.status))
  return {
    lines: [groupSummaryLine(item.states), ...ordered.map(state => shardStatusLine(item.name, state))]
      .slice(0, lineLimit),
    status,
    title,
  }
}

/** A failed shard owns the card, then active work, then waiting work, then completed history. */
function groupedStatus(states: readonly WorkState[]): WorkStatus {
  if (states.every(state => state.status === 'skipped')) {
    return 'skipped'
  }
  return (['failed', 'running', 'pending', 'passed', 'skipped'] as const)
    .find(status => states.some(state => state.status === status)) ?? 'skipped'
}

function statusPriority(status: WorkStatus): number {
  return Switch<WorkStatus, number>(status, {
    failed: () => 0,
    running: () => 1,
    pending: () => 2,
    skipped: () => 3,
    passed: () => 4,
  })
}

function groupSummaryLine(states: readonly WorkState[]): string {
  const counts: Record<WorkStatus, number> = { failed: 0, passed: 0, pending: 0, running: 0, skipped: 0 }
  for (const state of states) {
    counts[state.status] += 1
  }
  return ([
    ['failed', counts.failed],
    ['running', counts.running],
    ['waiting', counts.pending],
    ['passed', counts.passed],
    ['skipped', counts.skipped],
  ] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ')
}

function shardStatusLine(group: string, state: WorkState): string {
  const detail = state.reason ?? (state.status === 'failed' ? state.lines.at(-1) : undefined)
  const suffix = detail ?? OutputText.formatElapsed(state.elapsedMs)
  return `${shardLabel(group, state)} ${statusLabel(state.status)} ${suffix}`
}

function shardLabel(group: string, state: WorkState): string {
  const prefix = `${group}#`
  return state.name.startsWith(prefix) ? `#${state.name.slice(prefix.length)}` : WorkGraph.nodeLabel(state.node)
}

function dashboardLayout(size: TerminalSize, nodeCount: number, headerRows: number): ColumnLayout {
  const availableRows = Math.max(1, DashboardGrid.availableRows(size) - headerRows)
  const fullLayout = DashboardGrid.columnLayout({
    size,
    itemCount: nodeCount,
    targetColumnWidth: COLUMN_MIN_WIDTH,
    lineLimit: WorkGraph.OUTPUT_LINE_LIMIT,
    rowGap: ROW_GAP,
  })
  if (DashboardGrid.layoutHeight(fullLayout, nodeCount) <= availableRows) {
    return fullLayout
  }

  for (const targetColumnWidth of ADAPTIVE_COLUMN_WIDTHS) {
    const layout = DashboardGrid.columnLayout({
      size,
      itemCount: nodeCount,
      targetColumnWidth,
      lineLimit: WorkGraph.OUTPUT_LINE_LIMIT,
      rowGap: 0,
    })
    const rowCount = Math.ceil(nodeCount / layout.columnsPerRow)
    const columnHeight = Math.floor(availableRows / Math.max(1, rowCount))
    if (columnHeight >= DashboardGrid.MIN_COLUMN_HEIGHT) {
      return {
        ...layout,
        lineLimit: Math.min(
          WorkGraph.OUTPUT_LINE_LIMIT,
          Math.max(0, columnHeight - DashboardGrid.MIN_COLUMN_HEIGHT),
        ),
      }
    }
  }

  return DashboardGrid.columnLayout({
    size,
    itemCount: nodeCount,
    targetColumnWidth: ADAPTIVE_COLUMN_WIDTHS.at(-1)!,
    lineLimit: 0,
    rowGap: 0,
  })
}

function statusColor(status: WorkStatus): 'gray' | 'green' | 'red' | 'yellow' {
  return Switch<WorkStatus, 'gray' | 'green' | 'red' | 'yellow'>(status, {
    failed: () => 'red',
    passed: () => 'green',
    pending: () => 'gray',
    running: () => 'yellow',
    skipped: () => 'gray',
  })
}

function statusLineDimColor(status: WorkStatus): boolean {
  return Switch<WorkStatus, boolean>(status, {
    failed: () => false,
    passed: () => false,
    pending: () => true,
    running: () => false,
    skipped: () => true,
  })
}

function visibleLines(state: WorkState): string[] {
  if (state.lines.length > 0) {
    return state.lines
  }
  return [emptyNodeLine(state.status, state.reason)]
}

/**
 * emptyNodeLine is all a node that has produced no output yet gets to say. A pending node prefers
 * its recorded reason: a column of bare `waiting` cards is the same picture whether the lane is
 * blocked behind another worktree or simply has nothing free, and those call for different actions.
 */
function emptyNodeLine(status: WorkStatus, reason: string | undefined): string {
  return Switch<WorkStatus, string>(status, {
    failed: () => 'failed',
    passed: () => 'ok',
    pending: () => reason ?? 'waiting',
    running: () => 'running',
    skipped: () => 'skipped',
  })
}

function statusLabel(status: WorkStatus): string {
  return Switch<WorkStatus, string>(status, {
    failed: () => 'x',
    passed: () => 'ok',
    pending: () => '-',
    running: () => '...',
    skipped: () => '~',
  })
}

/** WorkTUI owns the Ink dashboard for a running work graph. */
export const WorkTUI = {
  createReporter,
  testing: { dashboardColumn, dashboardItems, dashboardLayout, dashboardSummaryText, headerText },
} as const
