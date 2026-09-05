import { HCI, Platform, Switch } from '@shared'
import { Box, render, Text, useWindowSize } from 'ink'
import React from 'react'

import { type ColumnLayout, DashboardGrid, type TerminalSize } from '../cli/DashboardGrid'
import { OutputText } from '../cli/OutputText'

type DevLoopControlKey = 'a' | 'c' | 'd' | 'e' | 'f' | 'i' | 'p' | 'q' | 'r' | 's' | 't' | 'v' | 'w'

type DevLoopControl = {
  key: DevLoopControlKey
  label: string
}

type DevLoopOutputKind = 'error' | 'info' | 'warn'

type DevLoopOutputLine = {
  kind: DevLoopOutputKind
  text: string
}

type DevLoopOutputStream = {
  lines: DevLoopOutputLine[]
  name: string
  pending: string
}

type DevLoopOutputState = {
  failure?: {
    message: string
    streamName: string
  }
  prompt?: string
  streams: Map<string, DevLoopOutputStream>
}

type DevLoopOutputHandle = {
  stop: () => Promise<void>
}

const DEV_LOOP_LINE_LIMIT = 120
const DEV_LOOP_TARGET_COLUMN_WIDTH = 48
const DEV_LOOP_ADAPTIVE_COLUMN_WIDTHS = [40, 32, 28] as const
const DEV_LOOP_RENDER_INTERVAL_MS = 250
const DEV_LOOP_PANE_CHROME_WIDTH = 4
const ROW_GAP = 1
const DEV_LOOP_STREAM_ORDER = [
  'dev',
  'compile',
  'expo',
  'parser',
  'test',
  'verify',
  'fix',
  'clean',
  'deps',
  'extension',
  'watch',
] as const

const DEV_LOOP_CONTROLS: DevLoopControl[] = [
  { key: 'q', label: 'quit' },
  { key: 'd', label: 'open connected device' },
  { key: 'p', label: 'reload dev process' },
  { key: 'r', label: 'recompile and reload Expo app' },
  { key: 'w', label: 'open web' },
  { key: 'i', label: 'open iOS simulator' },
  { key: 'a', label: 'open Android' },
  { key: 's', label: 'switch app' },
  { key: 'c', label: 'clean, install deps, and reload' },
  { key: 'f', label: 'fix' },
  { key: 't', label: 'test' },
  { key: 'v', label: 'verify' },
  { key: 'e', label: 'install IDE extension' },
]

let activeDevLoopOutput: {
  app: ReturnType<typeof render>
  renderTimeout?: ReturnType<typeof setTimeout>
  state: DevLoopOutputState
} | undefined

/** DevLoopTUI owns interactive output for the dev loop. */
export const DevLoopTUI = {
  askConfirm,
  clearFailure,
  dashboardLayout: devLoopDashboardLayout,
  devLoopOutputHandler,
  devLoopOutputKind,
  logDevLoop,
  printDevLoopControls,
  recordFailure,
  startDevLoopOutput,
  stopDevLoopOutput,
  writeDevLoopOutput,
}

type ConfirmPromptOptions = Parameters<typeof HCI.askConfirm>[0]

/** askConfirm keeps confirmations visible in the dashboard footer while readline owns input. */
async function askConfirm(options: ConfirmPromptOptions): Promise<boolean> {
  const activeOutput = activeDevLoopOutput
  if (activeOutput === undefined) {
    return await HCI.askConfirm(options)
  }

  // Readline owns the terminal while the prompt is open. Any repaint scheduled before or during it
  // would erase the question and whatever the user has typed, so drop the pending one and hold the rest.
  if (activeOutput.renderTimeout !== undefined) {
    clearTimeout(activeOutput.renderTimeout)
    activeOutput.renderTimeout = undefined
  }
  activeOutput.state.prompt = formatConfirmPrompt(options)
  activeOutput.app.rerender(React.createElement(DevLoopOutputDashboard, { state: activeOutput.state }))
  await activeOutput.app.waitUntilRenderFlush()
  try {
    return await HCI.askConfirm(options)
  } finally {
    if (activeDevLoopOutput === activeOutput) {
      activeOutput.state.prompt = undefined
      scheduleDevLoopRender()
    }
  }
}

function formatConfirmPrompt(options: ConfirmPromptOptions): string {
  return `${options.message}${HCI.confirmChoiceSuffix(options.defaultValue)}`
}

