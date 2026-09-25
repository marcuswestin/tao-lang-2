import { HCI, Switch } from '@shared'

type DevLoopControlKey = 'a' | 'c' | 'd' | 'e' | 'f' | 'i' | 'p' | 'q' | 'r' | 's' | 't' | 'v' | 'w' | 'x'

export type DevLoopControl = {
  /** checkoutOnly marks a control that works only when the loop runs from a Tao source checkout. */
  checkoutOnly?: true
  key: DevLoopControlKey
  label: string
}

export type DevLoopOutputKind = 'error' | 'info' | 'warn'

export type DevLoopReporterHandle = {
  stop: () => Promise<void>
}

type ConfirmPromptOptions = Parameters<typeof HCI.askConfirm>[0]

/**
 * DevLoopReporter is the output sink dev-loop commands report lines, failures, and confirmation
 * prompts through. It is plain TypeScript with no React or Ink dependency: the CLI that renders
 * owns the implementation — an interactive dashboard or a plain line writer — and injects it into
 * `runDevLoop`; the dev loop itself only ever calls through this interface.
 */
export type DevLoopReporter = {
  askConfirm(options: ConfirmPromptOptions): Promise<boolean>
  clearFailure(streamName: string): void
  devLoopOutputHandler(streamName: string): (stream: 'stderr' | 'stdout', chunk: Buffer) => void
  logDevLoop(streamName: string, message: string, kind?: DevLoopOutputKind): void
  printDevLoopControls(): void
  recordFailure(streamName: string, message: string): void
  /** start mounts the reporter's interactive session, if it has one, returning a handle to stop it. */
  start(): DevLoopReporterHandle | undefined
  writeDevLoopOutput(streamName: string, outputStream: 'stderr' | 'stdout', chunk: string | Buffer): void
}

export const DEV_LOOP_CONTROLS: DevLoopControl[] = [
  { key: 'q', label: 'quit' },
  { key: 'd', label: 'open Tao desktop app' },
  { key: 'p', label: 'open connected physical device' },
  { key: 'x', label: 'restart dev process' },
  { key: 'r', label: 'reload app' },
  { key: 'w', label: 'open web' },
  { key: 'i', label: 'open iOS simulator' },
  { key: 'a', label: 'open Android' },
  { key: 's', label: 'switch app' },
  { key: 'c', label: 'clean Tao checkout, install deps, and reload (source checkout)', checkoutOnly: true },
  { key: 'f', label: 'fix Tao checkout (source checkout)', checkoutOnly: true },
  { key: 't', label: 'test Tao checkout (source checkout)', checkoutOnly: true },
  { key: 'v', label: 'verify Tao checkout (source checkout)', checkoutOnly: true },
  { key: 'e', label: 'install IDE extension (source checkout)', checkoutOnly: true },
]

let checkoutControlsShown = true

/**
 * visibleDevLoopControls is the key list a reporter shows. The checkout's own controls appear only
 * while the loop runs from a Tao source checkout, because anywhere else, an installed Tao included,
 * pressing one only says it needs a checkout.
 */
export function visibleDevLoopControls(): DevLoopControl[] {
  return DEV_LOOP_CONTROLS.filter(control => checkoutControlsShown || control.checkoutOnly !== true)
}

const errorLinePattern = /\berrors?\b|\bfailed\b|\bfailure\b|\bfatal\b|\bexception\b|^\s*[✖✘×]/i
// Case-sensitive on purpose: `EADDRINUSE` is an error and `Experimental` is not, and the two differ
// only in case once the rest of the word is allowed to be letters.
const errnoLinePattern = /\bE[A-Z]{3,}\b/
const warningLinePattern = /\bwarn(ing)?s?\b|\bdeprecat/i

/**
 * How one line of a child process's output reads to a reporter.
 *
 * Which stream a tool chose says almost nothing about severity: Expo, Metro and bun all write
 * ordinary progress and notices to stderr, so painting every stderr line as an error made a real
 * failure look exactly like `Experimental Expo Autolinking module resolver is enabled.` The line's
 * own text is what separates them. The dev loop's own failures do not come through here;
 * `recordFailure` and `logDevLoop` name their own kind.
 */
