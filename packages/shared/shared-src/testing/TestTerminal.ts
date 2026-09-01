import { PassThrough, Writable } from 'node:stream'
import { runtimeProcess } from '../Platform'

/** FakeTerminal stands in for an interactive terminal, recording what a prompt wrote and answering it from a script. */
export type FakeTerminal = {
  /** The terminal's input side; write to it to type into the prompt under test. */
  input: PassThrough
  /** Reported to `HCI.isInteractive`, so prompts take their interactive path. */
  interactive: true
  /** The terminal's output side; everything written to it is recorded. */
  output: Writable
  /** outputText returns everything written so far, ANSI escapes included. */
  outputText: () => string
  /** rawMode reports whether the code under test currently holds the terminal in raw mode. */
  rawMode: () => boolean
}

/** CapturedOutput records what a run wrote to the process output streams, alongside the run's own result. */
export type CapturedOutput<T> = {
  result: T
  stderr: string
  stdout: string
}

/**
 * fakeTerminal creates a scripted interactive terminal. Each newline-terminated line of `inputText` answers
 * the next prompt: a chunk ending in `': '` is a question, so the next scripted line is typed in reply.
 * Spread the result into `HCI` prompt options, or drive `input` directly for keystroke-level tests. Its
 * input accepts raw mode, like a real terminal, and records it so a test can check the mode was restored.
 */
export function fakeTerminal(inputText = ''): FakeTerminal {
  const outputChunks: Buffer[] = []
  const responses = inputText.match(/[^\n]*\n/g) ?? []
  const input = new PassThrough()
  let rawMode = false
  const output = new Writable({
    write(chunk, _encoding, callback) {
      outputChunks.push(Buffer.from(chunk))
      if (chunk.toString().endsWith(': ')) {
        const response = responses.shift()
        if (response !== undefined) {
          input.write(response)
        }
      }
      callback()
    },
  })

  markTTY(input)
  markTTY(output)
  ;(input as PassThrough & { setRawMode: (value: boolean) => void }).setRawMode = value => {
    rawMode = value
  }
  return {
    input,
    interactive: true,
    output,
    outputText: () => Buffer.concat(outputChunks).toString('utf8'),
    rawMode: () => rawMode,
  }
}

/**
 * Capture replaces process-wide streams, so two overlapping captures would interleave their output and,
 * worse, the inner one would restore the outer one's sink instead of the real stream — after which every
 * later capture records nothing. Captures therefore queue: each run waits for the previous to restore.
 */
let captureQueue: Promise<unknown> = Promise.resolve()

/**
 * withCapturedOutput redirects the process output streams for one run and returns what it wrote. The
 * replacements are plain sinks rather than terminals, so code that branches on a TTY takes its non-interactive
 * path, and the original streams are restored even when the run throws. Overlapping calls are serialized
 * rather than nested, so concurrent tests capture their own output instead of each other's.
 */
export async function withCapturedOutput<T>(run: () => Promise<T> | T): Promise<CapturedOutput<T>> {
  const started = captureQueue.then(async () => await captureOnce(run), async () => await captureOnce(run))
  captureQueue = started.then(() => undefined, () => undefined)
  return await started
}

async function captureOnce<T>(run: () => Promise<T> | T): Promise<CapturedOutput<T>> {
  const originalStdout = runtimeProcess.stdout
  const originalStderr = runtimeProcess.stderr
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const stdout = captureStream(stdoutChunks)
  const stderr = captureStream(stderrChunks)
  runtimeProcess.stdout = stdout as typeof runtimeProcess.stdout
  runtimeProcess.stderr = stderr as typeof runtimeProcess.stderr

  try {
    return {
      result: await run(),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
      stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    }
  } finally {
    // Restore by identity: if something else replaced the stream mid-run, leave its replacement alone
    // rather than reinstating a stream that is no longer current.
    if (runtimeProcess.stdout === (stdout as typeof runtimeProcess.stdout)) {
      runtimeProcess.stdout = originalStdout
    }
    if (runtimeProcess.stderr === (stderr as typeof runtimeProcess.stderr)) {
      runtimeProcess.stderr = originalStderr
    }
  }
}

function captureStream(chunks: Buffer[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
}

function markTTY(stream: PassThrough | Writable): void {
  ;(stream as { isTTY?: boolean }).isTTY = true
}
