import { type TaoStudioDeviceLogEntry, TaoStudioDeviceProtocol } from './TR-studio-device-protocol'

/**
 * Console output from a phone, on its way to Studio.
 *
 * Watching a device meant watching Metro's terminal, which is the one place a person driving Studio
 * is not looking — and with a cable pulled or Metro on another machine, not available at all. This
 * mirrors the phone's console to Studio instead of moving it: the lines still print on the device,
 * so nothing is lost if the connection is down.
 *
 * Batched on a short timer because a render loop can produce thousands of lines a second, and each
 * one would otherwise be a sealed frame of its own.
 */

/** The timer pair this module needs, injected so a test drives the batch window rather than waiting. */
export type StudioDeviceLogTimers = {
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, delayMs: number): unknown
}

export type StudioDeviceLogSink = (entries: readonly TaoStudioDeviceLogEntry[]) => void

export type StudioDeviceLogConsole = {
  debug?: (...args: unknown[]) => void
  error?: (...args: unknown[]) => void
  info?: (...args: unknown[]) => void
  log?: (...args: unknown[]) => void
  warn?: (...args: unknown[]) => void
}

/**
 * How many lines one batch may carry, taken from the protocol rather than restated.
 *
 * The two used to be separate literals that happened to agree, and the drop notice pushed the batch
 * one entry past the limit — so the runaway-loop case the cap exists for was the exact case whose
 * batch the gateway then rejected whole.
 */
const maxBatch = TaoStudioDeviceProtocol.logBatchLimit
const flushDelayMs = 250

/**
 * Mirrors console output to `sink` until the returned function restores the original methods.
 *
 * The original is always called first. A device whose logs cannot reach Studio is still a device
 * whose logs a person can read over a cable, and losing that to a transport problem would be a poor
 * trade for a convenience.
 */
export function captureStudioDeviceLogs(input: {
  console: StudioDeviceLogConsole
  now?: () => number
  sink: StudioDeviceLogSink
  timers?: StudioDeviceLogTimers
}): () => void {
  const now = input.now ?? (() => Date.now())
  const timers: StudioDeviceLogTimers = input.timers ?? {
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  }
  const buffered: TaoStudioDeviceLogEntry[] = []
  let timer: unknown
  let dropped = 0

  const flush = (): void => {
    timer = undefined
    if (buffered.length === 0) {
      return
    }
    // The notice has to fit inside the batch, not extend it: one entry over the limit and the
    // gateway refuses every line in it.
    const entries = buffered.splice(0, dropped > 0 ? maxBatch - 1 : maxBatch)
    if (dropped > 0) {
      entries.push({ level: 'warn', message: `[${dropped} device log lines dropped]`, timestamp: now() })
      dropped = 0
    }
    input.sink(entries)
    if (buffered.length > 0 && timer === undefined) {
      timer = timers.setTimeout(flush, flushDelayMs)
    }
  }

  const record = (level: TaoStudioDeviceLogEntry['level'], args: readonly unknown[]): void => {
    if (buffered.length >= maxBatch) {
      dropped++
      return
    }
    buffered.push({ level, message: args.map(formatLogArgument).join(' '), timestamp: now() })
    if (timer === undefined) {
      timer = timers.setTimeout(flush, flushDelayMs)
    }
  }

  const levels = [
    ['debug', 'debug'],
    ['error', 'error'],
    ['info', 'info'],
    ['log', 'info'],
    ['warn', 'warn'],
  ] as const
  const originals = levels.map(([method]) => [method, input.console[method]] as const)
  for (const [method, level] of levels) {
    const original = input.console[method]
    input.console[method] = (...args: unknown[]) => {
      original?.(...args)
      record(level, args)
    }
  }

  return () => {
    for (const [method, original] of originals) {
      input.console[method] = original
    }
    if (timer !== undefined) {
      timers.clearTimeout(timer)
      timer = undefined
    }
    buffered.length = 0
    dropped = 0
  }
}

/**
 * Renders one console argument as a line of text.
 *
 * An Error becomes its message rather than `{}`, which is what `JSON.stringify` makes of one and the
 * single most common thing to want to read. Anything that cannot be serialized still says what it
 * was rather than throwing inside a logger.
 */
export function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (value === undefined) {
    return 'undefined'
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}
