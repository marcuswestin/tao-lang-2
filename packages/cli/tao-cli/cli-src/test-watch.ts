import { Packages } from '@ast-utils'
import { minimalWatchRoots, startDebouncedWatcher, WATCH_DEBOUNCE_MS } from '@expo-dev-loop'
import { Errors, FS, HCI, Platform } from '@shared'
import { findTaoTestFiles, runTestCommandOnce, type TestCommandOptions, type TestRunOutcome } from './test-command'

/** DebouncedWatcher is the small shape `runTestWatchLoop` needs from any watcher it is given. */
type DebouncedWatcher = { close: () => Promise<void> }

/** TestWatchDeps lets a test inject the watcher, the run function, the error reporter, and the stop signal. */
export type TestWatchDeps = {
  /** Runs the selected test set once; called immediately, then again after every debounced change. */
  runOnce: () => Promise<TestRunOutcome>
  /** Starts a watcher that calls `onChange` once per debounced change; closed once `signal` aborts. */
  startWatcher: (onChange: () => void) => DebouncedWatcher
  /** Stops the loop the way Ctrl-C stops `tao dev`. */
  signal: AbortSignal
  /** Prints the between-runs status line naming what is being watched. */
  reportWaiting: () => void
  /** Reports a run that threw, the way the one-shot `tao test` reports an uncaught error. */
  reportError: (error: unknown) => void
}

/**
 * runTestWatchLoop runs `deps.runOnce` once, then again after every debounced change `deps.startWatcher`
 * reports, until `deps.signal` aborts. Runs are serialized: a change that arrives while a run is still
 * in progress queues exactly one rerun rather than starting a second run alongside the first or
 * queuing one per change. A run that returns a failing outcome is reported by `runOnce` itself; a run
 * that throws — a preflight `--name` mismatch, a torn read, a worker crash — is caught here and
 * reported through `deps.reportError` instead of becoming an unhandled rejection. Either way the loop
 * keeps watching.
 */
export async function runTestWatchLoop(deps: TestWatchDeps): Promise<void> {
  let running = false
  let queued = false
  let currentRun: Promise<void> = Promise.resolve()

  const runAndSettle = (): Promise<void> => {
    running = true
    return (async () => {
      try {
        await deps.runOnce()
      } catch (error) {
        deps.reportError(error)
      } finally {
        running = false
        if (deps.signal.aborted) {
          return
        }
        if (queued) {
          queued = false
          currentRun = runAndSettle()
          await currentRun
        } else {
          deps.reportWaiting()
        }
      }
    })()
  }

  const onChange = (): void => {
    if (deps.signal.aborted) {
      return
    }
    if (running) {
      queued = true
      return
    }
    currentRun = runAndSettle()
  }

  const watcher = deps.startWatcher(onChange)
  currentRun = runAndSettle()

  await new Promise<void>(resolve => {
    if (deps.signal.aborted) {
      resolve()
      return
    }
    deps.signal.addEventListener('abort', () => resolve(), { once: true })
  })
  await currentRun
  await watcher.close()
}

/** TestWatchCommandDeps overrides one piece of `runTestWatchCommand`'s real wiring, for a test. */
export type TestWatchCommandDeps = {
  runOnce?: () => Promise<TestRunOutcome>
  startWatcher?: (onChange: () => void) => DebouncedWatcher
  signal?: AbortSignal
  reportError?: (error: unknown) => void
}

/**
 * runTestWatchCommand runs `tao test --watch`: the selected set once, then again on any change under
 * the selected paths or the selected tests' project roots, until Ctrl-C. Every rerun bypasses the
 * compiled-output cache, because a watch loop exists to show a fresh run, not a replayed green.
 *
 * A path with no Tao tests under it today still joins the watch set rather than ending the command:
 * the whole point of watching the selected directories is to notice a test file that does not exist
 * yet, and the run body reports "no tests found" for itself on every run that still finds none.
 */
export async function runTestWatchCommand(
  paths: string | readonly string[],
  options: TestCommandOptions = {},
  overrides: TestWatchCommandDeps = {},
): Promise<void> {
  const roots = (typeof paths === 'string' ? [paths] : paths).map(path => FS.resolvePath(path))
  const found = new Set<string>()
  for (const root of roots) {
    for (const testPath of await findTaoTestFiles(root)) {
      found.add(testPath)
    }
  }
  const testPaths = [...found].sort()

  const { describeWatch, watchRoots } = await watchSetFor(roots, testPaths)

  const controller = overrides.signal === undefined ? new AbortController() : undefined
  const signal = overrides.signal ?? controller!.signal
  const removeSigint = controller === undefined ? undefined : Platform.onProcessSignal('SIGINT', () => {
    controller.abort()
  })
  const removeSigterm = controller === undefined ? undefined : Platform.onProcessSignal('SIGTERM', () => {
    controller.abort()
  })
  const restoreNoCache = disableTestCacheForWatch()

  try {
    await runTestWatchLoop({
      reportError: overrides.reportError ?? (error => HCI.writeErrorLine(Errors.formatForUser(error))),
      reportWaiting: () => HCI.logProcessInfo('test', describeWatch),
      runOnce: overrides.runOnce ?? (() => runTestCommandOnce(paths, options)),
      signal,
      startWatcher: overrides.startWatcher
        ?? (onChange => startDebouncedWatcher(watchRoots, onChange, { debounceMs: WATCH_DEBOUNCE_MS })),
    })
  } finally {
    removeSigint?.()
    removeSigterm?.()
    restoreNoCache()
  }
}

/**
 * disableTestCacheForWatch forces every run inside a watch loop to compile from source, and restores
 * whatever the environment held before the loop started once it stops.
 */
function disableTestCacheForWatch(): () => void {
  const previous = Platform.runtimeProcess.env['TAO_TEST_NO_CACHE']
  Platform.runtimeProcess.env['TAO_TEST_NO_CACHE'] = 'true'
  return () => {
    if (previous === undefined) {
      delete Platform.runtimeProcess.env['TAO_TEST_NO_CACHE']
    } else {
      Platform.runtimeProcess.env['TAO_TEST_NO_CACHE'] = previous
    }
  }
}

/**
 * watchSetFor computes the directories `--watch` must watch: the project root of every selected test
 * file, plus every selected path that is itself a directory, so a brand-new test file or project
 * created under a selected path still triggers a rerun — the run body rediscovers tests on every run,
 * so nothing more than "does something under here look different" is needed.
 */
async function watchSetFor(
  roots: readonly string[],
  testPaths: readonly string[],
): Promise<{ describeWatch: string; watchRoots: string[] }> {
  const sweep = Packages.createProjectRootSweep()
  const candidates = new Set<string>()
  for (const testPath of testPaths) {
    candidates.add(await Packages.containingProjectRoot(FS.dirname(testPath), sweep) ?? FS.dirname(testPath))
  }
  for (const root of roots) {
    if (await FS.isDirectory(root)) {
      candidates.add(root)
    }
  }
  const watchRoots = minimalWatchRoots([...candidates])
  const displayWatchRoots = watchRoots.map(root => FS.displayPath(root))
  const describeWatch = `Watching ${watchRoots.length} ${watchRoots.length === 1 ? 'directory' : 'directories'} `
    + `for changes (${displayWatchRoots.join(', ')}); waiting for the next one.`
  return { describeWatch, watchRoots }
}
