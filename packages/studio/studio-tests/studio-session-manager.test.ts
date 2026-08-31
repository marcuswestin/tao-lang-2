import { Describe, Expect, Test } from '@shared/test'
import type { StudioProjectSession } from '../studio-src/StudioProjectSession'
import { StudioSessionManager, type StudioSessionResource } from '../studio-src/StudioSessionManager'
import { StudioWelcome } from '../studio-src/StudioWelcome'

Describe('Studio session manager', () => {
  Test('owns multiple resources under stable opaque IDs and closes one or all', async () => {
    const ids = ['window_one', 'window_two']
    const closed: string[] = []
    const manager = new StudioSessionManager({
      createSessionId: () => ids.shift()!,
      now: clock('2026-08-30T12:00:00.000Z', '2026-08-30T13:00:00.000Z'),
    })
    const events: string[] = []
    manager.subscribe(event => events.push(`${event.type}:${event.sessionId}`))
    const first = manager.add(resource('/projects/First', 'First', closed))
    const second = manager.add(resource('/projects/Second', 'Second', closed))

    Expect(manager.require(first.sessionId).session.projectRoot).toBe('/projects/First')
    Expect(manager.require(second.sessionId).session.projectRoot).toBe('/projects/Second')
    Expect(manager.list().current.map(item => item.sessionId)).toEqual(['window_one', 'window_two'])

    Expect(await manager.close(first.sessionId)).toBe(true)
    Expect(await manager.close(first.sessionId)).toBe(false)
    Expect(manager.list().recent.map(item => item.project)).toEqual(['/projects/Second', '/projects/First'])
    await manager.closeAll()
    Expect(closed).toEqual(['/projects/First', '/projects/Second'])
    Expect(manager.list().current).toHaveLength(0)
    Expect(events).toEqual([
      'opened:window_one',
      'opened:window_two',
      'closed:window_one',
      'closed:window_two',
    ])
  })

  Test('opens filesystem projects only through the injected opener', async () => {
    const unavailable = new StudioSessionManager()
    await Expect(unavailable.open({ projectPath: '/untrusted/path' })).rejects.toThrow(
      'Opening projects is not available',
    )

    const requests: unknown[] = []
    const manager = new StudioSessionManager({
      createSessionId: () => 'trusted_window',
      async openProject(request) {
        requests.push(request)
        return resource(request.projectPath, request.appName ?? 'Selected', [])
      },
    })
    const opened = await manager.open({
      appName: 'Garden',
      entryPath: 'Variants.tao',
      projectPath: '/chosen/by/native-dialog',
    })

    Expect(opened.sessionId).toBe('trusted_window')
    Expect(requests).toEqual([{
      appName: 'Garden',
      entryPath: 'Variants.tao',
      projectPath: '/chosen/by/native-dialog',
    }])
  })

  Test('records and republishes a project immediately after it opens successfully', async () => {
    const changes: string[][] = []
    const manager = new StudioSessionManager({
      createSessionId: () => 'new_window',
      onRecentProjectsChanged: recent => changes.push(recent.map(item => item.project)),
      recentProjects: [{ appName: 'Older', lastOpenedAt: '2026-08-29T12:00:00.000Z', project: '/older' }],
    })
    const opened = manager.add(resource('/newer', 'Newer', []))

    Expect(manager.list().recent.map(item => item.project)).toEqual(['/newer', '/older'])
    await manager.close(opened.sessionId)
    Expect(changes).toEqual([['/newer', '/older']])
  })

  Test('replaces one window session only after the new app resource opens', async () => {
    const ids = ['old_window', 'new_window']
    const closed: string[] = []
    const manager = new StudioSessionManager({
      createSessionId: () => ids.shift()!,
      async openProject(request) {
        return resource(request.projectPath, request.appName ?? 'Default', closed)
      },
    })
    const current = manager.add(resource('/project', 'Wide', closed))

    const replacement = await manager.replace(current.sessionId, { appName: 'Compact', projectPath: '/project' })

    Expect(replacement).toMatchObject({ appName: 'Compact', project: '/project', sessionId: 'new_window' })
    Expect(manager.list().current.map(session => session.sessionId)).toEqual(['new_window'])
    Expect(closed).toEqual(['/project'])
  })

  Test('rolls back a replacement resource when the old session cannot close', async () => {
    const ids = ['old_window', 'new_window']
    const closed: string[] = []
    const manager = new StudioSessionManager({
      createSessionId: () => ids.shift()!,
      async openProject(request) {
        return resource(request.projectPath, request.appName ?? 'Default', closed)
      },
    })
    const current = manager.add({
      close: () => {
        throw new Error('old close failed')
      },
      session: { appName: 'Wide', projectRoot: '/project' } as StudioProjectSession,
    })

    await Expect(manager.replace(current.sessionId, { appName: 'Compact', projectPath: '/project' }))
      .rejects.toThrow('old close failed')

    Expect(manager.list().current.map(session => session.sessionId)).toEqual(['old_window'])
    Expect(closed).toEqual(['/project'])
  })

  Test('retains a resource after rejected cleanup and publishes closure only after retry succeeds', async () => {
    let attempts = 0
    const events: string[] = []
    const changes: string[][] = []
    const manager = new StudioSessionManager({
      createSessionId: () => 'retry_window',
      onRecentProjectsChanged: recent => changes.push(recent.map(item => item.project)),
    })
    manager.subscribe(event => events.push(`${event.type}:${event.sessionId}`))
    const opened = manager.add({
      close: async () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('cleanup failed')
        }
      },
      session: { appName: 'Retry', projectRoot: '/projects/Retry' } as StudioProjectSession,
    })

    await Expect(manager.close(opened.sessionId)).rejects.toThrow('cleanup failed')
    Expect(manager.require(opened.sessionId).session.projectRoot).toBe('/projects/Retry')
    Expect(manager.list().current.map(item => [item.sessionId, item.status])).toEqual([['retry_window', 'open']])
    Expect(manager.list().recent.map(item => item.project)).toEqual(['/projects/Retry'])
    Expect(events).toEqual(['opened:retry_window'])
    Expect(changes).toEqual([['/projects/Retry']])

    Expect(await manager.close(opened.sessionId)).toBe(true)
    Expect(attempts).toBe(2)
    Expect(manager.list().current).toEqual([])
    Expect(manager.list().recent.map(item => item.project)).toEqual(['/projects/Retry'])
    Expect(events).toEqual(['opened:retry_window', 'closed:retry_window'])
    Expect(changes).toEqual([['/projects/Retry']])
  })

  Test('retries cleanup after a synchronous close failure', async () => {
    let attempts = 0
    const manager = new StudioSessionManager({ createSessionId: () => 'sync_retry_window' })
    const opened = manager.add({
      close: () => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('synchronous cleanup failed')
        }
      },
      session: { appName: 'Retry', projectRoot: '/projects/Retry' } as StudioProjectSession,
    })

    await Expect(manager.close(opened.sessionId)).rejects.toThrow('synchronous cleanup failed')
    Expect(manager.list().current.map(item => item.status)).toEqual(['open'])
    Expect(await manager.close(opened.sessionId)).toBe(true)
    Expect(attempts).toBe(2)
  })

  Test('reports closing ownership and joins concurrent close attempts', async () => {
    const cleanup = deferred<void>()
    let attempts = 0
    const manager = new StudioSessionManager({ createSessionId: () => 'closing_window' })
    const opened = manager.add({
      close: async () => {
        attempts += 1
        await cleanup.promise
      },
      session: { appName: 'Closing', projectRoot: '/projects/Closing' } as StudioProjectSession,
    })

    const first = manager.close(opened.sessionId)
    const second = manager.close(opened.sessionId)
    Expect(manager.list().current.map(item => [item.sessionId, item.status])).toEqual([
      ['closing_window', 'closing'],
    ])
    Expect(manager.require(opened.sessionId).session.projectRoot).toBe('/projects/Closing')
    cleanup.resolve()

    Expect(await Promise.all([first, second])).toEqual([true, true])
    Expect(attempts).toBe(1)
    Expect(manager.list().current).toEqual([])
  })

  Test('closeAll leaves rejected cleanup owned and retries it without re-closing successful resources', async () => {
    const ids = ['retry_all', 'closed_once']
    let retryAttempts = 0
    let successfulAttempts = 0
    const manager = new StudioSessionManager({ createSessionId: () => ids.shift()! })
    manager.add({
      close: async () => {
        retryAttempts += 1
        if (retryAttempts === 1) {
          throw new Error('retry closeAll')
        }
      },
      session: { appName: 'Retry all', projectRoot: '/projects/RetryAll' } as StudioProjectSession,
    })
    manager.add({
      close: () => {
        successfulAttempts += 1
      },
      session: { appName: 'Closed once', projectRoot: '/projects/ClosedOnce' } as StudioProjectSession,
    })

    await Expect(manager.closeAll()).rejects.toThrow('retry closeAll')
    Expect(manager.list().current.map(item => [item.sessionId, item.status])).toEqual([['retry_all', 'open']])
    Expect(manager.list().recent.map(item => item.project)).toEqual([
      '/projects/ClosedOnce',
      '/projects/RetryAll',
    ])

    await manager.closeAll()
    Expect(retryAttempts).toBe(2)
    Expect(successfulAttempts).toBe(1)
    Expect(manager.list().current).toEqual([])
  })

  Test('rejects non-opaque session IDs and escapes Welcome project data', () => {
    const manager = new StudioSessionManager({ createSessionId: () => '../project/path' })
    Expect(() => manager.add(resource('/project', 'Garden', []))).toThrow('opaque identifier')

    const html = StudioWelcome.html({
      current: [{
        appName: '<Garden>',
        openedAt: 'now',
        project: '/tmp/<secret>',
        sessionId: 'safe_id',
        status: 'open',
      }],
      recent: [],
    })
    Expect(html).toContain('/sessions/safe_id')
    Expect(html).toContain('&lt;Garden&gt;')
    Expect(html).not.toContain('/tmp/<secret>')
  })
})

function resource(projectRoot: string, appName: string, closed: string[]): StudioSessionResource {
  return {
    close: () => {
      closed.push(projectRoot)
    },
    session: { appName, projectRoot } as StudioProjectSession,
  }
}

function clock(...values: string[]): () => Date {
  let index = 0
  return () => new Date(values[Math.min(index++, values.length - 1)]!)
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}
