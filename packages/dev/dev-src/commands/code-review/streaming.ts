import { CLI, FS, HCI, Platform } from '@shared'
import type { ReviewEffort, Reviewer, ReviewStatus } from './types'
import { isRecord, parseJsonObject } from './utils'

export type StreamingRunOptions = {
  artifactDir: string
  args: readonly string[]
  command: string
  cwd: string
  effort: ReviewEffort
  eventsPath: string
  heartbeatMs?: number
  label: string
  lens?: string
  model?: string
  outputFormat: 'jsonl' | 'text'
  reviewer: Reviewer
  statusPath: string
  stderrPath: string
  stdin?: string
  stdoutPath: string
  timeoutSeconds?: number
}

export type StreamingRunResult = {
  durationMs: number
  exitCode: number | null
  firstOutputMs?: number
  signal: Platform.ProcessSignal | null
  status: ReviewStatus
  stderr: string
  stderrBytes: number
  stdout: string
  stdoutBytes: number
  timedOut: boolean
}

type StreamName = 'stderr' | 'stdout'

type ProgressEvent = {
  bytes?: number
  elapsedMs?: number
  event: string
  label: string
  lastOutputAgeMs?: number
  lens?: string
  model?: string
  providerEventType?: string
  providerItemType?: string
  reviewer: Reviewer
  stream?: StreamName
  ts: string
}

