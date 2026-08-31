import { Describe, Expect, Test } from '@shared/test'
import type { StudioProjectSession } from '../studio-src/StudioProjectSession'
import { StudioServerTesting } from '../studio-src/StudioServer'
import { StudioSessionManager } from '../studio-src/StudioSessionManager'

Describe('Studio server request boundary', () => {
  const boundOrigin = 'http://127.0.0.1:5678'

  Test('rejects a rebinding Host even when Origin agrees with the hostile host', () => {
    const requestUrl = new URL('http://hostile.example:5678/api/files')
    const request = new Request(requestUrl, { headers: { origin: requestUrl.origin } })

    Expect(StudioServerTesting.requestAllowed(request, requestUrl, boundOrigin, undefined)).toBe(false)
  })

  Test('accepts the bound origin and explicitly configured preview origins', () => {
    const requestUrl = new URL(`${boundOrigin}/api/files`)
    const sameOrigin = new Request(requestUrl, { headers: { origin: boundOrigin } })
    const previewOrigin = new Request(requestUrl, { headers: { origin: 'http://127.0.0.1:8081' } })

    Expect(StudioServerTesting.requestAllowed(sameOrigin, requestUrl, boundOrigin, undefined)).toBe(true)
    Expect(StudioServerTesting.requestAllowed(
      previewOrigin,
      requestUrl,
      boundOrigin,
      ['http://127.0.0.1:8081'],
    )).toBe(true)
  })

  Test('formats IPv4 and IPv6 bound origins without trusting the request Host', () => {
    Expect(StudioServerTesting.serverOrigin('http:', '127.0.0.1', 5678)).toBe(boundOrigin)
    Expect(StudioServerTesting.serverOrigin('http:', '::1', 5678)).toBe('http://[::1]:5678')
    Expect(StudioServerTesting.serverOrigin('http:', '127.0.0.1', 80)).toBe('http://127.0.0.1')
    Expect(StudioServerTesting.serverOrigin('https:', 'localhost', 443)).toBe('https://localhost')
  })
})

Test('Studio multi-session routes isolate opaque window IDs while legacy roots keep one default session', () => {
  Expect(StudioServerTesting.studioSessionRoute('/sessions/first_session/api/protocol', undefined)).toEqual({
    pathname: '/api/protocol',
    sessionId: 'first_session',
  })
  Expect(StudioServerTesting.studioSessionRoute('/sessions/second_session', undefined)).toEqual({
    pathname: '/',
    sessionId: 'second_session',
  })
  Expect(StudioServerTesting.studioSessionRoute('/api/protocol', undefined)).toBe(undefined)
  Expect(StudioServerTesting.studioSessionRoute('/api/protocol', 'legacy_session')).toEqual({
    pathname: '/api/protocol',
    sessionId: 'legacy_session',
  })
  Expect(StudioServerTesting.studioSessionRoute('/sessions/../api/protocol', undefined)).toBe(undefined)
})

Test('Studio server authorization binds each managed preview origin to its own session', () => {
  const ids = ['first_session', 'second_session']
  const manager = new StudioSessionManager({ createSessionId: () => ids.shift()! })
  const authorization = StudioServerTesting.originAuthorization(manager, ['https://static.preview'])

  Expect(authorization.allowedOrigins('not_open')).toEqual(['https://static.preview'])
  const first = manager.add({
    previewUrl: 'http://127.0.0.1:8081/index.html?project=first',
    session: { appName: 'First', projectRoot: '/projects/First' } as StudioProjectSession,
  })
  const second = manager.add({
    previewUrl: 'http://127.0.0.1:8082/index.html?project=second',
    session: { appName: 'Second', projectRoot: '/projects/Second' } as StudioProjectSession,
  })

  Expect(authorization.allowedOrigins(first.sessionId, '/api/preview/cell/bootstrap')).toEqual([
    'https://static.preview',
    'http://127.0.0.1:8081',
  ])
  Expect(authorization.allowedOrigins(second.sessionId, '/api/preview/cell/bootstrap')).toEqual([
    'https://static.preview',
    'http://127.0.0.1:8082',
  ])

  const serverOrigin = 'http://127.0.0.1:5678'
  const secondUrl = new URL(`${serverOrigin}/sessions/${second.sessionId}/api/files`)
  const firstPreviewToSecond = new Request(secondUrl, {
    headers: { origin: 'http://127.0.0.1:8081' },
  })
  Expect(StudioServerTesting.requestAllowed(
    firstPreviewToSecond,
    secondUrl,
    serverOrigin,
    authorization.allowedOrigins(second.sessionId, '/api/files'),
  )).toBe(false)
})