export function devLoopOutputKind(outputStream: 'stderr' | 'stdout', line: string): DevLoopOutputKind {
  if (outputStream === 'stdout') {
    return 'info'
  }
  if (errorLinePattern.test(line) || errnoLinePattern.test(line)) {
    return 'error'
  }
  return warningLinePattern.test(line) ? 'warn' : 'info'
}

/** fallbackDevLoopLog writes one prefixed process line with plain HCI formatting. */
export function fallbackDevLoopLog(streamName: string, message: string, kind: DevLoopOutputKind): void {
  return Switch<DevLoopOutputKind, void>(kind, {
    error: () => HCI.logProcessError(streamName, message),
    info: () => HCI.logProcessInfo(streamName, message),
    warn: () => HCI.logProcessWarn(streamName, message),
  })
}

function formatDevLoopControl(control: DevLoopControl): string {
  return `${HCI.dim('›')} ${HCI.bold(HCI.white(`Press ${control.key}`))} ${HCI.dim('│')} ${control.label}`
}

/**
 * lineDevLoopReporter writes plain lines with HCI: no dashboard, no buffering, no state. It is the
 * default reporter for `runDevLoop` and matches how the dev loop always behaved without a TTY.
 */
export function lineDevLoopReporter(): DevLoopReporter {
  return {
    askConfirm: options => HCI.askConfirm(options),
    clearFailure: () => {},
    devLoopOutputHandler: streamName => (stream, chunk) => writeDevLoopOutput(streamName, stream, chunk),
    logDevLoop: (streamName, message, kind = 'info') => {
      for (const line of message.split(/\r?\n/)) {
        fallbackDevLoopLog(streamName, line, kind)
      }
    },
    printDevLoopControls: () => {
      HCI.writeLine(`\n${visibleDevLoopControls().map(formatDevLoopControl).join('\n')}`)
    },
    recordFailure: (streamName, message) => fallbackDevLoopLog(streamName, message, 'error'),
    start: () => undefined,
    writeDevLoopOutput,
  }

  function writeDevLoopOutput(_streamName: string, _outputStream: 'stderr' | 'stdout', chunk: string | Buffer): void {
    HCI.write(chunk)
  }
}

let activeReporter: DevLoopReporter = lineDevLoopReporter()

/**
 * setDevLoopReporter installs the reporter every dev-loop module reports through, returning a
 * restorer. `runDevLoop` calls this once with whichever reporter its caller injected — `tao dev`
 * passes the Ink dashboard; a caller that injects none keeps the plain line-writer default.
 */
export function setDevLoopReporter(reporter: DevLoopReporter): () => void {
  const previous = activeReporter
  activeReporter = reporter
  return () => {
    activeReporter = previous
  }
}

/** DevLoopOutput is the dev loop's output-sink facade: every dev-loop module reports lines,
 * failures, and prompts through it, and it forwards to whichever reporter is currently active. */
export const DevLoopOutput = {
  askConfirm: (options: ConfirmPromptOptions) => activeReporter.askConfirm(options),
  clearFailure: (streamName: string) => activeReporter.clearFailure(streamName),
  devLoopOutputHandler: (streamName: string) => activeReporter.devLoopOutputHandler(streamName),
  logDevLoop: (streamName: string, message: string, kind?: DevLoopOutputKind) =>
    activeReporter.logDevLoop(streamName, message, kind),
  printDevLoopControls: () => activeReporter.printDevLoopControls(),
  recordFailure: (streamName: string, message: string) => activeReporter.recordFailure(streamName, message),
  /** showCheckoutControls says whether this loop runs from a Tao source checkout, for the key list. */
  showCheckoutControls: (shown: boolean) => {
    checkoutControlsShown = shown
  },
  start: () => activeReporter.start(),
  writeDevLoopOutput: (streamName: string, outputStream: 'stderr' | 'stdout', chunk: string | Buffer) =>
    activeReporter.writeDevLoopOutput(streamName, outputStream, chunk),
}
