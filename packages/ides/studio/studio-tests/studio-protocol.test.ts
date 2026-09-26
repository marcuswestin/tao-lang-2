import { Describe, Expect, Test } from '@shared/test'
import {
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  StudioRoutes,
  studioSessionEndpoints,
  StudioSessionPath,
  type StudioSourceActionEnvelope,
  studioSourceActionVersion,
  StudioTransport,
} from '../studio-src/StudioProtocol'

Describe('Studio session paths and routes', () => {
  Test('accepts bounded Lens timing without exposing values or trusting malformed causes', () => {
    const message = {
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      sample: {
        actualDurationMs: 18.5,
        causes: [{ entity: 'Note', kind: 'data', providerWaitMs: 12.25, schema: 'Journal' }, { kind: 'state' }],
        identity: { end: 42, kind: 'render', ownerName: 'Root', sourcePath: '/project/Main.tao', start: 21 },
        instanceId: 'render-instance-1',
        phase: 'update',
        resolvedStyle: { color: 'rgb(3, 4, 5)', 'font-size': '18px' },
        sourceVersion: 'sha-1',
        timestamp: 1_788_100_000_000,
      },
      type: 'preview-lens-render',
    }
    Expect(StudioProtocol.parseMessage(message)).toMatchObject({ sample: message.sample, type: message.type })
    Expect(StudioProtocol.parseMessage({ ...message, sample: { ...message.sample, actualDurationMs: Number.NaN } }))
      .toBeUndefined()
    Expect(
      StudioProtocol.parseMessage({
        ...message,
        sample: {
          ...message.sample,
          causes: [{ kind: 'data', schema: 'Journal', entity: 'Note', value: 'private row' }],
        },
      }),
    )
      .toMatchObject({ sample: { causes: [{ entity: 'Note', kind: 'data', schema: 'Journal' }] } })
    Expect(
      StudioProtocol.parseMessage({
        ...message,
        sample: { ...message.sample, causes: [{ kind: 'data', schema: '', entity: 'Note' }] },
      }),
    )
      .toBeUndefined()
    Expect(
      StudioProtocol.parseMessage({
        ...message,
        sample: { ...message.sample, resolvedStyle: { content: 'private row' } },
      }),
    )
      .toBeUndefined()
  })

  Test('parses finite preview canvas gestures and rejects malformed geometry', () => {
    const gesture = {
      channel: studioProtocolChannel,
      clientX: 12,
      clientY: 24,
      deltaX: 3,
      deltaY: -8,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-canvas-gesture',
      zoom: true,
    }
    Expect(StudioProtocol.parseMessage(gesture)).toEqual({
      ...gesture,
      identity: {
        appName: identity.appName,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      },
    })
    Expect(StudioProtocol.parseMessage({ ...gesture, deltaY: Number.NaN })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...gesture, zoom: 'yes' })).toBeUndefined()
  })

  Test('accepts only authenticated preview Space transitions with an explicit boolean state', () => {
    const message = {
      channel: studioProtocolChannel,
      held: true,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-canvas-pan-key',
    }
    const event = { data: message, origin: expectation.origin, source: previewWindow }
    Expect(StudioProtocol.parseWindowMessage(event, expectation)).toMatchObject({ held: true, type: message.type })
    Expect(StudioProtocol.parseWindowMessage({ ...event, data: { ...message, held: false } }, expectation))
      .toMatchObject({ held: false, type: message.type })
    for (const held of ['true', 1, null, undefined]) {
      Expect(StudioProtocol.parseWindowMessage({ ...event, data: { ...message, held } }, expectation)).toBeUndefined()
    }
    Expect(StudioProtocol.parseWindowMessage({ ...event, source: {} }, expectation)).toBeUndefined()
    Expect(StudioProtocol.parseWindowMessage({ ...event, origin: 'https://untrusted.example' }, expectation))
      .toBeUndefined()
    Expect(StudioProtocol.parseWindowMessage({
      ...event,
      data: { ...message, identity: { ...identity, previewInstanceId: 'stale-preview' } },
    }, expectation)).toBeUndefined()
  })

  Test('accepts only authenticated known canvas shortcuts', () => {
    const message = {
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-canvas-shortcut',
      command: 'fit',
    }
    const event = { data: message, origin: expectation.origin, source: previewWindow }
    for (const command of ['fit', 'reset', 'zoom-in', 'zoom-out']) {
      Expect(StudioProtocol.parseWindowMessage({ ...event, data: { ...message, command } }, expectation)).toMatchObject(
        { command },
      )
    }
    for (const command of ['delete', '', null, 1]) {
      Expect(StudioProtocol.parseMessage({ ...message, command })).toBeUndefined()
    }
    Expect(StudioProtocol.parseWindowMessage({ ...event, source: {} }, expectation)).toBeUndefined()
    Expect(StudioProtocol.parseWindowMessage({ ...event, origin: 'https://untrusted.example' }, expectation))
      .toBeUndefined()
  })

  Test('parses explicit parent canvas-gesture ownership and rejects ambiguous state', () => {
    const ownership = {
      channel: studioProtocolChannel,
      identity,
      owned: true,
      protocolVersion: studioProtocolVersion,
      type: 'set-canvas-gestures',
    }
    Expect(StudioProtocol.parseMessage(ownership)).toEqual({
      ...ownership,
      identity: {
        appName: identity.appName,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      },
    })
    Expect(StudioProtocol.parseMessage({ ...ownership, owned: 'design' })).toBeUndefined()
  })

  Test('preserves runtime-capture error taxonomy across the preview protocol', () => {
    const failure = {
      channel: studioProtocolChannel,
      error: 'The captured row is invalid.',
      errorName: 'UserInputError',
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'capture-1',
      type: 'preview-runtime-capture-failed',
    }
    Expect(StudioProtocol.parseMessage(failure)).toMatchObject({
      error: failure.error,
      errorName: 'UserInputError',
      type: failure.type,
    })
    Expect(StudioProtocol.parseMessage({ ...failure, errorName: 'Error' })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...failure, errorName: undefined })).toBeUndefined()
  })

  Test('scopes every session endpoint under one opaque window id and refuses anything else', () => {
    Expect(StudioSessionPath.route('/sessions/first_session/api/protocol')).toEqual({
      pathname: '/api/protocol',
      sessionId: 'first_session',
    })
    Expect(StudioSessionPath.route('/sessions/second_session')).toEqual({ pathname: '/', sessionId: 'second_session' })
    Expect(StudioSessionPath.route('/api/protocol')).toBe(undefined)
    Expect(StudioSessionPath.route('/sessions/../api/protocol')).toBe(undefined)
    Expect(StudioSessionPath.sessionIdOf('/sessions/window_one/')).toBe('window_one')
    Expect(StudioSessionPath.sessionIdOf('/')).toBe(undefined)
    Expect(StudioSessionPath.isWindowRoot('/sessions/window_one')).toBe(true)
    Expect(StudioSessionPath.isWindowRoot('/sessions/window_one/api/files')).toBe(false)
    Expect(StudioSessionPath.isValidSessionId('window-1')).toBe(true)
    Expect(StudioSessionPath.isValidSessionId('a'.repeat(129))).toBe(false)
    Expect(StudioSessionPath.isValidSessionId('../escape')).toBe(false)
    Expect(StudioSessionPath.endpoint('window_one', StudioRoutes.session.files.path))
      .toBe('/sessions/window_one/api/files')
  })

  Test('parses debugger events and commands, and refuses malformed ones', () => {
    const cellIdentity = {
      ...identity,
      cellId: 'cell-phone',
      cellRevision: 2,
      compileRevision: 7,
      manifestRevision: 'm-7',
    }
    const event = {
      channel: studioProtocolChannel,
      event: { kind: 'paused', pause: { frames: ['Bump'], step: { action: 'Bump', path: '1' } } },
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-debug',
    }
    const configure = {
      actions: ['Bump'],
      channel: studioProtocolChannel,
      command: 'configure',
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      steps: [{ action: 'Bump', path: '0' }],
      type: 'debug-command',
    }
    const step = { ...configure, actions: undefined, command: 'step-over', steps: undefined }

    Expect(StudioProtocol.parseMessage(event)).toMatchObject({ event: event.event, type: 'preview-debug' })
    Expect(StudioProtocol.parseMessage(configure)).toMatchObject({
      actions: ['Bump'],
      command: 'configure',
      steps: [{ action: 'Bump', path: '0' }],
    })
    const canonicalStep = {
      action: 'Bump',
      declaration: '["tao.declaration",1,"project","@workspace","Main","view","Root"]',
      path: '0',
      statement: 'block.statements[1].block.statements[0]',
    }
    Expect(StudioProtocol.parseMessage({ ...configure, steps: [canonicalStep] })).toMatchObject({
      steps: [canonicalStep],
    })
    Expect(StudioProtocol.parseMessage(step)).toMatchObject({ command: 'step-over' })
    Expect(StudioProtocol.parseMessage({ ...step, command: 'break' })).toMatchObject({ command: 'break' })
    Expect(StudioProtocol.parseMessage({ ...configure, command: 'evaluate' })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...configure, steps: [{ action: 'Bump' }] })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...configure, steps: [{ ...canonicalStep, statement: undefined }] }))
      .toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...configure, identity: { appName: 'Garden' } })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...event, event: () => undefined })).toBeUndefined()
  })

  Test('matches and fills parameterised routes with the session id grammar', () => {
    const manager = StudioRoutes.manager
    Expect(StudioRoutes.match(manager.switchSession, '/api/sessions/current_window/switch'))
      .toEqual({ sessionId: 'current_window' })
    Expect(StudioRoutes.match(manager.switchSession, '/api/sessions/../switch')).toBe(undefined)
    Expect(StudioRoutes.match(manager.closeSession, '/api/sessions/current_window/switch')).toBe(undefined)
    Expect(StudioRoutes.match(StudioRoutes.session.agentChatStream, '/api/agent-chat/stream/send'))
      .toEqual({ command: 'send' })
    Expect(StudioRoutes.match(StudioRoutes.session.agentChat, '/api/agent-chat/send/another')).toBe(undefined)
    Expect(StudioRoutes.match(StudioRoutes.session.agentChat, '/api/agent-chat/send%2Fanother'))
      .toEqual({ command: 'send/another' })
    Expect(StudioRoutes.matchesRequest(StudioRoutes.session.agentChat, 'GET', '/api/agent-chat/send')).toBe(false)
    Expect(StudioRoutes.matchesRequest(StudioRoutes.session.agentChat, 'POST', '/api/agent-chat/send')).toBe(true)
    Expect(StudioRoutes.match(StudioRoutes.session.files, '/api/files')).toEqual({})
    Expect(StudioRoutes.match(StudioRoutes.session.files, '/api/files/')).toBe(undefined)
    Expect(StudioRoutes.matchesRequest(StudioRoutes.session.files, 'GET', '/api/files')).toBe(true)
    Expect(StudioRoutes.matchesRequest(StudioRoutes.session.files, 'POST', '/api/files')).toBe(false)
    Expect(StudioRoutes.path(manager.closeSession, { sessionId: 'window one' }))
      .toBe('/api/sessions/window%20one/close')
    Expect(StudioRoutes.path(StudioRoutes.session.agentChat, { command: 'mode' })).toBe('/api/agent-chat/mode')
    Expect(StudioRoutes.path(StudioRoutes.session.files)).toBe('/api/files')
    Expect(() => StudioRoutes.path(manager.closeSession)).toThrow('sessionId')
  })

  Test('advertises every session route exactly once in the handshake', () => {
    const advertised = studioSessionEndpoints.map(route => `${route.method} ${route.path}`)
    Expect(advertised).toContain('WS /events')
    Expect(advertised).toContain('POST /api/source-action/undo')
    Expect(new Set(advertised).size).toBe(Object.keys(StudioRoutes.session).length)
    Expect(advertised.length).toBe(Object.keys(StudioRoutes.session).length)
  })

  Test('unwraps JSON replies and upgrades page URLs to the matching socket scheme', async () => {
    Expect(StudioTransport.webSocketUrl('/sessions/w/events', 'https://studio.local/sessions/w'))
      .toBe('wss://studio.local/sessions/w/events')
    Expect(StudioTransport.webSocketUrl('/events', 'http://127.0.0.1:4276/')).toBe('ws://127.0.0.1:4276/events')
    Expect(StudioTransport.jsonPostInit({ a: 1 })).toEqual({
      body: '{"a":1}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    Expect(await StudioTransport.readJsonReply(new Response(JSON.stringify({ ok: 1 }))))
      .toEqual({ body: { ok: 1 }, ok: true, status: 200 })
    const conflict = new Response(JSON.stringify({ details: { code: 'conflict' }, error: 'Nope.' }), { status: 409 })
    Expect(await StudioTransport.readJsonReply(conflict))
      .toEqual({ details: { code: 'conflict' }, error: 'Nope.', ok: false, status: 409 })
    Expect(await StudioTransport.readJsonReply(new Response('"text"', { status: 500 }))).toEqual({
      ok: false,
      status: 500,
    })
  })
})

