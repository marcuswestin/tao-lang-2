import { createEventDebouncer, shouldIgnoreWatchPath } from '@expo-host/dev-loop/DebouncedWatcher'
import { Describe, Expect, Test, testOverrideSlot } from '@shared/test'

type SetTimeoutCall = (...args: Parameters<typeof globalThis.setTimeout>) => ReturnType<typeof globalThis.setTimeout>
type ClearTimeoutCall = (handle: ReturnType<typeof globalThis.setTimeout> | number | undefined) => void

const timeoutSlot = testOverrideSlot<SetTimeoutCall>({
  read: () => globalThis.setTimeout,
  write: value => globalThis.setTimeout = value as typeof globalThis.setTimeout,
})
const clearTimeoutSlot = testOverrideSlot<ClearTimeoutCall>({
  read: () => globalThis.clearTimeout,
  write: value => globalThis.clearTimeout = value as typeof globalThis.clearTimeout,
})

// Keep overrides synchronous so other asynchronous work always sees the real timers.
function withScheduledChanges(run: (flush: () => void, delays: readonly (number | undefined)[]) => void): void {
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>()
  const delays: (number | undefined)[] = []
  let nextId = 0
  const restoreTimeout = timeoutSlot.install((...args) => {
    const [handler, delay, ...callbackArgs] = args
    const handle = { id: ++nextId } as unknown as ReturnType<typeof setTimeout>
    delays.push(delay)
    pending.set(handle, () => Reflect.apply(handler, undefined, callbackArgs))
    return handle
  })
  const restoreClear = clearTimeoutSlot.install(timer => {
    pending.delete(timer as ReturnType<typeof setTimeout>)
  })
  try {
    run(() => {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach(callback => callback())
    }, delays)
  } finally {
    restoreClear()
    restoreTimeout()
  }
}

// Drive Tao's pending-change policy; the platform owns when timers become ready.
Describe('createEventDebouncer', () => {
  Test('collapses several pending events into exactly one change', () =>
    withScheduledChanges((flush, delays) => {
      let changeCount = 0
      const events: string[] = []
      const debouncer = createEventDebouncer(() => {
        changeCount += 1
      }, {
        debounceMs: 40,
        onEvent: (event, path) => events.push(`${event}:${path}`),
      })

      debouncer.handle('change', '/project/Watched.tao')
      debouncer.handle('change', '/project/Watched.tao')
      debouncer.handle('add', '/project/New.tao')
      Expect(changeCount).toBe(0)
      Expect(delays).toEqual([40, 40, 40])

      flush()

      Expect(changeCount).toBe(1)
      Expect(events).toEqual([
        'change:/project/Watched.tao',
        'change:/project/Watched.tao',
        'add:/project/New.tao',
      ])
    }))

  // Pins `tao run`'s original behavior: an event that arrives while `shouldDrop` is true never
  // schedules a change, and it cancels whatever change an earlier event had already scheduled.
  Test(
    'drops a scheduled change when a later event arrives while shouldDrop is true',
    () =>
      withScheduledChanges(flush => {
        let changeCount = 0
        let dropping = false
        const debouncer = createEventDebouncer(() => {
          changeCount += 1
        }, { debounceMs: 40, shouldDrop: () => dropping })

        debouncer.handle('change', '/project/First.tao')
        dropping = true
        debouncer.handle('change', '/project/Second.tao')
        flush()
        Expect(changeCount).toBe(0)

        // Once no longer dropping, a fresh event schedules and fires normally.
        dropping = false
        debouncer.handle('change', '/project/First.tao')
        flush()
        Expect(changeCount).toBe(1)
      }),
  )

  Test('cancel stops a pending change from firing', () =>
    withScheduledChanges(flush => {
      let changeCount = 0
      const debouncer = createEventDebouncer(() => {
        changeCount += 1
      }, { debounceMs: 40 })

      debouncer.handle('change', '/project/Watched.tao')
      debouncer.cancel()
      flush()

      Expect(changeCount).toBe(0)
    }))
})

Describe('shouldIgnoreWatchPath', () => {
  Test('ignores node_modules, generated trees, and VCS metadata', () => {
    Expect(shouldIgnoreWatchPath('/repo/node_modules/pkg/index.ts')).toBe(true)
    Expect(shouldIgnoreWatchPath('/repo/Apps/Foo/_gen_app/App.tsx')).toBe(true)
    Expect(shouldIgnoreWatchPath('/repo/.git/HEAD')).toBe(true)
    Expect(shouldIgnoreWatchPath('/repo/.artifacts/logs/x.log')).toBe(true)
  })

  Test('keeps ordinary source paths', () => {
    Expect(shouldIgnoreWatchPath('/repo/Apps/Foo/App.tao')).toBe(false)
  })
})
