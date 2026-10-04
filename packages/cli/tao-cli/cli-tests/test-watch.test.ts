import { Errors, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTestWatchCommand, runTestWatchLoop, type TestWatchDeps } from '../cli-src/test-watch'
import { withTaoFixture } from './test-cli-files'

/** deferred returns a promise a test resolves from the outside, at exactly the moment it chooses. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

/** FakeWatch captures the loop's onChange callback so a test can fire it whenever it chooses. */
type FakeWatch = {
  closed: boolean
  fireChange: () => void
  startWatcher: TestWatchDeps['startWatcher']
}

/** noopReportError is the error reporter for a test whose scenario is not about error reporting. */
const noopReportError = (): void => {}

function fakeWatch(): FakeWatch {
  const state: FakeWatch = {
    closed: false,
    // Replaced with the real callback as soon as `startWatcher` runs, which `runTestWatchLoop` does
    // synchronously before anything can call `fireChange`.
    fireChange: () => {},
    startWatcher: onChange => {
      state.fireChange = onChange
      return {
        close: async () => {
          state.closed = true
        },
      }
    },
  }
  return state
}

Describe('runTestWatchLoop', () => {
  Test('runs the selected set once on start, then stops cleanly on abort', async () => {
    const watch = fakeWatch()
    const controller = new AbortController()
    const waits: number[] = []
    let calls = 0

    const loop = runTestWatchLoop({
      reportError: noopReportError,
      reportWaiting: () => waits.push(calls),
      runOnce: async () => {
        calls += 1
        return { failed: false }
      },
      signal: controller.signal,
      startWatcher: watch.startWatcher,
    })

    // The controller's first run resolves synchronously (a microtask), so give it a turn.
    await Promise.resolve()
    await Promise.resolve()
    Expect(calls).toBe(1)
    Expect(waits).toEqual([1])

    controller.abort()
    await loop

    Expect(watch.closed).toBe(true)
  })

  Test('collapses every change that arrives during a run into exactly one queued rerun', async () => {
    const watch = fakeWatch()
    const controller = new AbortController()
    let calls = 0
    let firstRun = deferred<void>()

    const loop = runTestWatchLoop({
      reportError: noopReportError,
      reportWaiting: () => {},
      runOnce: async () => {
        calls += 1
        if (calls === 1) {
          await firstRun.promise
        }
        return { failed: false }
      },
      signal: controller.signal,
      startWatcher: watch.startWatcher,
    })

    await Promise.resolve()
    Expect(calls).toBe(1)

    // Three changes arrive while the first run is still in flight.
    watch.fireChange()
    watch.fireChange()
    watch.fireChange()
    firstRun.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // Exactly one rerun, not three, and not zero.
    Expect(calls).toBe(2)

    controller.abort()
    await loop
  })

  Test('keeps watching after a failing run instead of stopping the loop', async () => {
    const watch = fakeWatch()
    const controller = new AbortController()
    const outcomes: boolean[] = []
    let calls = 0

    const loop = runTestWatchLoop({
      reportError: noopReportError,
      reportWaiting: () => {},
      runOnce: async () => {
        calls += 1
        const failed = calls === 1
        outcomes.push(failed)
        return { failed }
      },
      signal: controller.signal,
      startWatcher: watch.startWatcher,
    })

    await Promise.resolve()
    await Promise.resolve()
    Expect(outcomes).toEqual([true])

    watch.fireChange()
    await Promise.resolve()
    await Promise.resolve()
    Expect(outcomes).toEqual([true, false])

    controller.abort()
    await loop
  })

  Test('starts no rerun once aborted, even when one was already queued', async () => {
    const watch = fakeWatch()
    const controller = new AbortController()
    let calls = 0
    const firstRun = deferred<void>()

    const loop = runTestWatchLoop({
      reportError: noopReportError,
      reportWaiting: () => {},
      runOnce: async () => {
        calls += 1
        if (calls === 1) {
          await firstRun.promise
        }
        return { failed: false }
      },
      signal: controller.signal,
      startWatcher: watch.startWatcher,
    })

    await Promise.resolve()
    Expect(calls).toBe(1)

    watch.fireChange()
    controller.abort()
    firstRun.resolve()
    await loop

    Expect(calls).toBe(1)
    Expect(watch.closed).toBe(true)
  })

  Test('reports a throwing rerun once and keeps the loop alive', async () => {
    const watch = fakeWatch()
    const controller = new AbortController()
    const errors: unknown[] = []
    let calls = 0

    const loop = runTestWatchLoop({
      reportError: error => errors.push(error),
      reportWaiting: () => {},
      runOnce: async () => {
        calls += 1
        if (calls === 2) {
          Errors.throwUserInput('a worker crashed')
        }
        return { failed: false }
      },
      signal: controller.signal,
      startWatcher: watch.startWatcher,
    })

    await Promise.resolve()
    await Promise.resolve()
    Expect(calls).toBe(1)

    watch.fireChange()
    await Promise.resolve()
    await Promise.resolve()
    Expect(calls).toBe(2)
    Expect(errors.length).toBe(1)

    // The loop is still alive: a further change still triggers a run.
    watch.fireChange()
    await Promise.resolve()
    await Promise.resolve()
    Expect(calls).toBe(3)
    Expect(errors.length).toBe(1)

    controller.abort()
    await loop
  })
})

Describe('runTestWatchCommand watch-set wiring', () => {
  Test('watches both selected projects and forwards their changes to the loop', async () => {
    await withTaoFixture({
      'One/Project.tao': 'project { id "watch-one" name "Watch One" }\n',
      'One/Sample.test.tao': 'test "Sample" { }\n',
      'Two/Project.tao': 'project { id "watch-two" name "Watch Two" }\n',
      'Two/Sample.test.tao': 'test "Sample" { }\n',
    }, async rootDir => {
      const roots = [FS.resolvePath('One', rootDir), FS.resolvePath('Two', rootDir)]
      const watch = fakeWatch()
      const started = deferred<void>()
      const controller = new AbortController()
      let calls = 0
      let watched: readonly string[] = []
      const loop = runTestWatchCommand(roots, {}, {
        runOnce: async () => {
          calls += 1
          return { failed: false }
        },
        signal: controller.signal,
        startWatcher: (onChange, watchRoots) => {
          watched = watchRoots
          const watcher = watch.startWatcher(onChange)
          started.resolve()
          return watcher
        },
      })
      await started.promise
      await Promise.resolve()
      watch.fireChange()
      await Promise.resolve()
      await Promise.resolve()
      controller.abort()
      await loop
      Expect(watched).toEqual(roots)
      Expect(calls).toBe(2)
      Expect(watch.closed).toBe(true)
    })
  })

  Test('watches a selected directory even when it has no tests yet', async () => {
    await withTaoFixture({
      'Project.tao': 'project { id "watch-empty" name "Watch Empty" }\n',
    }, async rootDir => {
      const watch = fakeWatch()
      const started = deferred<void>()
      const controller = new AbortController()
      let watched: readonly string[] = []
      const loop = runTestWatchCommand([rootDir], {}, {
        runOnce: async () => ({ failed: false }),
        signal: controller.signal,
        startWatcher: (onChange, watchRoots) => {
          watched = watchRoots
          const watcher = watch.startWatcher(onChange)
          started.resolve()
          return watcher
        },
      })
      await started.promise
      controller.abort()
      await loop
      Expect(watched).toEqual([rootDir])
      Expect(watch.closed).toBe(true)
    })
  })
})
