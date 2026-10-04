import { type ColumnLayout, DashboardGrid, OutputText, type TerminalSize } from '@cli-kit'
import {
  type DevLoopControl,
  type DevLoopOutputKind,
  devLoopOutputKind,
  type DevLoopReporter,
  type DevLoopReporterHandle,
  fallbackDevLoopLog,
  visibleDevLoopControls,
} from '@expo-host/dev-loop/DevLoopOutput'
import { HCI, Platform, Switch } from '@shared'
import { Box, render, Text, useWindowSize } from 'ink'
import React from 'react'

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

type ConfirmPromptOptions = Parameters<typeof HCI.askConfirm>[0]

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

/**
 * createInkDevLoopReporter builds the interactive `tao run` dashboard: an Ink `DevLoopReporter`
 * that mounts an alternate-screen dashboard when stdout is a TTY, and otherwise falls back to
 * plain HCI lines — the same behavior the dev loop always had. `tao run` is the only caller: the
 * dev loop itself takes a `DevLoopReporter` and knows nothing about React or Ink.
 */
export function createInkDevLoopReporter(): DevLoopReporter {
  let activeOutput: {
    app: ReturnType<typeof render>
    renderTimeout?: ReturnType<typeof setTimeout>
    state: DevLoopOutputState
  } | undefined

  return {
    askConfirm,
    clearFailure,
    devLoopOutputHandler,
    logDevLoop,
    printDevLoopControls,
    recordFailure,
    start,
    writeDevLoopOutput,
  }

  /** askConfirm keeps confirmations visible in the dashboard footer while readline owns input. */
  async function askConfirm(options: ConfirmPromptOptions): Promise<boolean> {
    const output = activeOutput
    if (output === undefined) {
      return await HCI.askConfirm(options)
    }

    // Readline owns the terminal while the prompt is open. Any repaint scheduled before or during it
    // would erase the question and whatever the user has typed, so drop the pending one and hold the rest.
    if (output.renderTimeout !== undefined) {
      clearTimeout(output.renderTimeout)
      output.renderTimeout = undefined
    }
    output.state.prompt = formatConfirmPrompt(options)
    output.app.rerender(React.createElement(DevLoopOutputDashboard, { state: output.state }))
    await output.app.waitUntilRenderFlush()
    try {
      return await HCI.askConfirm(options)
    } finally {
      if (activeOutput === output) {
        output.state.prompt = undefined
        scheduleDevLoopRender()
      }
    }
  }

  function start(): DevLoopReporterHandle | undefined {
    if (!Platform.runtimeProcess.stdout.isTTY) {
      return undefined
    }
    if (activeOutput !== undefined) {
      return { stop }
    }

    const state: DevLoopOutputState = { streams: new Map() }
    activeOutput = {
      // Rendering through `Platform.runtimeProcess.stdout` — the same stream `start` just checked
      // for a TTY — rather than Ink's own default output stream keeps the dashboard testable: a
      // test swaps that one stream and Ink follows it.
      app: render(React.createElement(DevLoopOutputDashboard, { state }), {
        alternateScreen: true,
        exitOnCtrlC: false,
        maxFps: 4,
        patchConsole: false,
        stdout: Platform.runtimeProcess.stdout,
      }),
      state,
    }
    return { stop }
  }

  async function stop(): Promise<void> {
    const output = activeOutput
    activeOutput = undefined
    if (output?.renderTimeout !== undefined) {
      clearTimeout(output.renderTimeout)
    }
    output?.app.rerender(React.createElement(DevLoopOutputDashboard, { state: output.state }))
    await output?.app.waitUntilRenderFlush()
    output?.app.unmount()
    // Any failure still recorded — from startup or a later watch-time recompile — outlives the
    // alternate screen; a stream that recovered has already cleared its record.
    if (output?.state.failure) {
      const { message, streamName } = output.state.failure
      fallbackDevLoopLog(streamName, message, 'error')
    }
  }

  /** recordFailure keeps the terminal error available after the alternate-screen dashboard closes. */
  function recordFailure(streamName: string, message: string): void {
    logDevLoop(streamName, message, 'error')
    if (activeOutput !== undefined) {
      activeOutput.state.failure = { message, streamName }
    }
  }

  /** clearFailure retires a stream's recorded failure once a later run of it succeeds. */
  function clearFailure(streamName: string): void {
    if (activeOutput?.state.failure?.streamName === streamName) {
      activeOutput.state.failure = undefined
    }
  }

  function logDevLoop(streamName: string, message: string, kind: DevLoopOutputKind = 'info'): void {
    if (activeOutput === undefined) {
      fallbackDevLoopLog(streamName, message, kind)
      return
    }
    for (const line of message.split(/\r?\n/)) {
      appendDevLoopLine(streamName, line, kind)
    }
    scheduleDevLoopRender()
  }

  function writeDevLoopOutput(streamName: string, outputStream: 'stderr' | 'stdout', chunk: string | Buffer): void {
    if (activeOutput === undefined) {
      HCI.write(chunk)
      return
    }

    const stream = devLoopOutputStream(streamName)
    OutputText.appendCompleteLines(stream, String(chunk), line => {
      appendDevLoopLine(streamName, line, devLoopOutputKind(outputStream, line))
    })
    scheduleDevLoopRender()
  }

  function devLoopOutputHandler(streamName: string): (stream: 'stderr' | 'stdout', chunk: Buffer) => void {
    return (stream, chunk) => writeDevLoopOutput(streamName, stream, chunk)
  }

  function printDevLoopControls(): void {
    if (activeOutput !== undefined) {
      if (activeOutput.state.prompt !== undefined) {
        return
      }
      scheduleDevLoopRender()
      return
    }
    HCI.writeLine(`
${visibleDevLoopControls().map(formatDevLoopControl).join('\n')}`)
  }

  function appendDevLoopLine(streamName: string, text: string, kind: DevLoopOutputKind): void {
    const stream = devLoopOutputStream(streamName)
    stream.lines.push({ kind, text: OutputText.stripAnsi(text) })
    if (stream.lines.length > DEV_LOOP_LINE_LIMIT) {
      stream.lines.splice(0, stream.lines.length - DEV_LOOP_LINE_LIMIT)
    }
  }

  function devLoopOutputStream(name: string): DevLoopOutputStream {
    const state = activeOutput?.state
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
    const output = activeOutput
    if (output === undefined || output.renderTimeout !== undefined) {
      return
    }
    if (output.state.prompt !== undefined) {
      // An open prompt owns the screen; askConfirm repaints once it resolves.
      return
    }
    output.renderTimeout = setTimeout(() => {
      output.renderTimeout = undefined
      output.app.rerender(React.createElement(DevLoopOutputDashboard, { state: output.state }))
    }, DEV_LOOP_RENDER_INTERVAL_MS)
  }
}

function formatConfirmPrompt(options: ConfirmPromptOptions): string {
  return `${options.message}${HCI.confirmChoiceSuffix(options.defaultValue)}`
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
    ?? visibleDevLoopControls().map(control => `${control.key} ${control.label}`).join(' | ')
  return OutputText.wrapLine(text, Math.max(1, width))
}

function wrapDevLoopLines(lines: readonly DevLoopOutputLine[], width: number): DevLoopOutputLine[] {
  return lines.flatMap(line => OutputText.wrapLine(line.text, width).map(text => ({ kind: line.kind, text })))
}

/** devLoopDashboardLayout is exported so its test file can check it without mounting the dashboard. */
export function devLoopDashboardLayout(
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

function devLoopLineColor(kind: DevLoopOutputKind): 'red' | 'yellow' | undefined {
  return Switch<DevLoopOutputKind, 'red' | 'yellow' | undefined>(kind, {
    error: () => 'red',
    info: () => undefined,
    warn: () => 'yellow',
  })
}
