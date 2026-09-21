import { OutputText } from '@cli-kit'
import { Errors, FS, HCI, Platform, Switch } from '@shared'
import { type WorkEvent, WorkGraph, type WorkState, type WorkStatus } from './WorkGraph'
import { WorkTUI } from './WorkTUI'

/**
 * One reporting layer over the one scheduler. The graph emits events; a reporter decides what a
 * reader sees, and the reader decides nothing — the mode is chosen once, the same way, for every
 * lane:
 *
 * - `tui` is the live dashboard a human watching a terminal wants.
 * - `lines` is interleaved prefixed streaming, for dumb terminals and the Expo dev loop.
 * - `quiet` is the agent contract: no streamed node output at all, one timestamped line when work
 *   starts, one line when it completes, and the artifact paths that hold everything else.
 *
 * Because a harness runs commands without a TTY, `./agent verify` becomes terse on its own while
 * `just verify` in a terminal gets the dashboard, and a nested gate inherits non-TTY and stops
 * rendering dashboard frames into a log file.
 */

/** OutputMode names how a run reports itself. */
export type OutputMode = 'lines' | 'quiet' | 'tui'

/** WorkReporterHandle consumes a run's events and releases whatever it held afterwards. */
export type WorkReporterHandle = {
  finish: () => Promise<void>
  handle: (event: WorkEvent) => void
}

/** ReporterOptions describes the run a reporter is reporting. */
export type ReporterOptions = {
  lane: string
  logRoot: string
  mode: OutputMode
}

/** ResolveModeOptions carries every input that decides the output mode. */
export type ResolveModeOptions = {
  /** `TAO_OUTPUT_MODE`; read from the environment when not passed. */
  env?: string
  /** Whether stdout is a terminal; read from the process when not passed. */
  outputIsTerminal?: boolean
  /** The `--output` value, when the caller passed one. It always wins. */
  requested?: string
}

const OUTPUT_MODE_ENV = 'TAO_OUTPUT_MODE'
const OUTPUT_MODES: readonly OutputMode[] = ['lines', 'quiet', 'tui']

/** parseMode reads one output mode name, naming where an unusable value came from. */
function parseMode(value: string, source: string): OutputMode {
  if (value === 'lines' || value === 'quiet' || value === 'tui') {
    return value
  }
  Errors.throwUserInput(`Unknown output mode '${value}' from ${source}. Use ${OUTPUT_MODES.join(', ')}.`)
}

/** resolveMode picks the output mode: explicit flag, then pinned env, then whether stdout is a terminal. */
function resolveMode(options: ResolveModeOptions = {}): OutputMode {
  if (options.requested !== undefined) {
    return parseMode(options.requested, '--output')
  }
  const pinned = options.env ?? Platform.runtimeProcess.env[OUTPUT_MODE_ENV]
  if (pinned !== undefined && pinned.length > 0) {
    return parseMode(pinned, OUTPUT_MODE_ENV)
  }
  return (options.outputIsTerminal ?? HCI.isOutputTerminal()) ? 'tui' : 'quiet'
}

/**
 * colorizes decides whether a lane paints what it prints. `quiet` is the agent contract — a pipe, a
 * log file, a nested gate — so it stays plain even when it is aimed at a terminal, and every other
 * mode colors only when stdout is actually one. One rule, in the place that owns output modes, so a
 * lane cannot leave escape codes in a file by choosing its own.
 */
function colorizes(mode: OutputMode, options: { outputIsTerminal?: boolean } = {}): boolean {
  return mode !== 'quiet' && (options.outputIsTerminal ?? HCI.isOutputTerminal())
}

/** create returns the reporter for one mode. */
function create(options: ReporterOptions): WorkReporterHandle {
  return Switch<OutputMode, WorkReporterHandle>(options.mode, {
    lines: () => createLinesReporter(options),
    quiet: () => createQuietReporter(options),
    tui: () => WorkTUI.createReporter({ lane: options.lane }),
  })
}

function createLinesReporter(options: ReporterOptions): WorkReporterHandle {
  const buffers = new Map<string, { pending: string }>()
  const bufferFor = (state: WorkState) => {
    const existing = buffers.get(state.name)
    if (existing !== undefined) {
      return existing
    }
    const created = { pending: '' }
    buffers.set(state.name, created)
    return created
  }

  return {
    finish: async () => {},
    handle: event =>
      Switch.kind<WorkEvent, void>(event, {
        complete: ({ state }) => {
          OutputText.flushPendingLine(
            bufferFor(state),
            line => HCI.logProcessOutput(WorkGraph.nodeLabel(state.node), line),
          )
          HCI.logProcessInfo(WorkGraph.nodeLabel(state.node), completionText(state))
        },
        done: () => {},
        output: ({ output, state }) =>
          OutputText.appendCompleteLines(bufferFor(state), output, line => {
            if (line.length > 0) {
              HCI.logProcessOutput(WorkGraph.nodeLabel(state.node), line)
            }
          }),
        planned: ({ states }) => HCI.writeLine(headerText(options, states.length)),
        start: ({ state }) => HCI.logProcessInfo(WorkGraph.nodeLabel(state.node), 'started'),
        waiting: ({ reason, state }) => HCI.logProcessInfo(WorkGraph.nodeLabel(state.node), reason),
      }),
  }
}

function createQuietReporter(options: ReporterOptions): WorkReporterHandle {
  return {
    finish: async () => {},
    handle: event =>
      Switch.kind<WorkEvent, void>(event, {
        complete: ({ state }) => HCI.writeLine(`${state.name}: ${completionText(state)}${logSuffix(state)}`),
        done: () => {},
        output: () => {},
        planned: ({ states }) => HCI.writeLine(headerText(options, states.length)),
        start: ({ state }) => HCI.writeLine(`${state.name}: started at ${startTime(state)}`),
        waiting: () => {},
      }),
  }
}

/** startTime renders the local wall clock so a reader can tell how long a still-running node has waited. */
function startTime(state: WorkState): string {
  const startedAt = new Date(state.startedAt ?? Date.now())
  return [startedAt.getHours(), startedAt.getMinutes(), startedAt.getSeconds()]
    .map(part => String(part).padStart(2, '0'))
    .join(':')
}

/** headerText names the lane, its size, and where its logs land, before any node reports. */
function headerText(options: ReporterOptions, nodeCount: number): string {
  return `${options.lane}: running ${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`
    + ` — logs: ${FS.displayPath(options.logRoot)}`
}

/** completionText renders how one node ended, in the shape every mode uses. */
function completionText(state: WorkState): string {
  const reason = state.reason === undefined ? '' : ` — ${state.reason}`
  return Switch<WorkStatus, string>(state.status, {
    failed: () => `failed in ${OutputText.formatElapsed(state.elapsedMs)}${reason}`,
    passed: () => `passed in ${OutputText.formatElapsed(state.elapsedMs)}`,
    pending: () => `pending${reason}`,
    running: () => `running${reason}`,
    skipped: () => `skipped${reason}`,
  })
}

function logSuffix(state: WorkState): string {
  if (state.status === 'skipped' || state.logPath === undefined) {
    return ''
  }
  return ` — log: ${FS.displayPath(state.logPath)}`
}

/** WorkReporter owns output-mode selection and the reporters every lane shares. */
export const WorkReporter = {
  colorizes,
  create,
  resolveMode,
} as const
