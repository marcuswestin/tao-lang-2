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
