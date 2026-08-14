import { HCI, Platform, Switch } from '@shared'
import { Box, render, Text, useWindowSize } from 'ink'
import React from 'react'

import { type ColumnLayout, DashboardGrid, type TerminalSize } from './DashboardGrid'
import { OutputText } from './OutputText'

type DevLoopControlKey = 'a' | 'c' | 'd' | 'e' | 'f' | 'i' | 'q' | 'r' | 's' | 't' | 'v' | 'w'

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
  prompt?: string
  streams: Map<string, DevLoopOutputStream>
}

type DevLoopOutputHandle = {
  stop: () => Promise<void>
}

const DEV_LOOP_LINE_LIMIT = 120
const DEV_LOOP_MIN_COLUMN_WIDTH = 28
const DEV_LOOP_RENDER_INTERVAL_MS = 250
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
  { key: 'd', label: 'reload dev process' },
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
  devLoopOutputHandler,
  logDevLoop,
  printDevLoopControls,
  startDevLoopOutput,
  stopDevLoopOutput,
  writeDevLoopOutput,
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
    appendDevLoopLine(streamName, line, outputStream === 'stderr' ? 'error' : 'info')
  })
  scheduleDevLoopRender()
}

function devLoopOutputHandler(streamName: string): (stream: 'stderr' | 'stdout', chunk: Buffer) => void {
  return (stream, chunk) => writeDevLoopOutput(streamName, stream, chunk)
}

function printDevLoopControls(): void {
  if (activeDevLoopOutput !== undefined) {
    activeDevLoopOutput.state.prompt = undefined
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
  const layout = devLoopDashboardLayout(size, streams.length)

  return React.createElement(
    Box,
    { flexDirection: 'column', height: DashboardGrid.availableRows(size), overflow: 'hidden' },
    React.createElement(DashboardGrid<DevLoopOutputStream>, {
      height: DashboardGrid.availableRows(size) - 1,
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
    React.createElement(DevLoopControlsFooter, { state: props.state, width: size.columns }),
  )
}

function DevLoopOutputColumn(props: {
  isLast: boolean
  lineLimit: number
  stream: DevLoopOutputStream
  width: number
}): React.ReactElement {
  const lines = visibleDevLoopLines(props.stream).slice(-props.lineLimit)
  return React.createElement(
    Box,
    {
      borderColor: props.stream.name === 'dev' ? 'cyan' : 'gray',
      borderStyle: 'round',
      flexDirection: 'column',
      height: props.lineLimit + 3,
      marginRight: props.isLast ? 0 : DashboardGrid.COLUMN_GAP,
      overflow: 'hidden',
      paddingX: 1,
      width: props.width,
    },
    React.createElement(Text, { bold: true, color: props.stream.name === 'dev' ? 'cyan' : 'white' }, props.stream.name),
    ...lines.map((line, index) =>
      React.createElement(
        Text,
        { color: devLoopLineColor(line.kind), key: index, wrap: 'truncate-end' },
        line.text,
      )
    ),
  )
}

function DevLoopControlsFooter(props: { state: DevLoopOutputState; width: number }): React.ReactElement {
  const text = props.state.prompt
    ?? DEV_LOOP_CONTROLS.map(control => `${control.key} ${control.label}`).join(' | ')
  return React.createElement(
    Box,
    { height: 1, overflow: 'hidden', width: props.width },
    React.createElement(Text, { color: 'gray', wrap: 'truncate-end' }, text),
  )
}

function devLoopDashboardLayout(size: TerminalSize, streamCount: number): ColumnLayout {
  const count = Math.max(1, streamCount)
  const layout = DashboardGrid.columnLayout({
    size,
    itemCount: count,
    targetColumnWidth: DEV_LOOP_MIN_COLUMN_WIDTH,
    lineLimit: DEV_LOOP_LINE_LIMIT,
    rowGap: ROW_GAP,
  })
  const rowCount = Math.ceil(count / layout.columnsPerRow)
  const availableHeight = Math.max(1, DashboardGrid.availableRows(size) - 1)
  const columnHeight = Math.floor((availableHeight - Math.max(0, rowCount - 1) * ROW_GAP) / Math.max(1, rowCount))
  return {
    ...layout,
    lineLimit: Math.min(DEV_LOOP_LINE_LIMIT, Math.max(1, columnHeight - DashboardGrid.MIN_COLUMN_HEIGHT)),
    rowGap: rowCount > 1 ? 0 : ROW_GAP,
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