/** runStreamingInvocation starts a reviewer process and writes live progress artifacts. */
export async function runStreamingInvocation(options: StreamingRunOptions): Promise<StreamingRunResult> {
  await FS.mkdir(options.artifactDir)
  const stdoutFile = await FS.openAppend(options.stdoutPath)
  const stderrFile = await FS.openAppend(options.stderrPath)
  const eventsFile = await FS.openAppend(options.eventsPath)
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let pendingWrites = Promise.resolve()
  let firstWriteError: Error | undefined
  let pendingStdoutLine = ''
  let firstOutputAt: number | undefined
  let lastOutputAt: number | undefined
  let timedOut = false
  let stopped = false
  let spawnError: Error | undefined
  const startedAt = Date.now()

  const enqueue = (write: () => Promise<void>) => {
    pendingWrites = pendingWrites.then(write).catch(error => {
      firstWriteError ??= error instanceof Error ? error : new Error(String(error))
    })
  }
  const appendEvent = (event: Omit<ProgressEvent, 'label' | 'lens' | 'model' | 'reviewer' | 'ts'>) => {
    const fullEvent: ProgressEvent = {
      label: options.label,
      lens: options.lens,
      model: options.model,
      reviewer: options.reviewer,
      ts: new Date().toISOString(),
      ...event,
    }
    enqueue(async () => {
      await eventsFile.write(`${JSON.stringify(fullEvent)}\n`)
    })
  }
  const writeStatus = (status: ReviewStatus | 'running') => {
    const now = Date.now()
    enqueue(async () => {
      await FS.writeJson(options.statusPath, {
        args: options.args,
        artifactDir: options.artifactDir,
        command: CLI.formatCommand(options.command, { args: options.args }),
        elapsedMs: now - startedAt,
        effort: options.effort,
        eventsPath: options.eventsPath,
        firstOutputMs: firstOutputAt === undefined ? undefined : firstOutputAt - startedAt,
        label: options.label,
        lastOutputAgeMs: lastOutputAt === undefined ? undefined : now - lastOutputAt,
        lens: options.lens,
        model: options.model,
        reviewer: options.reviewer,
        status,
        stderrBytes,
        stderrPath: options.stderrPath,
        stdoutBytes,
        stdoutPath: options.stdoutPath,
        timedOut,
        updatedAt: new Date(now).toISOString(),
      })
    })
  }
  const recordOutput = (stream: StreamName, chunk: Buffer) => {
    const now = Date.now()
    firstOutputAt ??= now
    lastOutputAt = now
    if (stream === 'stdout') {
      stdoutChunks.push(chunk)
      stdoutBytes += chunk.byteLength
    } else {
      stderrChunks.push(chunk)
      stderrBytes += chunk.byteLength
    }
    enqueue(async () => {
      await (stream === 'stdout' ? stdoutFile : stderrFile).write(chunk)
    })
    appendEvent({ bytes: chunk.byteLength, event: `${stream}_chunk`, stream })
    if (stream === 'stdout' && options.outputFormat === 'jsonl') {
      recordProviderJsonlEvents(chunk, line => appendProviderEvent(line, appendEvent))
    }
  }
  const recordProviderJsonlEvents = (chunk: Buffer, onLine: (line: string) => void) => {
    const text = `${pendingStdoutLine}${chunk.toString('utf8')}`.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    const lines = text.split('\n')
    pendingStdoutLine = lines.pop() ?? ''
    for (const line of lines) {
      onLine(line)
    }
  }

  appendEvent({ event: 'started', elapsedMs: 0 })
  writeStatus('running')

  const child = CLI.start(options.command, {
    args: options.args,
    cwd: options.cwd,
    onOutput: recordOutput,
    stdin: options.stdin,
    stdio: 'pipe',
  })
  child.onceError(error => {
    spawnError = error
    appendEvent({ event: 'process_error' })
  })

  const heartbeatMs = options.heartbeatMs ?? 30_000
  const heartbeat = setInterval(() => {
    if (stopped) {
      return
    }
    const elapsedMs = Date.now() - startedAt
    const lastOutputAgeMs = lastOutputAt === undefined ? undefined : Date.now() - lastOutputAt
    appendEvent({ elapsedMs, event: 'heartbeat', lastOutputAgeMs })
    writeStatus('running')
    HCI.logProcessInfo(
      'review',
      `${options.label} running ${formatDuration(elapsedMs)}${
        lastOutputAgeMs === undefined ? ', no output yet' : `, last output ${formatDuration(lastOutputAgeMs)} ago`
      }`,
    )
  }, heartbeatMs)

  let killTimer: ReturnType<typeof setTimeout> | undefined
  const timeout = options.timeoutSeconds === undefined
    ? undefined
    : setTimeout(() => {
      timedOut = true
      appendEvent({ elapsedMs: Date.now() - startedAt, event: 'timeout' })
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }, options.timeoutSeconds * 1_000)

  const { exitCode, signal } = await child.waitForClose()
  stopped = true
  clearInterval(heartbeat)
  if (timeout !== undefined) {
    clearTimeout(timeout)
  }
  if (killTimer !== undefined) {
    clearTimeout(killTimer)
  }
  if (pendingStdoutLine.trim().length > 0 && options.outputFormat === 'jsonl') {
    appendProviderEvent(pendingStdoutLine, appendEvent)
  }
  const durationMs = Date.now() - startedAt
  const stdout = Buffer.concat(stdoutChunks).toString('utf8')
  const stderr = Buffer.concat(stderrChunks).toString('utf8')
  const failed = timedOut || spawnError !== undefined || exitCode !== 0
  let status: ReviewStatus = timedOut ? 'timeout' : failed ? 'failed' : stdout.trim().length === 0 ? 'empty' : 'ok'
  appendEvent({ elapsedMs: durationMs, event: status === 'ok' ? 'completed' : status })
  writeStatus(status)
  await pendingWrites
  if (firstWriteError !== undefined && status === 'ok') {
    status = 'failed'
    try {
      await FS.writeJson(options.statusPath, {
        args: options.args,
        artifactDir: options.artifactDir,
        artifactWriteError: firstWriteError.message,
        command: CLI.formatCommand(options.command, { args: options.args }),
        elapsedMs: durationMs,
        effort: options.effort,
        eventsPath: options.eventsPath,
        firstOutputMs: firstOutputAt === undefined ? undefined : firstOutputAt - startedAt,
        label: options.label,
        lastOutputAgeMs: lastOutputAt === undefined ? undefined : Date.now() - lastOutputAt,
        lens: options.lens,
        model: options.model,
        reviewer: options.reviewer,
        status,
        stderrBytes,
        stderrPath: options.stderrPath,
        stdoutBytes,
        stdoutPath: options.stdoutPath,
        timedOut,
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // The returned failed status is the source of truth when status writes also fail.
    }
  }
  await Promise.all([
    stdoutFile.close(),
    stderrFile.close(),
    eventsFile.close(),
  ])

  return {
    durationMs,
    exitCode,
    firstOutputMs: firstOutputAt === undefined ? undefined : firstOutputAt - startedAt,
    signal,
    status,
    stderr,
    stderrBytes: Buffer.byteLength(stderr, 'utf8'),
    stdout,
    stdoutBytes: Buffer.byteLength(stdout, 'utf8'),
    timedOut,
  }
}

function appendProviderEvent(
  line: string,
  appendEvent: (event: Omit<ProgressEvent, 'label' | 'lens' | 'model' | 'reviewer' | 'ts'>) => void,
): void {
  const event = parseJsonObject(line.trim())
  if (event === undefined) {
    appendEvent({ event: 'provider_json_parse_error' })
    return
  }
  const item = isRecord(event['item']) ? event['item'] : undefined
  appendEvent({
    event: 'provider_event',
    providerEventType: typeof event['type'] === 'string' ? event['type'] : undefined,
    providerItemType: typeof item?.['type'] === 'string' ? item['type'] : undefined,
  })
}

function formatDuration(ms: number): string {
  return `${(ms / 1_000).toFixed(0)}s`
}