Test('Studio preview origins can reach only their preview bootstrap protocol', () => {
  const manager = new StudioSessionManager({ createSessionId: () => 'preview_session' })
  const authorization = StudioServerTesting.originAuthorization(manager, undefined)
  const session = manager.add({
    previewUrl: 'http://127.0.0.1:8081',
    session: { appName: 'Preview', projectRoot: '/projects/Preview' } as StudioProjectSession,
  })
  const allowed = [
    '/api/preview/instance',
    '/api/preview/applied',
    '/api/preview/cell',
    '/api/preview/cell/bootstrap',
    '/api/preview/cell/instance',
    '/api/preview/cell/reconfigure',
  ]
  const denied = [
    '/events',
    '/api/language/lsp',
    '/api/files',
    '/api/file/delete',
    '/api/source-action',
  ]

  for (const pathname of allowed) {
    Expect(authorization.allowedOrigins(session.sessionId, pathname)).toEqual(['http://127.0.0.1:8081'])
  }
  for (const pathname of denied) {
    Expect(authorization.allowedOrigins(session.sessionId, pathname)).toEqual([])
  }
})

Test('Studio manager endpoints accept same-origin and native requests but no preview origins', () => {
  const boundOrigin = 'http://127.0.0.1:5678'
  const sessionsUrl = new URL(`${boundOrigin}/api/sessions`)
  const previewRequest = new Request(sessionsUrl, { headers: { origin: 'http://127.0.0.1:8081' } })
  const sameOriginRequest = new Request(sessionsUrl, { headers: { origin: boundOrigin } })
  const nativeRequest = new Request(sessionsUrl)

  Expect(StudioServerTesting.managerRequestPath(sessionsUrl.pathname, true)).toBe(true)
  Expect(StudioServerTesting.managerRequestPath('/api/sessions/current_window/switch', true)).toBe(true)
  Expect(StudioServerTesting.requestAllowed(previewRequest, sessionsUrl, boundOrigin, [])).toBe(false)
  Expect(StudioServerTesting.requestAllowed(sameOriginRequest, sessionsUrl, boundOrigin, [])).toBe(true)
  Expect(StudioServerTesting.requestAllowed(nativeRequest, sessionsUrl, boundOrigin, [])).toBe(true)
})

Test('Studio test endpoints expose capability and structured project-owned runs', async () => {
  const run = {
    durationMs: 25,
    failed: 0,
    failures: [],
    finishedAt: '2026-08-30T12:00:00.000Z',
    id: 'run-1',
    output: 'Tests: 1 passed, 1 total',
    passed: 1,
    status: 'passed' as const,
    testFiles: ['Main.test.tao'],
  }
  const resource = {
    session: { appName: 'Tests', projectRoot: '/projects/Tests' } as StudioProjectSession,
    tests: {
      async close() {},
      async run() {
        return run
      },
      status() {
        return { available: true, running: false }
      },
    },
  }
  const url = new URL('http://127.0.0.1:5678/api/tests/run')
  const status = await StudioServerTesting.handleTestRequest(
    resource,
    new Request(url),
    url,
    {},
    '/api/tests/status',
  )
  const result = await StudioServerTesting.handleTestRequest(
    resource,
    new Request(url, { method: 'POST' }),
    url,
    {},
    '/api/tests/run',
  )

  Expect(await status?.json()).toEqual({ available: true, running: false })
  Expect(await result?.json()).toEqual(run)
})
