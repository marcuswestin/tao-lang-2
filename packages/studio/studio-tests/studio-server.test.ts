import { ScriptedGenerationProvider } from '@generation'
import { Errors } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'
import type { StudioDeviceLauncher } from '../studio-src/device/StudioDeviceLauncher'
import type { StudioDeviceStatus } from '../studio-src/device/StudioDeviceStatus'
import { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import {
  type StudioProjectSession,
  StudioSourceActionConflictError,
} from '../studio-src/StudioProjectSession'
import {
  startStudioSessionServer,
  type StudioServerDeviceGateway,
  type StudioServerOptions,
  StudioServerTesting,
} from '../studio-src/StudioServer'
import { StudioSessionManager, type StudioSessionResource } from '../studio-src/StudioSessionManager'

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

  Test('injects client revision polling only for development Studio servers', () => {
    const clientAssets = {
      async bundle() {
        return 'client'
      },
      html() {
        return '<html><body>Studio</body></html>'
      },
    }
    const production = StudioServerTesting.studioClientHtml({ clientAssets })
    const development = StudioServerTesting.studioClientHtml({
      clientAssets,
      clientReloadRevision: () => 7,
    })

    Expect(production).toBe('<html><body>Studio</body></html>')
    Expect(development).toContain("fetch('/studio-dev/revision', { cache: 'no-store' })")
    Expect(development).toContain('let revision = 7')
    Expect(development).toContain('window.location.reload()')
  })

  Test('serves injected availability and generated fixtures over the Studio HTTP surface', async () => {
    const manifest = generationManifest()
    const session = {
      previewManifest: () => manifest,
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const generation = new StudioFixtureGeneration(
      new ScriptedGenerationProvider([
        { kind: 'answer', value: { Title: 'A Realistic Workspace' } },
      ]),
    )
    const options = {}
    const availabilityUrl = new URL('http://127.0.0.1:5678/api/ai/availability')
    const fixtureUrl = new URL('http://127.0.0.1:5678/api/ai/fixture')
    const availability = await StudioServerTesting.handleRequest(
      session,
      generation,
      new Request(availabilityUrl),
      availabilityUrl,
      options,
    )
    const fixture = await StudioServerTesting.handleRequest(
      session,
      generation,
      new Request(fixtureUrl, {
        body: JSON.stringify({ scenarioId: 'Workspace.focused' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      fixtureUrl,
      options,
    )

    Expect(availability.status).toBe(200)
    Expect(await availability.json()).toEqual({ status: 'available' })
    Expect(fixture.status).toBe(200)
    Expect(await fixture.json()).toMatchObject({
      fixture: {
        creates: [{ entity: 'Workspace', fields: { Title: 'A Realistic Workspace' }, name: 'Main' }],
      },
      status: 'ready',
    })
  })

  Test('routes Move to package through the typed Studio file endpoint', async () => {
    const calls: unknown[] = []
    const session = {
      async moveGeneratedSource(request: unknown) {
        calls.push(request)
        return { conflicts: [], name: 'View1', status: 'confirmation-required', targetPackage: '@views' }
      },
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const url = new URL('http://127.0.0.1:5678/api/file/move-generated')
    const response = await StudioServerTesting.handleRequest(
      session,
      {} as StudioFixtureGeneration,
      new Request(url, {
        body: JSON.stringify({
          path: '@/studio/View1.tao',
          sourceVersion: 'text-v1:source',
          targetPackage: '@views',
          writeId: 'move-view-1',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      url,
      {},
    )

    Expect(response.status).toBe(200)
    Expect(calls).toEqual([{
      path: '@/studio/View1.tao',
      sourceVersion: 'text-v1:source',
      targetPackage: '@views',
      writeId: 'move-view-1',
    }])
  })

  Test('beta ships the active app through the injected shipping boundary', async () => {
    const ships: unknown[] = []
    const session = {
      appName: 'Garden',
      entryPath: '/projects/Garden/Garden.tao',
      projectRoot: '/projects/Garden',
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const url = new URL('http://127.0.0.1:5678/api/ship/beta')
    const response = await StudioServerTesting.handleRequest(
      session,
      {} as StudioFixtureGeneration,
      new Request(url, { method: 'POST' }),
      url,
      { shipBeta: async request => void ships.push(request) },
    )

    Expect(response.status).toBe(200)
    Expect(await response.json()).toEqual({
      appName: 'Garden',
      message: 'Garden was uploaded and distributed through TestFlight.',
    })
    Expect(ships).toEqual([{
      appName: 'Garden',
      entryPath: '/projects/Garden/Garden.tao',
      projectRoot: '/projects/Garden',
    }])
  })

  Test('returns the server-canonical source-action proposal without applying it', async () => {
    const requests: unknown[] = []
    const proposal = {
      content: 'fixture CapturedState { }\n',
      diff: '--- Garden.tao\n+++ Garden.tao (proposed)',
      edits: [{ end: 0, replacement: 'fixture CapturedState { }\n', start: 0 }],
      path: 'Garden.tao',
      proposedSourceVersion: 'source-proposed',
      requestId: 'proposal-request',
      sourceVersion: 'source-current',
    }
    const session = {
      async proposeSourceAction(request: unknown) {
        requests.push(request)
        return proposal
      },
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const url = new URL('http://127.0.0.1:5678/api/source-action/propose')
    const response = await StudioServerTesting.handleRequest(
      session,
      {} as StudioFixtureGeneration,
      new Request(url, {
        body: JSON.stringify({ requestId: 'proposal-request', type: 'source-action' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      url,
      {},
    )

    Expect(response.status).toBe(200)
    Expect(await response.json()).toEqual(proposal)
    Expect(requests).toEqual([{ requestId: 'proposal-request', type: 'source-action' }])
  })

  Test('returns stable structured source-action conflict details', async () => {
    const url = new URL('http://127.0.0.1:5678/api/source-action')
    const request = new Request(url, {
      body: JSON.stringify({ requestId: 'conflict-request', type: 'source-action' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const response = StudioServerTesting.errorResponse(
      request,
      url,
      {},
      new StudioSourceActionConflictError(
        'render-owner-mismatch',
        'Studio render owner changed.',
        { actual: 'Card', expected: 'Main', path: 'Garden.tao', renderId: 'render-1' },
      ),
    )

    Expect(response.status).toBe(409)
    Expect(await response.json()).toEqual({
      details: {
        actual: 'Card',
        code: 'render-owner-mismatch',
        expected: 'Main',
        path: 'Garden.tao',
        renderId: 'render-1',
      },
      error: 'Studio render owner changed.',
    })
  })
})

function generationManifest(): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 100, start: 0 } }
  return {
    capabilities: { captureDomains: ['data'], scheme: 'reactive-browser' },
    cells: [],
    compileRevision: 1,
    fixtures: [{
      fixtureId: 'fixture:WorkspaceState',
      label: 'WorkspaceState',
      plan: {
        accounts: [],
        creates: [{ entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' }],
      },
      source,
    }],
    generationDeclarations: [{
      collection: 'Workspaces',
      fields: [{ name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } }],
      kind: 'entity',
      name: 'Workspace',
    }],
    manifestRevision: 'compile:1',
    parametersBySubject: { 'view:Workspace': [] },
    project: { appName: 'WordFlower', entryPath: '/project/WordFlower.tao', root: '/project' },
    scenarios: [{
      args: {},
      fixtureId: 'fixture:WorkspaceState',
      group: 'Workspace',
      label: 'Workspace.focused',
      prepare: [],
      scenarioId: 'Workspace.focused',
      source,
      stateLayers: [],
      subjectId: 'view:Workspace',
    }],
    sourceVersions: { '/project/Scenarios.tao': 'text-v1:scenarios' },
    states: [],
    subjects: [{ kind: 'view', source, subjectId: 'view:Workspace', viewName: 'Workspace' }],
    version: 2,
  }
}

Test('Studio routes every session request through an opaque window ID and refuses unscoped paths', () => {
  Expect(StudioServerTesting.studioSessionRoute('/sessions/first_session/api/protocol')).toEqual({
    pathname: '/api/protocol',
    sessionId: 'first_session',
  })
  Expect(StudioServerTesting.studioSessionRoute('/sessions/second_session')).toEqual({
    pathname: '/',
    sessionId: 'second_session',
  })
  Expect(StudioServerTesting.studioSessionRoute('/api/protocol')).toBe(undefined)
  Expect(StudioServerTesting.studioSessionRoute('/sessions/../api/protocol')).toBe(undefined)
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

  Expect(StudioServerTesting.managerRequestPath(sessionsUrl.pathname)).toBe(true)
  Expect(StudioServerTesting.managerRequestPath('/api/sessions/current_window/switch')).toBe(true)
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

Test('Studio event sockets close cleanly when their initial handshake cannot be built', async () => {
  const closes: Array<[number, string]> = []
  const sent: string[] = []
  await StudioServerTesting.initializeEventSocket({
    close(code, reason) {
      closes.push([code ?? -1, reason ?? ''])
    },
    send(value) {
      sent.push(String(value))
      return 0
    },
  }, {
    async handshake() {
      Errors.throwUnexpected('File disappeared during handshake')
    },
  })

  Expect(sent).toEqual([])
  Expect(closes).toEqual([[1011, 'Could not initialize Studio events']])
})

Describe('Studio device routes', () => {
  const resource = {
    previewUrl: 'http://127.0.0.1:8081',
    session: { appName: 'Garden', projectRoot: '/projects/Garden' } as StudioProjectSession,
  }
  const status: StudioDeviceStatus = {
    gateway: { hosts: ['192.168.1.20'], port: 4747, studioFingerprint: 'abcd abcd abcd abcd' },
    pairing: { open: false },
    sessionId: 'device_session',
    trusted: [],
  }

  async function call(
    options: StudioServerOptions,
    pathname: string,
    body?: unknown,
    sessionResource: StudioSessionResource = resource,
  ): Promise<Response | undefined> {
    const url = new URL(`http://127.0.0.1:5678${pathname}`)
    const request = body === undefined
      ? new Request(url)
      : new Request(url, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    return await StudioServerTesting.handleDeviceRequest(
      'device_session',
      sessionResource,
      request,
      url,
      options,
      pathname,
    )
  }

  Test('answers 501 without a gateway, and for launch routes without a launcher', async () => {
    const withoutGateway = await call({}, '/api/device/status')
    Expect(withoutGateway?.status).toBe(501)
    Expect(await withoutGateway?.json()).toEqual({ error: 'This Studio service does not include the device gateway.' })
    const gateway = fakeGateway(status, [])
    const withoutLauncher = await call({ deviceGateway: gateway }, '/api/device/launch')
    Expect(withoutLauncher?.status).toBe(501)
    Expect(await withoutLauncher?.json()).toEqual({
      error: 'This Studio service does not include physical-device launch tooling.',
    })
    Expect(await call({}, '/api/preview/manifest')).toBeUndefined()
  })

  Test('maps every device route onto the gateway and launcher with the session id and Metro origin', async () => {
    const calls: unknown[] = []
    const gateway = fakeGateway(status, calls)
    const launchInfo = {
      bundleIdentifier: 'dev.tao-lang.studio.companion',
      candidates: ['192.168.1.20'],
      diagnostics: [],
      hosts: [{ id: 'dev-1', installed: true, kind: 'device' as const, name: 'roPhone' }],
      installCommand: 'just studio-companion-install',
      metroPort: 8081,
      scheme: 'taostudiocompanion',
      url: 'taostudiocompanion://expo-development-client/?url=http%3A%2F%2F192.168.1.20%3A8081',
    }
    const launcher: StudioDeviceLauncher = {
      async describe(input) {
        calls.push(['describe', input])
        return launchInfo
      },
      async open(input) {
        calls.push(['open', input])
        return { hostName: 'roPhone', launched: true, url: launchInfo.url }
      },
    }
    const options = { deviceGateway: gateway, deviceLauncher: launcher }
    const expected: Array<[string, unknown, unknown]> = [
      ['/api/device/status', undefined, status],
      ['/api/device/pairing/open', {}, { expiresAt: '2026-09-02T10:02:00.000Z' }],
      ['/api/device/pairing/confirm', { devicePublicKey: 'key-1' }, { accepted: true }],
      ['/api/device/pairing/decline', { devicePublicKey: 'key-2' }, { declined: true }],
      ['/api/device/revoke', { devicePublicKey: 'key-3' }, { revoked: true }],
      ['/api/device/reconnect', {}, { requested: true }],
      ['/api/device/select-cell', { cellId: 'cell:phone' }, { requested: true }],
      [
        '/api/device/capture',
        {},
        { capture: { domains: [{ domain: 'data', value: { workspaces: 1 } }], version: 1 } },
      ],
      ['/api/device/launch', undefined, launchInfo],
      ['/api/device/launch/open', { hostId: 'dev-1' }, { hostName: 'roPhone', launched: true, url: launchInfo.url }],
    ]
    for (const [pathname, body, result] of expected) {
      const response = await call(options, pathname, body)
      Expect([pathname, response?.status]).toEqual([pathname, 200])
      Expect([pathname, await response?.json()]).toEqual([pathname, result])
    }
    Expect(calls).toEqual([
      ['status', 'device_session'],
      ['openPairing', 'device_session'],
      ['confirmPairing', 'device_session', 'key-1'],
      ['declinePairing', 'device_session', 'key-2'],
      ['revoke', 'device_session', 'key-3'],
      ['requestReconnect', 'device_session'],
      ['selectCell', 'device_session', 'cell:phone'],
      ['captureRuntime', 'device_session'],
      ['describe', { metroOrigin: 'http://127.0.0.1:8081' }],
      // Wi-Fi is the default route; a body with no `route` still names one, so the launcher never
      // has to guess what an older client meant.
      ['open', { hostId: 'dev-1', metroOrigin: 'http://127.0.0.1:8081', route: 'auto' }],
    ])
    await Expect(call(options, '/api/device/pairing/confirm', {})).rejects.toThrow('device public key')
    await Expect(call(options, '/api/device/select-cell', { cellId: ' ' })).rejects.toThrow('cell id')
    await Expect(call(options, '/api/device/launch/open', {})).rejects.toThrow('host id')
    const noMetro = await call(options, '/api/device/launch', undefined, { session: resource.session })
    Expect(noMetro?.status).toBe(501)
    Expect((await call(options, '/api/device/unknown'))?.status).toBe(404)
  })

  Test('sends the device snapshot after the handshake and broadcasts every gateway change', async () => {
    const listeners = new Map<string, (status: StudioDeviceStatus) => void>()
    const gateway = {
      ...fakeGateway(status, []),
      subscribe(sessionId: string, listener: (status: StudioDeviceStatus) => void) {
        listeners.set(sessionId, listener)
        return () => listeners.delete(sessionId)
      },
    }
    const handshake = { channel: 'tao-studio', type: 'handshake' }
    const manager = new StudioSessionManager({ createSessionId: () => 'device_session' })
    manager.add({
      session: {
        appName: 'Garden',
        handshake: async () => handshake,
        projectRoot: '/projects/Garden',
        subscribe: () => () => {},
      } as unknown as StudioProjectSession,
    })
    const server = await startStudioSessionServer(manager, { compileOnStart: false, deviceGateway: gateway })
    try {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/sessions/device_session/events`)
      const messages: unknown[] = []
      socket.onmessage = event => messages.push(JSON.parse(String(event.data)))
      await new Promise<void>(resolve => {
        socket.onopen = () => resolve()
      })
      await until(() => messages.length >= 2, { description: 'the handshake and device snapshot' })
      Expect(messages).toEqual([
        handshake,
        { channel: 'tao-studio', protocolVersion: 1, status, type: 'device-state' },
      ])
      const connected: StudioDeviceStatus = {
        ...status,
        connection: {
          device: { model: 'iPhone17,1', name: 'roPhone', os: 'iOS 26' },
          fingerprint: 'ffff ffff ffff ffff',
          state: 'connected',
          transport: 'lan',
        },
      }
      listeners.get('device_session')!(connected)
      await until(() => messages.length >= 3, { description: 'the broadcast device state' })
      Expect(messages[2]).toEqual({
        channel: 'tao-studio',
        protocolVersion: 1,
        status: connected,
        type: 'device-state',
      })
      socket.close()
    } finally {
      server.stop()
    }
    Expect(listeners.size).toBe(0)
  })
})

function fakeGateway(status: StudioDeviceStatus, calls: unknown[]): StudioServerDeviceGateway {
  return {
    async captureRuntime(sessionId) {
      calls.push(['captureRuntime', sessionId])
      return { capture: { domains: [{ domain: 'data', value: { workspaces: 1 } }], version: 1 } }
    },
    async confirmPairing(sessionId, devicePublicKey) {
      calls.push(['confirmPairing', sessionId, devicePublicKey])
      return { accepted: true }
    },
    declinePairing(sessionId, devicePublicKey) {
      calls.push(['declinePairing', sessionId, devicePublicKey])
      return { declined: true }
    },
    highlightSource(sessionId, occurrence) {
      calls.push(['highlightSource', sessionId, occurrence])
      return { delivered: true }
    },
    openPairing(sessionId) {
      calls.push(['openPairing', sessionId])
      return { expiresAt: '2026-09-02T10:02:00.000Z' }
    },
    requestReconnect(sessionId) {
      calls.push(['requestReconnect', sessionId])
      return { requested: true }
    },
    async revoke(sessionId, devicePublicKey) {
      calls.push(['revoke', sessionId, devicePublicKey])
      return { revoked: true }
    },
    selectCell(sessionId, cellId) {
      calls.push(['selectCell', sessionId, cellId])
      return { requested: true }
    },
    status(sessionId) {
      calls.push(['status', sessionId])
      return status
    },
    subscribe() {
      return () => {}
    },
  }
}
