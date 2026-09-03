import { Describe, Expect, MockModule, reactNativeStubs, Test } from '@shared/test'
import type { StudioDeviceClient, TaoStudioDeviceClientState } from '../TaoRuntime-src/TR-studio-device-client'
import type { TaoStudioDeviceCellIdentity } from '../TaoRuntime-src/TR-studio-device-protocol'
import { StudioDeviceTrust } from '../TaoRuntime-src/TR-studio-device-trust'

const scriptURL = 'http://192.168.1.20:8081/index.bundle?platform=ios&dev=true&hot=false'
const secureStoreValues = new Map<string, string>()
const openedSockets: FakeWebSocket[] = []

/** A WebSocket the transport adapter drives; a test plays the server through its handlers. */
class FakeWebSocket {
  closed: { code?: number; reason?: string } | undefined
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: (() => void) | null = null
  readonly sent: string[] = []

  constructor(readonly url: string) {
    openedSockets.push(this)
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason }
  }

  send(data: string): void {
    this.sent.push(data)
  }
}

MockModule('react-native', () =>
  reactNativeStubs({
    NativeModules: { SourceCode: { scriptURL } },
    Platform: {
      OS: 'ios',
      Version: '26.0',
      constants: { interfaceIdiom: 'phone', osVersion: '26.0', systemName: 'iOS' },
    },
  }))
MockModule('expo-constants', () => ({
  default: {
    deviceName: 'roPhone',
    expoConfig: {
      extra: { taoStudioDevice: { gatewayPort: 8790, protocol: 'tao-studio-device-v1' } },
      version: '1.0.0',
    },
  },
}))
MockModule('expo-secure-store', () => ({
  deleteItemAsync: async (key: string) => {
    secureStoreValues.delete(key)
  },
  getItemAsync: async (key: string) => secureStoreValues.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secureStoreValues.set(key, value)
  },
}))

const {
  badgeDragBounds,
  cellIdentityKey,
  clampBadgePosition,
  createNativeStudioDeviceClient,
  describeDevice,
  deviceHostPresentation,
  parseScriptUrl,
  parseStoredRecord,
  resolveDeviceBootstrap,
  secureStoreStorage,
  shouldAcknowledgeCell,
  studioDeviceAppStateAction,
  webSocketTransport,
} = await import('../TaoRuntime-src/TR-studio-device-host')

const device = { model: 'iOS phone', name: 'roPhone', os: 'iOS 26.0' }
const publication = { appName: 'Demo', compileRevision: 7, project: '/project', sourceVersions: {} }

const identity: TaoStudioDeviceCellIdentity = {
  appName: 'Demo',
  cellId: 'states#cell',
  cellRevision: 2,
  compileRevision: 7,
  manifestRevision: 'compile:7',
  previewInstanceId: 'instance-1',
}

function state(overrides: Partial<TaoStudioDeviceClientState> = {}): TaoStudioDeviceClientState {
  return { attempts: 0, phase: 'idle', transport: 'lan', ...overrides }
}

