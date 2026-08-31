import { Describe, Expect, Test } from '@shared/test'
import {
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioSourceActionEnvelope,
  studioSourceActionVersion,
} from '../studio-src/StudioProtocol'

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
