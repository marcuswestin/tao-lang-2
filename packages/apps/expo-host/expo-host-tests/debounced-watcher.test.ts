import { createEventDebouncer, shouldIgnoreWatchPath } from '@expo-host/dev-loop/DebouncedWatcher'
import { Time } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

// These drive the debounce policy with events the test chooses. A real chokidar watcher reports a
// write as one event or several, early or late, depending on the host's filesystem backend, so
// counting callbacks against real writes pins the machine rather than the policy.
Describe('createEventDebouncer', () => {
  Test('collapses several rapid events into exactly one change after the quiet period', async () => {
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

    await Time.sleep(120)

    Expect(changeCount).toBe(1)
    Expect(events).toEqual([
      'change:/project/Watched.tao',
      'change:/project/Watched.tao',
      'add:/project/New.tao',
    ])
  })

  // Pins `tao dev`'s original behavior: an event that arrives while `shouldDrop` is true never
  // schedules a change, and it cancels whatever change an earlier event had already scheduled.
  Test('drops a scheduled change when a later event arrives while shouldDrop is true', async () => {
    let changeCount = 0
    let dropping = false
    const debouncer = createEventDebouncer(() => {
      changeCount += 1
    }, { debounceMs: 40, shouldDrop: () => dropping })

    debouncer.handle('change', '/project/First.tao')
    dropping = true
    debouncer.handle('change', '/project/Second.tao')
    await Time.sleep(120)
    Expect(changeCount).toBe(0)

    // Once no longer dropping, a fresh event schedules and fires normally.
    dropping = false
    debouncer.handle('change', '/project/First.tao')
    await Time.sleep(120)
    Expect(changeCount).toBe(1)
  })

  Test('cancel stops a pending change from firing', async () => {
    let changeCount = 0
    const debouncer = createEventDebouncer(() => {
      changeCount += 1
    }, { debounceMs: 40 })

    debouncer.handle('change', '/project/Watched.tao')
    debouncer.cancel()
    await Time.sleep(120)

    Expect(changeCount).toBe(0)
  })
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
