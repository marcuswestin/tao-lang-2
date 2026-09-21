import { FS, HCI, Time } from '@shared'

/**
 * One vocabulary for everything a Studio launch does, so a question like "which process owned
 * that port, and why did it stop?" is answered by reading records rather than by correlating
 * prose across three components. The terminal keeps only the lines a person watches a launch
 * for; the full sequence goes to the launch's own artifact root.
 */

/** The lifecycle events every Studio launch reports, in the order they normally occur. */
type StudioLifecycleEvent =
  | 'launch-requested'
  | 'process-started'
  | 'port-allocated'
  | 'server-ready'
  | 'session-created'
  | 'watcher-ready'
  | 'compile-started'
  | 'compile-completed'
  | 'compile-failed'
  | 'preview-published'
  | 'client-reload-started'
  | 'client-reload-completed'
  | 'client-reload-failed'
  | 'shutdown-requested'
  | 'signal-escalated'
  | 'process-exited'
  | 'manifest-finalized'
  | 'orphan-detected'

/** The parts of a launch a record can be attributed to. */
type StudioComponent =
  | 'browser-smoke'
  | 'device-gateway'
  | 'metro'
  | 'native-shell'
  | 'preview'
  | 'studio-server'
  | 'watcher'

/** StudioLifecycleRecord is one structured line; every field beyond the first three is optional. */
export type StudioLifecycleRecord = {
  compileRevision?: number
  component: StudioComponent
  elapsedMs?: number
  event: StudioLifecycleEvent
  launchId: string
  message?: string
  pid?: number
  port?: number
  previewRevision?: number
  processGroup?: number
  sessionId?: string
  shutdownReason?: string
  timestamp: string
}

/** Events worth one concise terminal line; everything else is written only to the log file. */
const ANNOUNCED_EVENTS: ReadonlySet<StudioLifecycleEvent> = new Set([
  'compile-failed',
  'client-reload-failed',
  'orphan-detected',
  'server-ready',
  'shutdown-requested',
  'signal-escalated',
])

export type StudioLifecycleLog = {
  close: () => Promise<void>
  /** The path records are appended to, for the readiness payload and the manifest. */
  path: string
  record: (record: Omit<StudioLifecycleRecord, 'launchId' | 'timestamp'>) => void
  /** Times one span and records its completion event with the elapsed milliseconds. */
  span: <ValueT>(
    start: Omit<StudioLifecycleRecord, 'launchId' | 'timestamp'>,
    finish: (result: 'failed' | 'ok') => Omit<StudioLifecycleRecord, 'elapsedMs' | 'launchId' | 'timestamp'>,
    work: () => Promise<ValueT>,
  ) => Promise<ValueT>
}

export type CreateStudioLifecycleLogOptions = {
  artifactRoot: string
  announce?: (line: string) => void
  launchId: string
  now?: () => number
  timestamp?: () => string
}

/**
 * createStudioLifecycleLog buffers records and appends them in order. Writing never blocks the
 * launch and never throws into it: a launch that cannot write its log is still a working launch.
 */
export function createStudioLifecycleLog(options: CreateStudioLifecycleLogOptions): StudioLifecycleLog {
  const path = FS.resolvePath('logs/lifecycle.jsonl', options.artifactRoot)
  const announce = options.announce ?? (line => HCI.logProcessInfo('studio', line))
  const now = options.now ?? (() => Time.nowMs())
  const timestamp = options.timestamp ?? (() => new Date().toISOString())
  let pending: Promise<void> = Promise.resolve()

  const write = (record: StudioLifecycleRecord) => {
    const line = `${JSON.stringify(record)}\n`
    const append = async () => {
      const handle = await FS.openAppend(path)
      try {
        await handle.writeFile(line)
      } finally {
        await handle.close()
      }
    }
    pending = pending.then(append, append).catch(() => {})
  }

  const record: StudioLifecycleLog['record'] = partial => {
    const full: StudioLifecycleRecord = { ...partial, launchId: options.launchId, timestamp: timestamp() }
    write(full)
    if (ANNOUNCED_EVENTS.has(full.event)) {
      announce(formatLifecycleRecord(full))
    }
  }

  return {
    close: async () => await pending,
    path,
    record,
    span: async (start, finish, work) => {
      record(start)
      const startedAt = now()
      try {
        const value = await work()
        record({ ...finish('ok'), elapsedMs: now() - startedAt })
        return value
      } catch (error) {
        record({ ...finish('failed'), elapsedMs: now() - startedAt, message: (error as Error).message })
        throw error
      }
    },
  }
}

/** formatLifecycleRecord renders one record as the concise line the terminal shows. */
export function formatLifecycleRecord(record: StudioLifecycleRecord): string {
  const details = [
    record.port === undefined ? undefined : `port ${record.port}`,
    record.pid === undefined ? undefined : `pid ${record.pid}`,
    record.compileRevision === undefined ? undefined : `compile ${record.compileRevision}`,
    record.previewRevision === undefined ? undefined : `preview ${record.previewRevision}`,
    record.elapsedMs === undefined ? undefined : `${record.elapsedMs}ms`,
    record.shutdownReason,
    record.message,
  ].filter((detail): detail is string => detail !== undefined && detail !== '')
  const suffix = details.length === 0 ? '' : ` (${details.join(', ')})`
  return `${record.component} ${record.event}${suffix}`
}
