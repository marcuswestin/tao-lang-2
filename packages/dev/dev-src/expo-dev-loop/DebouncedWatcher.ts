import { FS } from '@shared'
import chokidar from 'chokidar'

/** WATCH_DEBOUNCE_MS is the quiet period every dev-loop-style watcher settles on before it fires. */
export const WATCH_DEBOUNCE_MS = 250

/** DebouncedWatcher watches a fixed set of paths and closes its chokidar resource. */
export type DebouncedWatcher = {
  close: () => Promise<void>
}

/** DebouncedWatcherOptions configures one generic debounced chokidar watcher. */
export type DebouncedWatcherOptions = {
  /** Milliseconds of quiet time after the last raw event before `onChange` fires. */
  debounceMs: number
  /** Called for every raw chokidar event before it is debounced, for a caller's own logging. */
  onEvent?: (event: string, path: string) => void
}

/**
 * startDebouncedWatcher watches `paths` with chokidar and calls `onChange` once per quiet period
 * after a change settles. It carries no policy about what to do while a previous `onChange` is
 * still being acted on — a caller that must skip, queue, or serialize decides that itself inside
 * `onChange`, since it runs synchronously when the debounce timer fires.
 */
export function startDebouncedWatcher(
  paths: readonly string[],
  onChange: () => void,
  options: DebouncedWatcherOptions,
): DebouncedWatcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = chokidar.watch([...paths], {
    ignoreInitial: true,
    ignored: shouldIgnoreWatchPath,
  })
  watcher.on('all', (event, path) => {
    options.onEvent?.(event, path)
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      onChange()
    }, options.debounceMs)
  })
  return {
    async close() {
      if (timer) {
        clearTimeout(timer)
        timer = undefined
      }
      await watcher.close()
    },
  }
}

/** shouldIgnoreWatchPath excludes noisy, generated, or vendored paths every dev-loop watcher skips. */
export function shouldIgnoreWatchPath(path: string): boolean {
  const normalized = FS.slashPath(path)
  return normalized.includes('/node_modules/')
    || normalized.endsWith('/node_modules')
    || normalized.includes('/.git/')
    || normalized.endsWith('/.git')
    || normalized.includes('/.artifacts/')
    || normalized.endsWith('/.artifacts')
    || normalized.includes('/.expo/')
    || normalized.endsWith('/.expo')
    || normalized.includes('/_gen_')
    || normalized.endsWith('.tsbuildinfo')
    || normalized.endsWith('/ios')
    || normalized.includes('/ios/')
    || normalized.endsWith('/android')
    || normalized.includes('/android/')
}
