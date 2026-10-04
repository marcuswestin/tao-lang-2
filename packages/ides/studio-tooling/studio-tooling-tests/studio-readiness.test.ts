import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import {
  createStudioLifecycleLog,
  formatLifecycleRecord,
  type StudioLifecycleRecord,
} from '../studio-tooling-src/StudioLifecycleLog'
import { openTarget, waitForReadyUrl } from '../studio-tooling-src/StudioReadiness'

/** A root whose child cannot be a directory, so every log write fails on any host. */
async function unwritableRoot(): Promise<string> {
  const root = await mkTestDir('tao-studio-unwritable-')
  await FS.writeText(FS.resolvePath('not-a-directory', root), 'a file, not a directory')
  return root
}

async function readRecords(path: string): Promise<StudioLifecycleRecord[]> {
  return (await FS.readText(path)).split('\n').filter(Boolean).map(line => JSON.parse(line) as StudioLifecycleRecord)
}

Describe('Studio readiness', () => {
  Test('waits until the advertised page answers before reporting ready', async () => {
    let attempts = 0
    let clock = 0
    // budget-ok: The injected clock advances without host sleep.
    const ready = await waitForReadyUrl('http://127.0.0.1:42100/sessions/abc', {
      fetchUrl: async () => {
        attempts += 1
        return { ok: attempts >= 3 }
      },
      pollMs: 1,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
      timeoutMs: 100, // budget-ok: Injected clock; no host wait.
    })

    Expect(ready).toBe(true)
    Expect(attempts).toBe(3)
  })

  Test('reports not ready rather than throwing when the page never answers', async () => {
    let clock = 0
    // budget-ok: The injected clock advances without host sleep.
    const ready = await waitForReadyUrl('http://127.0.0.1:42100/sessions/abc', {
      fetchUrl: async () => {
        Errors.throwHostEnvironment('connection refused')
      },
      pollMs: 1,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
      timeoutMs: 5, // budget-ok: Injected clock; no host wait.
    })

    Expect(ready).toBe(false)
  })

  Test('opens the session page exactly once, and never with --no-browser', () => {
    const sessionUrl = 'http://127.0.0.1:42100/sessions/abc'

    Expect(openTarget({ opened: false, sessionUrl })).toBe(sessionUrl)
    Expect(openTarget({ browser: false, opened: false, sessionUrl })).toBeUndefined()
    Expect(openTarget({ opened: true, sessionUrl })).toBeUndefined()
  })
})

Describe('Studio lifecycle telemetry', () => {
  Test('writes every event in order under the launch artifact root', async () => {
    const root = await mkTestDir('tao-studio-lifecycle-')
    try {
      const log = createStudioLifecycleLog({ artifactRoot: root, launchId: 'browser-1' })
      log.record({ component: 'studio-server', event: 'launch-requested', pid: 42 })
      log.record({ component: 'studio-server', event: 'port-allocated', port: 42100 })
      log.record({ component: 'preview', event: 'preview-published', previewRevision: 3 })
      await log.close()

      const records = await readRecords(log.path)
      Expect(records.map(record => record.event)).toEqual([
        'launch-requested',
        'port-allocated',
        'preview-published',
      ])
      Expect(records.every(record => record.launchId === 'browser-1')).toBe(true)
      Expect(records.every(record => typeof record.timestamp === 'string')).toBe(true)
      Expect(FS.pathIsWithin(log.path, root)).toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('keeps the terminal to the events a person is waiting on', async () => {
    const root = await mkTestDir('tao-studio-lifecycle-quiet-')
    try {
      const announced: string[] = []
      const log = createStudioLifecycleLog({
        announce: line => announced.push(line),
        artifactRoot: root,
        launchId: 'browser-1',
      })
      log.record({ component: 'studio-server', event: 'launch-requested' })
      log.record({ component: 'watcher', event: 'watcher-ready' })
      log.record({ component: 'studio-server', event: 'server-ready', port: 42100 })
      log.record({ component: 'preview', event: 'compile-failed', message: 'unexpected token' })
      await log.close()

      Expect(announced).toEqual([
        'studio-server server-ready (port 42100)',
        'preview compile-failed (unexpected token)',
      ])
      Expect((await readRecords(log.path)).length).toBe(4)
    } finally {
      await FS.remove(root)
    }
  })

  Test('times a span and records how long it took, failure included', async () => {
    const root = await mkTestDir('tao-studio-lifecycle-span-')
    try {
      let clock = 0
      const log = createStudioLifecycleLog({
        announce: () => {},
        artifactRoot: root,
        launchId: 'browser-1',
        now: () => (clock += 25),
      })
      await log.span(
        { component: 'preview', event: 'compile-started' },
        result => ({ component: 'preview', event: result === 'ok' ? 'compile-completed' : 'compile-failed' }),
        async () => 'compiled',
      )
      await log.span(
        { component: 'preview', event: 'client-reload-started' },
        result => ({
          component: 'preview',
          event: result === 'ok' ? 'client-reload-completed' : 'client-reload-failed',
        }),
        async () => {
          Errors.throwHostEnvironment('reload rejected')
        },
      ).catch(() => {})
      await log.close()

      const records = await readRecords(log.path)
      Expect(records.map(record => record.event)).toEqual([
        'compile-started',
        'compile-completed',
        'client-reload-started',
        'client-reload-failed',
      ])
      Expect(records[1]?.elapsedMs).toBe(25)
      Expect(records[3]?.message).toBe('reload rejected')
    } finally {
      await FS.remove(root)
    }
  })

  Test('never stops a launch because its log could not be written', async () => {
    const announced: string[] = []
    const root = await unwritableRoot()
    try {
      const log = createStudioLifecycleLog({
        announce: line => announced.push(line),
        // Unwritable on any host: a path under a file rather than a directory.
        artifactRoot: FS.resolvePath('not-a-directory/logs', root),
        launchId: 'browser-1',
      })
      log.record({ component: 'studio-server', event: 'server-ready', port: 42100 })

      await log.close()

      // The record still reached the terminal, and closing resolved rather than rejecting — which
      // is the whole property. Without an assertion this test proved nothing on a permissive host.
      Expect(announced).toEqual(['studio-server server-ready (port 42100)'])
      Expect(await FS.exists(log.path)).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('formats lifecycle identity, elapsed duration and shutdown reason', () => {
    Expect(formatLifecycleRecord({
      component: 'metro',
      elapsedMs: 120,
      event: 'process-exited',
      launchId: 'browser-1',
      pid: 4242,
      shutdownReason: 'studio exited',
      timestamp: '2026-01-01T00:00:00.000Z',
    })).toBe('metro process-exited (pid 4242, 120ms, studio exited)')
  })
})
