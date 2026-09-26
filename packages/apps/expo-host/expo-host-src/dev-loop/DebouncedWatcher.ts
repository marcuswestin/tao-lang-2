import { FS, Platform } from '@shared'
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
  /**
   * Consulted on every raw event, before it would (re)start the debounce timer. Returning true drops
   * the event: any pending timer is cleared and none is scheduled, so a busy caller does not queue a
   * rerun for the moment it becomes free again. `onChange` itself still runs the same fire-time check
   * a caller needs for the run that was already scheduled before it became busy.
   */
  shouldDrop?: () => boolean
  /**
   * Forces chokidar's polling backend instead of native filesystem events. Unset everywhere this
   * package uses it — native events are what a real dev machine wants — but a test running inside a
   * sandbox whose native events do not reliably report a brand-new file can ask for it explicitly.
   */
  usePolling?: boolean
}

/** EventDebouncer turns a stream of raw watcher events into one `onChange` per quiet period. */
export type EventDebouncer = {
  /** Feeds one raw event in; it restarts the quiet period, or is dropped when `shouldDrop` says so. */
  handle: (event: string, path: string) => void
  /** Cancels a pending `onChange`, for a watcher that is closing. */
  cancel: () => void
}

/**
 * createEventDebouncer holds the debounce policy apart from chokidar, so a test can drive it with
 * events it chooses instead of with filesystem timing it cannot control.
 */
export function createEventDebouncer(onChange: () => void, options: DebouncedWatcherOptions): EventDebouncer {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  return {
    cancel,
    handle(event, path) {
      options.onEvent?.(event, path)
      cancel()
      if (options.shouldDrop?.()) {
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        onChange()
      }, options.debounceMs)
    },
  }
}

/**
 * startDebouncedWatcher watches `paths` with chokidar and calls `onChange` once per quiet period
 * after a change settles. Beyond `shouldDrop`, it carries no policy about what to do while a previous
 * `onChange` is still being acted on — a caller that must queue or serialize decides that itself
 * inside `onChange`, since it runs synchronously when the debounce timer fires.
 */
export function startDebouncedWatcher(
  paths: readonly string[],
  onChange: () => void,
  options: DebouncedWatcherOptions,
): DebouncedWatcher {
  const debouncer = createEventDebouncer(onChange, options)
  const usePolling = options.usePolling ?? defaultsToPolling(Platform.hostPlatform, Platform.runtimeBunVersion)
  const watcher = chokidar.watch([...paths], {
    ignoreInitial: true,
    ignored: shouldIgnoreWatchPath,
    usePolling,
  })
  watcher.on('all', debouncer.handle)
  return {
    async close() {
      debouncer.cancel()
      await watcher.close()
    },
  }
}

/**
 * FIRST_BUN_WATCHING_ONLY_THROUGH_FSEVENTS is the Bun whose macOS `fs.watch` watches single files
 * through FSEvents too, where earlier ones used kqueue. An agent sandbox refuses FSEvents, so from
 * this release on a sandboxed watcher receives no native events at all; outside a sandbox they
 * arrive as before.
 */
const FIRST_BUN_WATCHING_ONLY_THROUGH_FSEVENTS = '1.3.14'

/**
 * defaultsToPolling reports whether a watcher on this platform and runtime polls when its caller does
 * not choose. The events are lost only inside an agent sandbox, which refuses the FSEvents service,
 * but nothing here can tell a sandbox apart reliably, so every macOS Bun that depends on FSEvents
 * polls. That costs an ordinary Mac some CPU; the alternative is missing edits without a word inside
 * a sandbox. Letting the sandbox reach FSEvents removes the reason, which
 * `DEVENV-FILE-WATCHING-DEPENDS-ON-A-WATCHMAN-NO-AGENT-CAN-START` tracks. Under Node there is no Bun
 * version, and the sandbox's refusal surfaces as an `EMFILE` error rather than silence.
 */
export function defaultsToPolling(platform: string, bunVersion: string | undefined): boolean {
  return platform === 'darwin'
    && bunVersion !== undefined
    && Platform.semverSatisfies(bunVersion, `>=${FIRST_BUN_WATCHING_ONLY_THROUGH_FSEVENTS}`)
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
    || normalized.includes('/.tao/')
    || normalized.endsWith('/.tao')
    || normalized.includes('/.expo/')
    || normalized.endsWith('/.expo')
    || normalized.includes('/_gen_')
    || normalized.endsWith('.tsbuildinfo')
    || normalized.endsWith('/ios')
    || normalized.includes('/ios/')
    || normalized.endsWith('/android')
    || normalized.includes('/android/')
}