Describe('Studio device host bootstrap', () => {
  Test('reads the Metro host and port out of the bundle URL', () => {
    Expect(parseScriptUrl(scriptURL)).toEqual({ host: '192.168.1.20', port: 8081 })
    Expect(parseScriptUrl('http://[fe80::1]:8081/index.bundle')).toEqual({ host: '[fe80::1]', port: 8081 })
    Expect(parseScriptUrl('http://studio.local/index.bundle')).toEqual({ host: 'studio.local' })
    Expect(parseScriptUrl('file:///var/containers/main.jsbundle')).toBeUndefined()
    Expect(parseScriptUrl('not a url')).toBeUndefined()
    Expect(parseScriptUrl(undefined)).toBeUndefined()
  })

  Test('derives the gateway candidate from the bundle host and the manifest port', () => {
    Expect(resolveDeviceBootstrap({ device, gatewayPort: 8790, scriptURL })).toEqual({
      bootstrap: { candidates: ['ws://192.168.1.20:8790/device'], device, metroPort: 8081 },
      kind: 'ready',
    })
    Expect(resolveDeviceBootstrap({ device, gatewayPort: 8790, scriptURL: 'http://10.0.0.9/bundle' })).toEqual({
      bootstrap: { candidates: ['ws://10.0.0.9:8790/device'], device },
      kind: 'ready',
    })
  })

  Test('names every missing bootstrap fact instead of dialing nowhere', () => {
    Expect(resolveDeviceBootstrap({ device, gatewayPort: undefined, scriptURL: undefined })).toEqual({
      kind: 'missing',
      missing: [
        'the bundle URL (NativeModules.SourceCode.scriptURL) is unavailable',
        'the gateway port (expo.extra.taoStudioDevice.gatewayPort) is missing from the Expo manifest',
      ],
    })
    Expect(resolveDeviceBootstrap({ device, gatewayPort: '8790', scriptURL })).toEqual({
      kind: 'missing',
      missing: ['the gateway port (expo.extra.taoStudioDevice.gatewayPort) is missing from the Expo manifest'],
    })
    Expect(resolveDeviceBootstrap({ device, gatewayPort: 8790, scriptURL: 'garbage' })).toEqual({
      kind: 'missing',
      missing: ["the bundle URL 'garbage' names no host"],
    })
  })

  Test('describes the device from React Native and Expo facts with plain fallbacks', () => {
    Expect(describeDevice(
      { OS: 'ios', Version: '26.0', constants: { interfaceIdiom: 'phone', osVersion: '26.0', systemName: 'iOS' } },
      { deviceName: 'roPhone', expoConfig: { version: '1.0.0' } },
    )).toEqual({ appVersion: '1.0.0', model: 'iOS phone', name: 'roPhone', os: 'iOS 26.0' })
    Expect(describeDevice({ OS: 'android', Version: 35 }, undefined)).toEqual({
      model: 'android',
      name: 'iPhone',
      os: 'android 35',
    })
    Expect(describeDevice(undefined, undefined)).toEqual({ model: 'unknown', name: 'iPhone', os: 'unknown' })
  })

  Test('wires a native client from the mocked bundle URL, manifest, keychain, and socket', async () => {
    const platform = globalThis as { WebSocket?: unknown }
    const realWebSocket = platform.WebSocket
    platform.WebSocket = FakeWebSocket
    let client: StudioDeviceClient
    try {
      const resolution = createNativeStudioDeviceClient()
      Expect(resolution.kind).toBe('ready')
      client = (resolution as { client: StudioDeviceClient }).client
      await client.start()
    } finally {
      platform.WebSocket = realWebSocket
    }
    Expect(openedSockets.map(socket => socket.url)).toEqual(['ws://192.168.1.20:8790/device'])
    Expect(client.state().phase).toBe('connecting')
    Expect(client.state().host).toBe('192.168.1.20:8790')
    const stored = parseStoredRecord(secureStoreValues.get('tao-studio-device-v1') ?? '')
    Expect(stored?.identity.publicKey).toBeDefined()
    Expect(client.state().deviceFingerprint).toBe(StudioDeviceTrust.fingerprint(stored!.identity.publicKey))

    openedSockets[0]!.onopen?.()
    Expect(client.state().phase).toBe('handshaking')
    const hello = JSON.parse(openedSockets[0]!.sent[0] ?? 'null') as Record<string, unknown>
    Expect(hello['type']).toBe('device.hello')
    Expect(hello['metroPort']).toBe(8081)
    Expect(hello['device']).toEqual({ appVersion: '1.0.0', model: 'iOS phone', name: 'roPhone', os: 'iOS 26.0' })
    client.stop()
    Expect(openedSockets[0]!.closed?.code).toBe(1000)
  })
})