function startDevLoopOutput(): DevLoopOutputHandle | undefined {
  if (!Platform.runtimeProcess.stdout.isTTY) {
    return undefined
  }
  if (activeDevLoopOutput !== undefined) {
    return { stop: stopDevLoopOutput }
  }

  const state: DevLoopOutputState = { streams: new Map() }
  activeDevLoopOutput = {
    app: render(React.createElement(DevLoopOutputDashboard, { state }), {
      alternateScreen: true,
      exitOnCtrlC: false,
      maxFps: 4,
      patchConsole: false,
    }),
    state,
  }
  return { stop: stopDevLoopOutput }
}

async function stopDevLoopOutput(): Promise<void> {
  const activeOutput = activeDevLoopOutput
  activeDevLoopOutput = undefined
  if (activeOutput?.renderTimeout !== undefined) {
    clearTimeout(activeOutput.renderTimeout)
  }
  activeOutput?.app.rerender(React.createElement(DevLoopOutputDashboard, { state: activeOutput.state }))
  await activeOutput?.app.waitUntilRenderFlush()
  activeOutput?.app.unmount()
  // Any failure still recorded — from startup or a later watch-time recompile — outlives the
  // alternate screen; a stream that recovered has already cleared its record.
  if (activeOutput?.state.failure) {
    const { message, streamName } = activeOutput.state.failure
    fallbackLog(streamName, message, 'error')
  }
}

/** recordFailure keeps the terminal error available after the alternate-screen dashboard closes. */
function recordFailure(streamName: string, message: string): void {
  logDevLoop(streamName, message, 'error')
  if (activeDevLoopOutput !== undefined) {
    activeDevLoopOutput.state.failure = { message, streamName }
  }
}

/** clearFailure retires a stream's recorded failure once a later run of it succeeds. */
function clearFailure(streamName: string): void {
  if (activeDevLoopOutput?.state.failure?.streamName === streamName) {
    activeDevLoopOutput.state.failure = undefined
  }
}

function logDevLoop(streamName: string, message: string, kind: DevLoopOutputKind = 'info'): void {
  if (activeDevLoopOutput === undefined) {
    fallbackLog(streamName, message, kind)
    return
  }
  for (const line of message.split(/\r?\n/)) {
    appendDevLoopLine(streamName, line, kind)
  }
  scheduleDevLoopRender()
}

function writeDevLoopOutput(streamName: string, outputStream: 'stderr' | 'stdout', chunk: string | Buffer): void {
  if (activeDevLoopOutput === undefined) {
    HCI.write(chunk)
    return
  }

  const stream = devLoopOutputStream(streamName)
  OutputText.appendCompleteLines(stream, String(chunk), line => {
    appendDevLoopLine(streamName, line, devLoopOutputKind(outputStream, line))
  })
  scheduleDevLoopRender()
}

const errorLinePattern = /\berrors?\b|\bfailed\b|\bfailure\b|\bfatal\b|\bexception\b|^\s*[✖✘×]/i
// Case-sensitive on purpose: `EADDRINUSE` is an error and `Experimental` is not, and the two differ
// only in case once the rest of the word is allowed to be letters.
const errnoLinePattern = /\bE[A-Z]{3,}\b/
const warningLinePattern = /\bwarn(ing)?s?\b|\bdeprecat/i

/**
 * How one line of a child process's output reads in the dashboard.
 *
 * Which stream a tool chose says almost nothing about severity: Expo, Metro and bun all write
 * ordinary progress and notices to stderr, so painting every stderr line red made the dashboard's
 * one alarming colour mean little more than "this process is running" — and a real failure looked
 * exactly like `Experimental Expo Autolinking module resolver is enabled.` The line's own text is
 * what separates them. The dev loop's own failures do not come through here; `recordFailure` and
 * `logDevLoop` name their own kind.
 */
function devLoopOutputKind(outputStream: 'stderr' | 'stdout', line: string): DevLoopOutputKind {
  if (outputStream === 'stdout') {
    return 'info'
  }
  if (errorLinePattern.test(line) || errnoLinePattern.test(line)) {
    return 'error'
  }
  return warningLinePattern.test(line) ? 'warn' : 'info'
}

function devLoopOutputHandler(streamName: string): (stream: 'stderr' | 'stdout', chunk: Buffer) => void {
  return (stream, chunk) => writeDevLoopOutput(streamName, stream, chunk)
}

