import { OutputText } from '@cli-kit/OutputText'
import { Errors, FS, HCI, Platform, Switch } from '@shared'

/** TestOutputMode names how `tao test` reports the test runner process's own output. */
export type TestOutputMode = 'lines' | 'quiet'

/** TestOutputWriter forwards the test runner's output while it arrives, one whole line at a time. */
type TestOutputWriter = {
  /** flush writes a trailing line the runner left without a newline. */
  flush: () => void
  /** write forwards one output chunk from the test runner process. */
  write: (chunk: Buffer) => void
}

/** FinishedTestRun declares one finished test runner process for the end-of-run report. */
type FinishedTestRun = {
  failed: boolean
  logPath?: string
  mode: TestOutputMode
  output: string
}

/**
 * MODES lists the mode names `tao test --output` accepts, in help order. `tui` is accepted so one
 * harness can select a mode for every Tao command at once; this command renders no dashboard, so it
 * streams the lines a dashboard would capture.
 */
const MODES = ['lines', 'quiet', 'tui'] as const

/** OUTPUT_MODE_ENV pins the mode for a harness that chose one for a whole lane. */
const OUTPUT_MODE_ENV = 'TAO_OUTPUT_MODE'

/** FAILURE_TAIL_LINE_LIMIT bounds how much of a failing run quiet mode prints before its log path. */
const FAILURE_TAIL_LINE_LIMIT = 40

/** LOG_FILE_NAME names the full test-output log written inside a run's generated root. */
const LOG_FILE_NAME = 'test-output.log'

/**
 * SUMMARY_LINE matches the test runner's result summary block. Those lines are printed in every
 * mode: the repository test runner counts Tao behavior tests by scraping the `Tests:` line out of
 * this command's output (`parseJestTestSummary` in packages/dev), so a quiet run must still carry
 * it.
 */
const SUMMARY_LINE = /^(?:Test Suites|Tests|Snapshots|Time|Ran all test suites)\b/

/** TestOutput owns `tao test` output-mode selection and the runner's reported output. */
export const TestOutput = {
  FAILURE_TAIL_LINE_LIMIT,
  LOG_FILE_NAME,
  MODES,
  createWriter,
  reportFinishedRun,
  resolveMode,
} as const

/**
 * resolveMode picks the mode for one run: an explicit `--output` value wins, then the mode a
 * harness pinned for its whole lane, and otherwise a terminal streams the runner's lines while a
 * pipe — an outer test runner or an agent harness — gets the quiet report.
 */
function resolveMode(requested: string | undefined): TestOutputMode {
  if (requested !== undefined) {
    return parseMode(requested, '--output')
  }
  const pinned = Platform.runtimeProcess.env[OUTPUT_MODE_ENV]
  if (pinned !== undefined && pinned.length > 0) {
    return parseMode(pinned, OUTPUT_MODE_ENV)
  }
  return HCI.isOutputTerminal() ? 'lines' : 'quiet'
}

/**
 * createWriter returns the streamer for one mode, or nothing when the mode streams no output.
 * `lines` forwards whole lines as the runner produces them so a terminal shows progress instead of
 * one dump at the end; `quiet` leaves the run's output to the log file and the finished-run report.
 */
function createWriter(mode: TestOutputMode): TestOutputWriter | undefined {
  return Switch<TestOutputMode, TestOutputWriter | undefined>(mode, {
    lines: () => createLineWriter(),
    quiet: () => undefined,
  })
}

/**
 * reportFinishedRun prints what the selected mode still owes the reader once the runner exits: the
 * result summary whenever the reader has not already seen it, the end of a failing run's output,
 * and the log holding all of it.
 */
function reportFinishedRun(run: FinishedTestRun): void {
  const shown = Switch<TestOutputMode, string>(run.mode, {
    lines: () => run.output,
    quiet: () => run.failed ? printFailureTail(run.output) : '',
  })
  if (!hasResultCountLine(shown)) {
    for (const line of summaryLines(run.output)) {
      HCI.writeLine(line)
    }
  }
  if (run.failed && run.logPath !== undefined) {
    HCI.writeErrorLine(`log: ${FS.displayPath(run.logPath)}`)
  }
}

/**
 * createLineWriter buffers chunks into whole lines before writing them. The runner reports through
 * stderr, and its report is this command's result rather than a diagnostic, so both of its streams
 * reach the reader on stdout the way the buffered dump this replaced always did.
 */
function createLineWriter(): TestOutputWriter {
  let pending = ''
  return {
    flush() {
      if (pending.length === 0) {
        return
      }
      const line = pending
      pending = ''
      HCI.writeLine(line)
    },
    write(chunk) {
      // Buffers only newline shape, not `OutputText.sanitize`: this streams the runner's own lines
      // to a real terminal, and stripping ANSI here would drop its color along the way.
      const lines = normalizeCarriageReturns(`${pending}${chunk.toString('utf8')}`).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        HCI.writeLine(line)
      }
    },
  }
}

/** printFailureTail prints the end of a failing run's output and returns what it printed. */
function printFailureTail(output: string): string {
  const lines = outputLines(output)
  if (lines.length === 0) {
    return ''
  }
  const visible = lines.slice(-FAILURE_TAIL_LINE_LIMIT)
  const omitted = lines.length - visible.length
  if (omitted > 0) {
    HCI.writeErrorLine(`... ${omitted} earlier output line${omitted === 1 ? '' : 's'} omitted ...`)
  }
  for (const line of visible) {
    HCI.writeErrorLine(line)
  }
  return visible.join('\n')
}

function summaryLines(output: string): string[] {
  return outputLines(output).filter(line => SUMMARY_LINE.test(line.trim()))
}

function hasResultCountLine(text: string): boolean {
  return text.split('\n').some(line => line.trim().startsWith('Tests:'))
}

function outputLines(output: string): string[] {
  return normalizeCarriageReturns(OutputText.stripAnsi(output)).split('\n').filter(line => line.trim().length > 0)
}

/**
 * normalizeCarriageReturns folds a lone `\r` into a line break, unlike `OutputText.sanitize`, which
 * deletes it instead and glues a `\r`-overwritten progress line onto the text that follows it —
 * breaking the `^`-anchored `SUMMARY_LINE` match below. `createLineWriter` also relies on this
 * rather than `OutputText.sanitize` to keep the runner's own ANSI colors on a real terminal.
 */
function normalizeCarriageReturns(output: string): string {
  return output.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

/** parseMode reads one output mode name, naming where an unusable value came from. */
function parseMode(value: string, source: string): TestOutputMode {
  if (value === 'quiet') {
    return 'quiet'
  }
  if (value === 'lines' || value === 'tui') {
    return 'lines'
  }
  Errors.throwUserInput(`Unknown output mode '${value}' from ${source}. Use ${MODES.join(', ')}.`)
}
