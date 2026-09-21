import { Errors, FS, Time } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { shouldIgnoreWatchPath, startDebouncedWatcher } from '../dev-src/expo-dev-loop/DebouncedWatcher'

/** waitUntil polls `condition` until it is true or `timeoutMs` elapses. */
async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      Errors.throwUnexpected('waitUntil timed out waiting for the debounced watcher.')
    }
    await Time.sleep(10)
  }
}

Describe('startDebouncedWatcher', () => {
  Test('collapses several rapid writes into exactly one debounced change', async () => {
    const root = await mkTestDir('tao-debounced-watcher-')
    const filePath = FS.resolvePath('Watched.tao', root)
    await FS.writeText(filePath, 'first\n')
    let changeCount = 0
    const events: string[] = []
    const watcher = startDebouncedWatcher([root], () => {
      changeCount += 1
    }, {
      debounceMs: 50,
      onEvent: (event, path) => events.push(`${event}:${path}`),
    })
    try {
      // A watcher needs a moment to finish its initial scan before it reports later writes.
      await Time.sleep(200)
      await FS.writeText(filePath, 'second\n')
      await FS.writeText(filePath, 'third\n')
      await FS.writeText(filePath, 'fourth\n')

      await waitUntil(() => changeCount > 0)
      // Give a would-be second callback a chance to arrive before asserting there is only one.
      await Time.sleep(200)

      Expect(changeCount).toBe(1)
      Expect(events.length).toBeGreaterThan(0)
    } finally {
      await watcher.close()
      await FS.remove(root)
    }
  })

  // Pins `tao dev`'s original behavior: an event that arrives while `shouldDrop` is true never
  // schedules a fire, and it cancels whatever fire an earlier event had already scheduled. Two
  // separate files stand in for two separate events, since chokidar coalesces rapid repeated writes
  // to the very same path into one event, which would leave this pinning nothing distinguishable.
  Test('drops a scheduled fire when a later event arrives while shouldDrop is true', async () => {
    const root = await mkTestDir('tao-debounced-watcher-drop-')
    const firstPath = FS.resolvePath('First.tao', root)
    const secondPath = FS.resolvePath('Second.tao', root)
    await FS.writeText(firstPath, 'first\n')
    await FS.writeText(secondPath, 'first\n')
    let changeCount = 0
    let dropping = false
    const watcher = startDebouncedWatcher([root], () => {
      changeCount += 1
    }, {
      debounceMs: 50,
      shouldDrop: () => dropping,
    })
    try {
      await Time.sleep(200)

      // Schedules a fire for +50ms, then a second event on a different file before it fires cancels
      // it because `shouldDrop` is now true — the pending timer must not survive to fire late.
      await FS.writeText(firstPath, 'second\n')
      await Time.sleep(20)
      dropping = true
      await FS.writeText(secondPath, 'second\n')
      await Time.sleep(150)
      Expect(changeCount).toBe(0)

      // Once no longer dropping, a fresh event schedules and fires normally.
      dropping = false
      await FS.writeText(firstPath, 'third\n')
      await waitUntil(() => changeCount === 1)
    } finally {
      await watcher.close()
      await FS.remove(root)
    }
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