function printDevLoopControls(): void {
  if (activeDevLoopOutput !== undefined) {
    if (activeDevLoopOutput.state.prompt !== undefined) {
      return
    }
    scheduleDevLoopRender()
    return
  }
  HCI.writeLine(`
${DEV_LOOP_CONTROLS.map(formatDevLoopControl).join('\n')}`)
}

function formatDevLoopControl(control: DevLoopControl): string {
  return `${HCI.dim('›')} ${HCI.bold(HCI.white(`Press ${control.key}`))} ${HCI.dim('│')} ${control.label}`
}

function DevLoopOutputDashboard(props: { state: DevLoopOutputState }): React.ReactElement {
  const size = useWindowSize()
  const streams = orderedDevLoopStreams(props.state)
  const footerLines = footerOutputLines(props.state, size.columns)
  const layout = devLoopDashboardLayout(size, streams.length, footerLines.length)

  return React.createElement(
    Box,
    { flexDirection: 'column', height: DashboardGrid.availableRows(size) },
    React.createElement(DashboardGrid<DevLoopOutputStream>, {
      height: Math.max(1, DashboardGrid.availableRows(size) - footerLines.length),
      items: streams,
      layout,
      renderItem: (stream, isLast) =>
        React.createElement(DevLoopOutputColumn, {
          isLast,
          key: stream.name,
          lineLimit: layout.lineLimit,
          stream,
          width: layout.columnWidth,
        }),
      width: size.columns,
    }),
    React.createElement(DevLoopControlsFooter, { lines: footerLines, width: size.columns }),
  )
}

function DevLoopOutputColumn(props: {
  isLast: boolean
  lineLimit: number
  stream: DevLoopOutputStream
  width: number
}): React.ReactElement {
  const contentWidth = Math.max(1, props.width - DEV_LOOP_PANE_CHROME_WIDTH)
  const lines = wrapDevLoopLines(visibleDevLoopLines(props.stream), contentWidth).slice(-props.lineLimit)
  return React.createElement(
    Box,
    {
      borderColor: props.stream.name === 'dev' ? 'cyan' : 'gray',
      borderStyle: 'round',
      flexDirection: 'column',
      height: props.lineLimit + 3,
      marginRight: props.isLast ? 0 : DashboardGrid.COLUMN_GAP,
      paddingX: 1,
      width: props.width,
    },
    React.createElement(
      Text,
      { bold: true, color: props.stream.name === 'dev' ? 'cyan' : 'white', wrap: 'wrap' },
      props.stream.name,
    ),
    ...lines.map((line, index) =>
      React.createElement(
        Text,
        { color: devLoopLineColor(line.kind), key: index, wrap: 'wrap' },
        line.text,
      )
    ),
  )
}

function DevLoopControlsFooter(props: { lines: readonly string[]; width: number }): React.ReactElement {
  return React.createElement(
    Box,
    { flexDirection: 'column', height: props.lines.length, width: props.width },
    ...props.lines.map((line, index) => React.createElement(Text, { color: 'gray', key: index, wrap: 'wrap' }, line)),
  )
}

function footerOutputLines(state: DevLoopOutputState, width: number): string[] {
  const text = state.prompt
    ?? DEV_LOOP_CONTROLS.map(control => `${control.key} ${control.label}`).join(' | ')
  return OutputText.wrapLine(text, Math.max(1, width))
}

function wrapDevLoopLines(lines: readonly DevLoopOutputLine[], width: number): DevLoopOutputLine[] {
  return lines.flatMap(line => OutputText.wrapLine(line.text, width).map(text => ({ kind: line.kind, text })))
}

function devLoopDashboardLayout(
  size: TerminalSize,
  streamCount: number,
  footerRows = 1,
): ColumnLayout {
  const count = Math.max(1, streamCount)
  const paneRows = Math.max(1, DashboardGrid.availableRows(size) - footerRows)
  const preferred = fitDevLoopLayout(
    DashboardGrid.columnLayout({
      size,
      itemCount: count,
      maxColumnsPerRow: 2,
      targetColumnWidth: DEV_LOOP_TARGET_COLUMN_WIDTH,
      lineLimit: DEV_LOOP_LINE_LIMIT,
      rowGap: ROW_GAP,
    }),
    count,
    paneRows,
  )
  if (preferred.lineLimit >= 1 && DashboardGrid.layoutHeight(preferred, count) <= paneRows) {
    return preferred
  }

  for (const targetColumnWidth of DEV_LOOP_ADAPTIVE_COLUMN_WIDTHS) {
    const layout = fitDevLoopLayout(
      DashboardGrid.columnLayout({
        size,
        itemCount: count,
        maxColumnsPerRow: 2,
        targetColumnWidth,
        lineLimit: DEV_LOOP_LINE_LIMIT,
        rowGap: 0,
      }),
      count,
      paneRows,
    )
    if (layout.lineLimit >= 1 && DashboardGrid.layoutHeight(layout, count) <= paneRows) {
      return layout
    }
  }

  return fitDevLoopLayout(
    DashboardGrid.columnLayout({
      size,
      itemCount: count,
      maxColumnsPerRow: 2,
      targetColumnWidth: DEV_LOOP_ADAPTIVE_COLUMN_WIDTHS.at(-1)!,
      lineLimit: DEV_LOOP_LINE_LIMIT,
      rowGap: 0,
    }),
    count,
    paneRows,
  )
}