Describe('Studio device host presentation', () => {
  Test('shows a named overlay for every phase before a cell can render', () => {
    Expect(deviceHostPresentation(state(), publication)).toMatchObject({
      actions: ['reconnect'],
      kind: 'overlay',
      reason: 'idle',
    })
    Expect(deviceHostPresentation(state({ host: '192.168.1.20:8790', phase: 'connecting' }), publication))
      .toMatchObject({
        actions: [],
        message: 'Reaching Tao Studio at 192.168.1.20:8790…',
        reason: 'connecting',
      })
    Expect(deviceHostPresentation(state({ phase: 'handshaking', studioFingerprint: 'abcd 1234' }), publication))
      .toMatchObject({ message: 'Verifying Tao Studio (abcd 1234)…', reason: 'handshaking' })
    Expect(deviceHostPresentation(state({ code: '123 456', phase: 'pairing' }), publication)).toEqual({
      actions: [],
      code: '123 456',
      kind: 'overlay',
      message: 'Compare this code with Tao Studio, then confirm there.',
      reason: 'pairing',
      title: 'Pair with Tao Studio',
    })
  })

  Test('explains a disconnect, offers Forget Studio only for a key mismatch', () => {
    Expect(deviceHostPresentation(
      state({ lastError: { code: 'closed', message: 'Gone.' }, phase: 'disconnected', retryAt: 5 }),
      publication,
    )).toMatchObject({
      actions: ['reconnect'],
      message: 'Gone. Retrying automatically.',
      reason: 'disconnected',
      title: 'Disconnected (closed)',
    })
    Expect(deviceHostPresentation(
      state({ lastError: { code: 'revoked', message: 'Revoked.' }, phase: 'disconnected' }),
      publication,
    )).toMatchObject({ actions: ['reconnect'], message: 'Revoked.', reason: 'disconnected' })
    Expect(deviceHostPresentation(
      state({ lastError: { code: 'studio-key-mismatch', message: 'Different Studio.' }, phase: 'disconnected' }),
      publication,
    )).toMatchObject({
      actions: ['forget', 'reconnect'],
      message: 'Different Studio.',
      reason: 'key-mismatch',
    })
  })

  Test('renders the cell only when the assigned revision matches the loaded bundle', () => {
    const connected = state({ phase: 'connected' })
    Expect(deviceHostPresentation(connected, publication)).toMatchObject({ reason: 'waiting-for-cell' })
    Expect(deviceHostPresentation(
      { ...connected, cellUnavailable: { cellId: 'x', code: 'unknown-cell', message: 'No cell x.' } },
      publication,
    )).toMatchObject({
      message: 'No cell x.',
      reason: 'cell-unavailable',
      title: 'Scenario unavailable (unknown-cell)',
    })
    const stale = { ...connected, assignment: { identity: { ...identity, compileRevision: 8 }, runtime: {} } }
    Expect(deviceHostPresentation(stale, publication)).toMatchObject({
      message: 'Stale bundle: device has revision 7, Studio assigned 8 — waiting for Fast Refresh.',
      reason: 'stale-bundle',
    })
    const assignment = { identity, runtime: { cell: {} } }
    Expect(deviceHostPresentation({ ...connected, assignment }, publication)).toEqual({ assignment, kind: 'cell' })
    Expect(deviceHostPresentation({ ...connected, assignment }, { compileRevision: 9 })).toMatchObject({
      reason: 'stale-bundle',
    })
  })

  Test('keys a mounted cell by its complete identity', () => {
    Expect(cellIdentityKey(identity)).toBe('Demo:states#cell:2:7:compile:7:instance-1')
    Expect(cellIdentityKey({ ...identity, previewInstanceId: 'instance-2' })).not.toBe(cellIdentityKey(identity))
  })
})

Describe('Studio device host background lifecycle', () => {
  Test('pauses on the first transition into background', () => {
    Expect(studioDeviceAppStateAction('background', false)).toBe('pause')
  })

  Test('does not re-pause an already-paused client', () => {
    Expect(studioDeviceAppStateAction('background', true)).toBe('none')
  })

  Test('resumes a paused client returning to active', () => {
    Expect(studioDeviceAppStateAction('active', true)).toBe('resume')
  })

  Test('does not resume a client that was never paused', () => {
    Expect(studioDeviceAppStateAction('active', false)).toBe('none')
  })

  Test('treats inactive as a transient blip, not a background/foreground edge', () => {
    Expect(studioDeviceAppStateAction('inactive', false)).toBe('none')
    Expect(studioDeviceAppStateAction('inactive', true)).toBe('none')
  })
})

Describe('Studio device host cell acknowledgement', () => {
  Test('acknowledges an identity that has neither been applied nor errored', () => {
    Expect(shouldAcknowledgeCell('a:1', undefined, undefined)).toBe(true)
    Expect(shouldAcknowledgeCell('a:1', 'a:0', undefined)).toBe(true)
  })

  Test('does not re-acknowledge the identity already sent', () => {
    Expect(shouldAcknowledgeCell('a:1', 'a:1', undefined)).toBe(false)
  })

  Test('does not acknowledge an identity whose first render errored', () => {
    Expect(shouldAcknowledgeCell('a:1', undefined, 'a:1')).toBe(false)
  })

  Test('a later identity is unaffected by an earlier one having errored', () => {
    Expect(shouldAcknowledgeCell('a:2', undefined, 'a:1')).toBe(true)
  })
})

