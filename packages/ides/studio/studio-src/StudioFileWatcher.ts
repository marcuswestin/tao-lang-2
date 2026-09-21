import { FS, HCI, TaoFiles } from '@shared'
import SourceActions from '@source-actions'
import { watch } from 'chokidar'
import { StudioProjectSession } from './StudioProjectSession'

export type StudioFileWatcherOptions = {
  batchDelayMs?: number
  onError?: (error: unknown) => void
  reconcileIntervalMs?: number
}

export type StartedStudioFileWatcher = {
  close: () => Promise<void>
}

/** startStudioFileWatcher batches external Tao changes into the session's single compile lane. */
export async function startStudioFileWatcher(
  session: StudioProjectSession,
  options: StudioFileWatcherOptions = {},
): Promise<StartedStudioFileWatcher> {
  const pending = new Map<string, { path: string; sourceVersion?: string }>()
  const batchDelayMs = options.batchDelayMs ?? 25
  const reconcileIntervalMs = options.reconcileIntervalMs ?? 5_000
  const onError = options.onError ?? (error => HCI.logProcessError('studio-watch', String(error)))
  let timer: ReturnType<typeof setTimeout> | undefined
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let flushing: Promise<void> = Promise.resolve()

  const flush = async () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    if (pending.size === 0) {
      return
    }
    const changes = [...pending.values()]
    pending.clear()
    await session.noteWatchChanges(changes)
  }
  const schedule = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      flushing = flushing.then(flush).catch(onError)
    }, batchDelayMs)
  }
  const changes = new StudioWatchChangeLane(async (path, exists) => {
    if (FS.extname(path) !== '.tao') {
      return
    }
    const sourceVersion = exists ? SourceActions.studioSourceVersion(await FS.readText(path)) : undefined
    pending.set(path, { path, sourceVersion })
    schedule()
  }, onError)

  const watcher = watch(session.projectRoot, {
    ignoreInitial: true,
    ignored: path => ignoredPath(session.projectRoot, path),
  })
  watcher.on('add', path => changes.note(path, true))
  watcher.on('change', path => changes.note(path, true))
  watcher.on('unlink', path => changes.note(path, false))
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve)
    watcher.once('error', reject)
  })
  // The session's first scan necessarily predates this subscription. Drain anything Chokidar saw
  // while it initialized, then scan once more inside the same ordered event lane to close that gap.
  await changes.barrier(async () => {
    await flush()
    await flushing
    await session.reconcileProjectFiles()
  })

  const scheduleReconcile = (): void => {
    if (closed || reconcileIntervalMs <= 0) {
      return
    }
    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined
      void changes.barrier(async () => {
        await flush()
        await flushing
        await session.reconcileProjectFiles()
      }).catch(onError).finally(scheduleReconcile)
    }, reconcileIntervalMs)
  }
  scheduleReconcile()

  return {
    async close() {
      closed = true
      if (reconcileTimer !== undefined) {
        clearTimeout(reconcileTimer)
        reconcileTimer = undefined
      }
      await watcher.close()
      await changes.drain()
      await flush()
      await flushing
    },
  }
}

/**
 * Orders watcher work before it can update the coalescing map. Chokidar emits in order, but hashing
 * used to run in detached promises, allowing a slow old `change` read to overwrite a later `unlink`.
 * Barriers also put reconciliation scans between complete event epochs instead of racing their reads.
 */
class StudioWatchChangeLane {
  #lane: Promise<void> = Promise.resolve()

  constructor(
    private readonly apply: (path: string, exists: boolean) => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  note(path: string, exists: boolean): void {
    this.#lane = this.#lane.then(
      async () => await this.apply(path, exists),
      async () => await this.apply(path, exists),
    ).catch(this.onError)
  }

  async barrier(task: () => Promise<void>): Promise<void> {
    const barrier = this.#lane.then(task, task)
    this.#lane = barrier.catch(this.onError)
    await barrier
  }

  async drain(): Promise<void> {
    await this.#lane
  }
}

export const StudioFileWatcherTesting = {
  createChangeLane(
    apply: (path: string, exists: boolean) => Promise<void>,
    onError: (error: unknown) => void = () => {},
  ) {
    return new StudioWatchChangeLane(apply, onError)
  },
} as const

function ignoredPath(projectRoot: string, path: string): boolean {
  const relative = FS.relativePath(projectRoot, path)
  return relative.split('/').some(part => TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded === part))
}