function fitDevLoopLayout(layout: ColumnLayout, streamCount: number, paneRows: number): ColumnLayout {
  const rowCount = Math.max(1, Math.ceil(streamCount / layout.columnsPerRow))
  const columnHeight = Math.floor(
    (paneRows - Math.max(0, rowCount - 1) * layout.rowGap) / rowCount,
  )
  return {
    ...layout,
    lineLimit: Math.min(DEV_LOOP_LINE_LIMIT, Math.max(1, columnHeight - DashboardGrid.MIN_COLUMN_HEIGHT)),
    rowGap: rowCount > 1 ? 0 : layout.rowGap,
  }
}

function orderedDevLoopStreams(state: DevLoopOutputState): DevLoopOutputStream[] {
  const streams = [...state.streams.values()]
  return streams.sort((left, right) => {
    const leftIndex = DEV_LOOP_STREAM_ORDER.indexOf(left.name as typeof DEV_LOOP_STREAM_ORDER[number])
    const rightIndex = DEV_LOOP_STREAM_ORDER.indexOf(right.name as typeof DEV_LOOP_STREAM_ORDER[number])
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? DEV_LOOP_STREAM_ORDER.length : leftIndex)
        - (rightIndex === -1 ? DEV_LOOP_STREAM_ORDER.length : rightIndex)
    }
    return left.name.localeCompare(right.name)
  })
}

function visibleDevLoopLines(stream: DevLoopOutputStream): DevLoopOutputLine[] {
  return stream.pending === ''
    ? stream.lines
    : [...stream.lines, { kind: 'info', text: stream.pending }]
}

function appendDevLoopLine(streamName: string, text: string, kind: DevLoopOutputKind): void {
  const stream = devLoopOutputStream(streamName)
  stream.lines.push({ kind, text: OutputText.stripAnsi(text) })
  if (stream.lines.length > DEV_LOOP_LINE_LIMIT) {
    stream.lines.splice(0, stream.lines.length - DEV_LOOP_LINE_LIMIT)
  }
}

function devLoopOutputStream(name: string): DevLoopOutputStream {
  const state = activeDevLoopOutput?.state
  if (state === undefined) {
    return { lines: [], name, pending: '' }
  }
  const existing = state.streams.get(name)
  if (existing !== undefined) {
    return existing
  }
  const stream: DevLoopOutputStream = { lines: [], name, pending: '' }
  state.streams.set(name, stream)
  return stream
}

function scheduleDevLoopRender(): void {
  const activeOutput = activeDevLoopOutput
  if (activeOutput === undefined || activeOutput.renderTimeout !== undefined) {
    return
  }
  if (activeOutput.state.prompt !== undefined) {
    // An open prompt owns the screen; askConfirm repaints once it resolves.
    return
  }
  activeOutput.renderTimeout = setTimeout(() => {
    activeOutput.renderTimeout = undefined
    activeOutput.app.rerender(React.createElement(DevLoopOutputDashboard, { state: activeOutput.state }))
  }, DEV_LOOP_RENDER_INTERVAL_MS)
}

function fallbackLog(streamName: string, message: string, kind: DevLoopOutputKind): void {
  return Switch<DevLoopOutputKind, void>(kind, {
    error: () => HCI.logProcessError(streamName, message),
    info: () => HCI.logProcessInfo(streamName, message),
    warn: () => HCI.logProcessWarn(streamName, message),
  })
}

function devLoopLineColor(kind: DevLoopOutputKind): 'red' | 'yellow' | undefined {
  return Switch<DevLoopOutputKind, 'red' | 'yellow' | undefined>(kind, {
    error: () => 'red',
    info: () => undefined,
    warn: () => 'yellow',
  })
}