Describe('Studio device host platform adapters', () => {
  Test('keeps one JSON record in the keychain and rejects a partial one', async () => {
    const values = new Map<string, string>()
    const storage = secureStoreStorage({
      deleteItemAsync: async key => {
        values.delete(key)
      },
      getItemAsync: async key => values.get(key) ?? null,
      setItemAsync: async (key, value) => {
        values.set(key, value)
      },
    })
    const record = { identity: StudioDeviceTrust.generateIdentity(), pinnedStudioKey: 'pinned' }

    Expect(await storage.load()).toBeUndefined()
    await storage.save(record)
    Expect([...values.keys()]).toEqual(['tao-studio-device-v1'])
    Expect(await storage.load()).toEqual(record)
    await storage.clear()
    Expect(await storage.load()).toBeUndefined()

    Expect(parseStoredRecord(JSON.stringify({ identity: record.identity }))).toEqual({ identity: record.identity })
    Expect(parseStoredRecord(JSON.stringify({ identity: { publicKey: record.identity.publicKey } }))).toBeUndefined()
    Expect(parseStoredRecord(JSON.stringify({ identity: { publicKey: 'short', secretKey: 'x' } }))).toBeUndefined()
    Expect(parseStoredRecord(JSON.stringify({ ...record, pinnedStudioKey: 7 }))).toBeUndefined()
    Expect(parseStoredRecord('{oops')).toBeUndefined()
    Expect(parseStoredRecord('null')).toBeUndefined()

    // A secretKey that does not actually derive publicKey — a partial write, a bad migration — must
    // not be handed to the client as usable; every signature it tries to make with it would fail.
    const other = StudioDeviceTrust.generateIdentity()
    Expect(
      parseStoredRecord(
        JSON.stringify({ identity: { publicKey: record.identity.publicKey, secretKey: other.secretKey } }),
      ),
    ).toBeUndefined()
  })

  Test('bridges the platform WebSocket events and calls onto the client socket', () => {
    const transport = webSocketTransport(FakeWebSocket)
    const before = openedSockets.length
    const socket = transport.connect('ws://10.0.0.1:8790/device')
    const raw = openedSockets[before]!
    const events: unknown[] = []
    socket.onopen = () => events.push('open')
    socket.onmessage = text => events.push(['message', text])
    socket.onclose = (code, reason) => events.push(['close', code, reason])
    socket.onerror = error => events.push(['error', error])

    Expect(raw.url).toBe('ws://10.0.0.1:8790/device')
    raw.onopen?.()
    raw.onmessage?.({ data: '{"type":"studio.pong"}' })
    raw.onmessage?.({ data: 42 })
    raw.onerror?.('boom')
    raw.onclose?.({ code: 4001, reason: 'revoked' })
    socket.send('hello')
    socket.close(1000, 'done')

    Expect(events).toEqual([
      'open',
      ['message', '{"type":"studio.pong"}'],
      ['message', '42'],
      ['error', 'boom'],
      ['close', 4001, 'revoked'],
    ])
    Expect(raw.sent).toEqual(['hello'])
    Expect(raw.closed).toEqual({ code: 1000, reason: 'done' })
  })
})

Describe('Studio device host badge positioning', () => {
  const zeroInsets = { bottom: 0, left: 0, right: 0, top: 0 }

  Test('the minimum bound clears the safe area with no screen size known', () => {
    Expect(badgeDragBounds({ insets: zeroInsets })).toEqual({
      maxBottom: Number.POSITIVE_INFINITY,
      maxRight: Number.POSITIVE_INFINITY,
      minBottom: 8,
      minRight: 8,
    })
    Expect(badgeDragBounds({ insets: { bottom: 34, left: 0, right: 12, top: 59 } })).toMatchObject({
      minBottom: 42,
      minRight: 20,
    })
  })

  Test('a known screen size bounds how far the badge can be dragged toward the opposite edge', () => {
    const bounds = badgeDragBounds({ insets: zeroInsets, screen: { height: 800, width: 400 } })
    Expect(bounds.maxBottom).toBeLessThan(Number.POSITIVE_INFINITY)
    Expect(bounds.maxRight).toBeLessThan(Number.POSITIVE_INFINITY)
    // Never inverted: even a tiny screen leaves the minimum as the floor, not a negative range.
    Expect(badgeDragBounds({ insets: zeroInsets, screen: { height: 10, width: 10 } })).toMatchObject({
      maxBottom: 8,
      maxRight: 8,
    })
  })

  Test('clamps a dragged position to the given bounds without crossing either side', () => {
    const bounds = { maxBottom: 100, maxRight: 100, minBottom: 8, minRight: 8 }
    Expect(clampBadgePosition({ bottom: 50, right: 50 }, bounds)).toEqual({ bottom: 50, right: 50 })
    Expect(clampBadgePosition({ bottom: -20, right: -20 }, bounds)).toEqual({ bottom: 8, right: 8 })
    Expect(clampBadgePosition({ bottom: 500, right: 500 }, bounds)).toEqual({ bottom: 100, right: 100 })
  })
})
