import { FS, HCI, TaoFiles } from '@shared'
import SourceActions from '@source-actions'
import { watch } from 'chokidar'
import { StudioProjectSession } from './StudioProjectSession'

export type StudioFileWatcherOptions = {
  batchDelayMs?: number
  onError?: (error: unknown) => void
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
  const onError = options.onError ?? (error => HCI.logProcessError('studio-watch', String(error)))
  let timer: ReturnType<typeof setTimeout> | undefined
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
  const notePath = async (path: string, exists: boolean) => {
    if (FS.extname(path) !== '.tao') {
      return
    }
    const sourceVersion = exists ? SourceActions.studioSourceVersion(await FS.readText(path)) : undefined
    pending.set(path, { path, sourceVersion })
    schedule()
  }

  const watcher = watch(session.projectRoot, {
    ignoreInitial: true,
    ignored: path => ignoredPath(session.projectRoot, path),
  })
  watcher.on('add', path => void notePath(path, true).catch(onError))
  watcher.on('change', path => void notePath(path, true).catch(onError))
  watcher.on('unlink', path => void notePath(path, false).catch(onError))
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', resolve)
    watcher.once('error', reject)
  })

  return {
    async close() {
      await watcher.close()
      await flush()
      await flushing
    },
  }
}

function ignoredPath(projectRoot: string, path: string): boolean {
  const relative = FS.relativePath(projectRoot, path)
  return relative.split('/').some(part => TaoFiles.discoveryExcludeDirectoryNames.some(excluded => excluded === part))
}