const previewWindow = {}
const identity = {
  appName: 'Garden',
  path: 'Apps/Garden/Garden.tao',
  previewInstanceId: 'preview-2',
  project: '/workspace/garden',
  sourceVersion: 'sha256:source-7',
} as const
const expectation = {
  appName: identity.appName,
  origin: 'http://127.0.0.1:56102',
  previewInstanceId: identity.previewInstanceId,
  project: identity.project,
  source: previewWindow,
} as const

Describe('Studio protocol v1', () => {
  Test('validates exact-cell journey recording commands and ordered semantic replies', () => {
    const cellIdentity = {
      ...identity,
      cellId: 'cell-phone',
      cellRevision: 2,
      compileRevision: 7,
      manifestRevision: 'manifest-7',
    }
    const control = {
      active: true,
      channel: studioProtocolChannel,
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      recordingId: 'recording-1',
      type: 'set-journey-recording',
    }
    const recorded = {
      channel: studioProtocolChannel,
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      recordingId: 'recording-1',
      sequence: 1,
      step: { kind: 'enter', redacted: true, selector: 'label', target: 'Password', value: '' },
      type: 'preview-journey-step-recorded',
    }
    const settled = {
      channel: studioProtocolChannel,
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-journey-replay-settled',
    }
    const failed = { ...settled, error: 'Save button was not found.', type: 'preview-journey-replay-failed' }

    Expect(StudioProtocol.parseMessage(control)).toMatchObject({ active: true, recordingId: 'recording-1' })
    Expect(StudioProtocol.parseMessage(recorded)).toMatchObject({ sequence: 1, step: recorded.step })
    Expect(StudioProtocol.parseMessage(settled)).toMatchObject({ type: 'preview-journey-replay-settled' })
    Expect(StudioProtocol.parseMessage(failed)).toMatchObject({
      error: 'Save button was not found.',
      type: 'preview-journey-replay-failed',
    })
    Expect(StudioProtocol.parseMessage({ ...control, identity })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...recorded, sequence: 0 })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...settled, identity })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...failed, error: '' })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({ ...recorded, step: { ...recorded.step, redacted: undefined } }))
      .toBeUndefined()
    Expect(StudioProtocol.parseMessage({
      ...recorded,
      step: {
        action: 'press',
        kind: 'unresolved',
        reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.',
      },
    })).toMatchObject({ step: { action: 'press', kind: 'unresolved' } })
  })

  Test('parses signed preview positions with nonnegative sizes and rejects invalid geometry', () => {
    const message = {
      channel: studioProtocolChannel,
      identity,
      measurements: [{
        elementName: 'Text',
        rect: { height: 40, width: 80, x: 15, y: 20 },
        renderId: '/workspace/garden/Main.tao:10:20',
        studioRectId: 'art',
      }],
      protocolVersion: studioProtocolVersion,
      type: 'preview-layout-measurements',
    }

    Expect(StudioProtocol.parseMessage(message)).toMatchObject({
      measurements: message.measurements,
      type: 'preview-layout-measurements',
    })
    const viewportRect = { x: -10, y: -20, width: 80, height: 40 }
    Expect(StudioProtocol.parseMessage({ ...message, measurements: [{ ...message.measurements[0], viewportRect }] }))
      .toMatchObject({ measurements: [{ viewportRect }] })
    for (const bad of [{ ...viewportRect, x: NaN }, { ...viewportRect, width: -1 }, 'rect']) {
      Expect(
        StudioProtocol.parseMessage({ ...message, measurements: [{ ...message.measurements[0], viewportRect: bad }] }),
      ).toBeUndefined()
    }
    Expect(StudioProtocol.parseMessage({
      ...message,
      measurements: [{ ...message.measurements[0], rect: { height: -1, width: 80, x: 15, y: 20 } }],
    })).toBeUndefined()
    Expect(StudioProtocol.parseMessage({
      ...message,
      measurements: [{ ...message.measurements[0], rect: { height: Number.NaN, width: 80, x: 1, y: 20 } }],
    })).toBeUndefined()
  })
  Test('parses revision and source identity messages from the expected preview origin', () => {
    const applied = StudioProtocol.parseWindowMessage({
      data: {
        appliedRevision: 4,
        channel: studioProtocolChannel,
        compileRevision: 4,
        identity,
        protocolVersion: studioProtocolVersion,
        type: 'preview-applied',
      },
      origin: expectation.origin,
      source: previewWindow,
    }, expectation)
    const selected = StudioProtocol.parseWindowMessage({
      data: {
        channel: studioProtocolChannel,
        identity,
        protocolVersion: studioProtocolVersion,
        range: { end: 25, start: 10 },
        type: 'preview-select-source',
      },
      origin: expectation.origin,
      source: previewWindow,
    }, expectation)

    Expect(applied?.type).toBe('preview-applied')
    Expect(applied?.identity.previewInstanceId).toBe('preview-2')
    Expect(selected?.type).toBe('preview-select-source')
    Expect(selected?.type === 'preview-select-source' ? selected.identity.sourceVersion : undefined)
      .toBe('sha256:source-7')
  })

  Test('rejects untrusted origins, windows, project identities, and preview instances', () => {
    const message = {
      appliedRevision: 4,
      channel: studioProtocolChannel,
      compileRevision: 4,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    }
    const parse = (overrides: Record<string, unknown>, expected = expectation) =>
      StudioProtocol.parseWindowMessage({
        data: { ...message, ...overrides },
        origin: expectation.origin,
        source: previewWindow,
      }, expected)

    Expect(StudioProtocol.parseWindowMessage({
      data: message,
      origin: 'https://attacker.invalid',
      source: previewWindow,
    }, expectation)).toBe(undefined)
    Expect(StudioProtocol.parseWindowMessage({
      data: message,
      origin: expectation.origin,
      source: {},
    }, expectation)).toBe(undefined)
    Expect(parse({ identity: { ...identity, project: '/other' } })).toBe(undefined)
    Expect(parse({ identity: { ...identity, appName: 'Other' } })).toBe(undefined)
    Expect(parse({ identity: { ...identity, previewInstanceId: 'stale-preview' } })).toBe(undefined)
  })

  Test('requires matching finite revisions and valid source ranges', () => {
    const event = (data: unknown) => ({ data, origin: expectation.origin, source: previewWindow })
    const applied = (compileRevision: unknown, appliedRevision: unknown) => ({
      appliedRevision,
      channel: studioProtocolChannel,
      compileRevision,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-applied',
    })

    Expect(StudioProtocol.parseWindowMessage(event(applied(3, 2)), expectation)).toBe(undefined)
    Expect(StudioProtocol.parseWindowMessage(event(applied(Number.NaN, Number.NaN)), expectation)).toBe(undefined)
    Expect(StudioProtocol.parseWindowMessage(
      event({
        channel: studioProtocolChannel,
        identity,
        protocolVersion: studioProtocolVersion,
        range: { end: 5, start: 6 },
        type: 'preview-hover-source',
      }),
      expectation,
    )).toBe(undefined)
  })

  Test('preserves complete matrix-cell identity and rejects partial cell identity', () => {
    const cellIdentity = {
      ...identity,
      cellId: 'cell:phone',
      cellRevision: 2,
      compileRevision: 7,
      manifestRevision: 'manifest-7',
    }
    const message = {
      channel: studioProtocolChannel,
      identity: cellIdentity,
      protocolVersion: studioProtocolVersion,
      range: { end: 25, start: 10 },
      type: 'preview-select-source',
    }

    Expect(StudioProtocol.parseMessage(message)?.identity).toEqual(cellIdentity)
    Expect(StudioProtocol.parseMessage({
      ...message,
      identity: { ...identity, cellId: 'cell:phone' },
    })).toBe(undefined)
  })

  Test('accepts only complete runtime Scheme resolutions', () => {
    const message = {
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      scheme: {
        capability: 'reactive-browser',
        requested: 'system',
        resolved: 'dark',
        source: 'system',
      },
      type: 'preview-scheme-changed',
    }

    Expect(StudioProtocol.parseMessage(message)).toMatchObject({
      scheme: message.scheme,
      type: 'preview-scheme-changed',
    })
    Expect(StudioProtocol.parseMessage({
      ...message,
      scheme: { ...message.scheme, resolved: 'sepia' },
    })).toBe(undefined)
    Expect(StudioProtocol.parseMessage({
      ...message,
      scheme: {
        capability: 'fixed-light-native',
        requested: 'dark',
        resolved: 'dark',
        source: 'native-fixed',
      },
    })).toBe(undefined)
  })

  Test('validates captured fixture replies at the untrusted preview boundary', () => {
    const message = {
      channel: studioProtocolChannel,
      fixture: {
        accounts: [],
        creates: [{ entity: 'Story', fields: { Title: 'Captured' }, name: 'Story1' }],
      },
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'capture-1',
      type: 'preview-fixture-captured',
    }
    Expect(StudioProtocol.parseWindowMessage({
      data: message,
      origin: expectation.origin,
      source: previewWindow,
    }, expectation)).toMatchObject({
      channel: studioProtocolChannel,
      fixture: message.fixture,
      identity: {
        appName: identity.appName,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
      },
      requestId: 'capture-1',
      type: 'preview-fixture-captured',
    })
    Expect(StudioProtocol.parseMessage({
      ...message,
      fixture: { ...message.fixture, creates: [{ ...message.fixture.creates[0], fields: { Bad: null } }] },
    })).toBe(undefined)
    const authenticatedFixture = {
      ...message.fixture,
      accounts: [{ name: 'Alice', fields: { DisplayName: 'Alice' } }],
      signedIn: 'Alice',
      creates: [{ ...message.fixture.creates[0], account: 'Alice' }],
    }
    Expect(StudioProtocol.parseMessage({ ...message, fixture: authenticatedFixture })).toMatchObject({
      fixture: authenticatedFixture,
    })
    Expect(StudioProtocol.parseMessage({ ...message, fixture: { ...authenticatedFixture, signedIn: 1 } })).toBe(
      undefined,
    )
    Expect(StudioProtocol.parseMessage({
      ...message,
      fixture: { ...authenticatedFixture, creates: [{ ...authenticatedFixture.creates[0], account: '' }] },
    })).toBe(undefined)
  })

  Test('validates versioned runtime failure captures and rejects unsafe or duplicate domains', () => {
    const capture = {
      capturedAt: 1_788_100_000_000,
      domains: [
        { domain: 'action-history', value: [{ action: 'Save', outcome: 'failed' }], version: 1 },
        { domain: 'data', value: { snapshots: { notes: '{"rows":{}}' } }, version: 1 },
        { domain: 'persisted-state', value: { split: 280 }, version: 1 },
      ],
      failure: {
        boundaryId: 'screen:Recipe',
        error: { message: 'Recipe failed', name: 'Error' },
        frame: {
          arguments: { Recipe: '42' },
          boundary: 'screen',
          declaration: 'Recipe',
          source: { end: 42, path: '/workspace/Garden.tao', start: 20 },
        },
        retryEligible: true,
        stopper: false,
        timestamp: 1_788_100_000_000,
      },
      version: 1,
    } as const
    const message = {
      capture,
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      type: 'preview-runtime-failure',
    }

    Expect(StudioProtocol.parseWindowMessage({
      data: message,
      origin: expectation.origin,
      source: previewWindow,
    }, expectation)).toMatchObject({ capture, type: 'preview-runtime-failure' })
    Expect(StudioProtocol.parseRuntimeCapture({
      ...capture,
      domains: [...capture.domains, capture.domains[0]],
    })).toBe(undefined)
    Expect(StudioProtocol.parseRuntimeCapture({
      ...capture,
      domains: [{ domain: 'credentials', value: () => 'secret', version: 1 }],
    })).toBe(undefined)
    Expect(StudioProtocol.parseMessage({ ...message, capture: { ...capture, version: 2 } })).toBe(undefined)
  })

  Test('validates live runtime captures and bounded console messages', () => {
    const capture = {
      capturedAt: 1_788_100_000_000,
      domains: [{ domain: 'data', value: { entries: [] }, version: 1 }],
      version: 1,
    } as const
    Expect(StudioProtocol.parseMessage({
      capture,
      channel: studioProtocolChannel,
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'runtime-1',
      type: 'preview-runtime-captured',
    })).toMatchObject({ capture, requestId: 'runtime-1', type: 'preview-runtime-captured' })
    Expect(StudioProtocol.parseMessage({
      arguments: ['loaded', { count: 2 }],
      channel: studioProtocolChannel,
      identity,
      level: 'info',
      protocolVersion: studioProtocolVersion,
      timestamp: 42,
      type: 'preview-console',
    })).toMatchObject({ arguments: ['loaded', { count: 2 }], level: 'info', type: 'preview-console' })
    Expect(StudioProtocol.parseMessage({
      arguments: [() => 'not JSON'],
      channel: studioProtocolChannel,
      identity,
      level: 'info',
      protocolVersion: studioProtocolVersion,
      timestamp: 42,
      type: 'preview-console',
    })).toBe(undefined)
  })

  Test('parses the canonical versioned source-action envelope and rejects non-JSON actions', () => {
    const envelope: StudioSourceActionEnvelope = {
      action: {
        entry: ['gap', 12],
        kind: 'set-layout-entry',
        metadata: { interaction: 'handle-drag' },
        renderId: 'render-1',
      },
      channel: studioProtocolChannel,
      checkpoint: { id: 'layout-drag-3', phase: 'commit' },
      identity: {
        ...identity,
        occurrence: { nodeKind: 'render', renderOwner: 'Garden' },
      },
      protocolVersion: studioProtocolVersion,
      requestId: 'request-9',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action',
    }

    Expect(StudioProtocol.parseSourceActionEnvelope(envelope)).toEqual(envelope)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      sourceActionVersion: 1,
    })).toBe(undefined)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      action: { kind: 'bad', value: () => undefined },
    })).toBe(undefined)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      checkpoint: { id: 'layout-drag-3', phase: 'later' },
    })).toBe(undefined)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      identity: { ...envelope.identity, occurrence: { nodeKind: '', renderOwner: 'Garden' } },
    })).toBe(undefined)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      identity: { ...envelope.identity, occurrence: { nodeKind: 'render', renderOwner: 42 } },
    })).toBe(undefined)
    Expect(StudioProtocol.parseSourceActionEnvelope({
      ...envelope,
      identity: { ...envelope.identity, scenarioId: '' },
    })).toBe(undefined)

    const undo = {
      channel: studioProtocolChannel,
      checkpointId: envelope.checkpoint.id,
      identity,
      protocolVersion: studioProtocolVersion,
      requestId: 'undo-9',
      sourceActionVersion: studioSourceActionVersion,
      type: 'source-action-undo',
    } as const
    Expect(StudioProtocol.parseSourceActionUndoEnvelope(undo)).toEqual(undo)
  })

  Test('derives an exact postMessage origin only from an absolute network URL', () => {
    Expect(StudioProtocol.messageOrigin('https://studio.test:444/preview?case=phone')).toBe('https://studio.test:444')
    Expect(StudioProtocol.messageOrigin('/preview')).toBe(undefined)
    Expect(StudioProtocol.messageOrigin('data:text/plain,preview')).toBe(undefined)
  })
})
