import { Describe, Expect, settle, Test } from '@shared/test'
import { HostEnvironmentError } from '../TaoRuntime-src/TR-errors'
import {
  createStudioDeviceClient,
  type StudioDeviceClient,
  type StudioDeviceClientOptions,
  type TaoStudioDeviceClientState,
  type TaoStudioDeviceSocket,
  type TaoStudioDeviceStoredRecord,
  type TaoStudioDeviceTimers,
} from '../TaoRuntime-src/TR-studio-device-client'
import {
  StudioDeviceProtocol,
  type TaoStudioDeviceCellIdentity,
  type TaoStudioDeviceHelloMessage,
  type TaoStudioDeviceManifest,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceSealedFrame,
  type TaoStudioDeviceStudioMessage,
} from '../TaoRuntime-src/TR-studio-device-protocol'
import {
  StudioDeviceTrust,
  type TaoStudioDeviceIdentity,
  type TaoStudioDeviceSessionKeys,
} from '../TaoRuntime-src/TR-studio-device-trust'

type ScheduledTimer = { at: number; callback: () => void; delayMs: number; id: number }

/** A scripted clock: timers fire only when a test advances it, in due order. */
function fakeTimers(): TaoStudioDeviceTimers & {
  advance(ms: number): void
  now(): number
  pending(): number[]
} {
  let clock = 1_000_000
  let nextId = 1
  const scheduled: ScheduledTimer[] = []
  return {
    advance(ms) {
      const target = clock + ms
      for (;;) {
        const due = scheduled.filter(timer => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
        if (due === undefined) {
          break
        }
        scheduled.splice(scheduled.indexOf(due), 1)
        clock = Math.max(clock, due.at)
        due.callback()
      }
      clock = target
    },
    clearTimeout(handle) {
      const index = scheduled.findIndex(timer => timer.id === handle)
      if (index !== -1) {
        scheduled.splice(index, 1)
      }
    },
    now: () => clock,
    pending: () => scheduled.map(timer => timer.delayMs),
    setTimeout(callback, delayMs) {
      const id = nextId++
      scheduled.push({ at: clock + delayMs, callback, delayMs, id })
      return id
    },
  }
}

/** One in-memory socket: the device's outbound text lands in `inbox`; the test plays the other end. */
class Connection {
  readonly inbox: string[] = []
  closed: { code?: number; reason?: string } | undefined
  readonly socket: TaoStudioDeviceSocket

  constructor(readonly url: string) {
    this.socket = {
      close: (code, reason) => {
        this.closed ??= { code, reason }
      },
      send: text => {
        if (this.closed === undefined) {
          this.inbox.push(text)
        }
      },
    }
  }

  open(): void {
    this.socket.onopen?.()
  }

  deliver(value: unknown): void {
    this.socket.onmessage?.(typeof value === 'string' ? value : JSON.stringify(value))
  }

  error(error: unknown): void {
    this.socket.onerror?.(error)
  }

  end(code: number, reason = ''): void {
    this.socket.onclose?.(code, reason)
  }

  /** The device's clear hello, parsed strictly. */
  hello(): TaoStudioDeviceHelloMessage {
    const message = StudioDeviceProtocol.parseClearMessage(JSON.parse(this.inbox[0] ?? 'null'))
    Expect(message?.type).toBe('device.hello')
    return message as TaoStudioDeviceHelloMessage
  }
}

/** Plays Tao Studio's side of the trust protocol over the in-memory connections. */
class StudioPeer {
  readonly connections: Connection[] = []
  readonly transport = {
    connect: (url: string): TaoStudioDeviceSocket => {
      const connection = new Connection(url)
      this.connections.push(connection)
      return connection.socket
    },
  }

  constructor(readonly identity: TaoStudioDeviceIdentity = StudioDeviceTrust.generateIdentity()) {}

  latest(): Connection {
    const connection = this.connections.at(-1)
    Expect(connection).toBeDefined()
    return connection!
  }

  /** Answers the device hello with a signed studio.hello; the device may still refuse it. */
  answerHello(
    connection: Connection,
    options: { mode?: 'pair' | 'reconnect'; sessionId?: string } = {},
  ): {
    ephemeral: ReturnType<typeof StudioDeviceTrust.generateEphemeral>
    hello: TaoStudioDeviceHelloMessage
    transcript: Uint8Array
  } {
    const hello = connection.hello()
    const ephemeral = StudioDeviceTrust.generateEphemeral()
    const nonce = StudioDeviceTrust.generateNonce()
    const transcript = StudioDeviceTrust.transcript({
      deviceEphemeralPublicKey: hello.ephemeralPublicKey,
      deviceNonce: hello.nonce,
      devicePublicKey: hello.devicePublicKey,
      sessionId: options.sessionId ?? hello.sessionId ?? '',
      studioEphemeralPublicKey: ephemeral.publicKey,
      studioNonce: nonce,
      studioPublicKey: this.identity.publicKey,
    })
    connection.deliver({
      ephemeralPublicKey: ephemeral.publicKey,
      mode: options.mode ?? 'reconnect',
      nonce,
      protocol: TaoStudioDeviceProtocol.name,
      signature: StudioDeviceTrust.sign('studio', transcript, this.identity),
      studioPublicKey: this.identity.publicKey,
      type: 'studio.hello',
    })
    return { ephemeral, hello, transcript }
  }

  /** Answers the device hello and verifies the device's confirm, completing the handshake. */
  async handshake(
    connection: Connection,
    options: { mode?: 'pair' | 'reconnect'; sessionId?: string } = {},
  ): Promise<Session> {
    const { ephemeral, hello, transcript } = this.answerHello(connection, options)
    await settle()
    const confirm = StudioDeviceProtocol.parseClearMessage(JSON.parse(connection.inbox[1] ?? 'null'))
    Expect(confirm?.type).toBe('device.confirm')
    Expect(
      StudioDeviceTrust.verify(
        'device',
        transcript,
        (confirm as { signature: string }).signature,
        hello.devicePublicKey,
      ),
    ).toBe(true)
    const keys = StudioDeviceTrust.deriveSession('studio', ephemeral.secretKey, hello.ephemeralPublicKey, transcript)
    return new Session(connection, keys)
  }
}

/** One sealed Studio-to-device session with its own sequence counters. */
class Session {
  private sendSeq = 0
  private receiveSeq = 0

  constructor(readonly connection: Connection, readonly keys: TaoStudioDeviceSessionKeys) {}

  get code(): string {
    return this.keys.code
  }

  send(message: TaoStudioDeviceStudioMessage): void {
    this.sendSeq += 1
    this.connection.deliver(StudioDeviceTrust.seal(this.keys, this.sendSeq, message))
  }

  sendFrame(frame: TaoStudioDeviceSealedFrame): void {
    this.connection.deliver(frame)
  }

  welcome(overrides: Partial<Extract<TaoStudioDeviceStudioMessage, { type: 'studio.welcome' }>> = {}): void {
    this.send({
      appName: 'Demo',
      capabilities: ['render'],
      compile: { appliedRevision: 0, compileRevision: 7, message: 'ok', status: 'compiled' },
      heartbeatMs: 100,
      projectLabel: 'Demo',
      sessionId: 'session-1',
      type: 'studio.welcome',
      ...overrides,
    })
  }

  /** Opens the device's sealed frames in order, past the two clear handshake frames. */
  received(): unknown[] {
    const frames = this.connection.inbox.slice(2 + this.receiveSeq)
    const messages: unknown[] = []
    for (const text of frames) {
      const frame = StudioDeviceProtocol.parseClearMessage(JSON.parse(text))
      Expect(frame?.type).toBe('sealed')
      this.receiveSeq += 1
      messages.push(StudioDeviceTrust.open(this.keys, this.receiveSeq, frame as TaoStudioDeviceSealedFrame))
    }
    return messages
  }
}

function memoryStorage(initial?: TaoStudioDeviceStoredRecord): StudioDeviceClientOptions['storage'] & {
  record(): TaoStudioDeviceStoredRecord | undefined
  saves(): number
} {
  let record = initial
  let saves = 0
  return {
    clear: async () => {
      record = undefined
    },
    load: async () => record,
    record: () => record,
    save: async next => {
      saves += 1
      record = next
    },
    saves: () => saves,
  }
}

const manifest: TaoStudioDeviceManifest = {
  compileRevision: 7,
  manifestRevision: 'compile:7',
  scenarios: [{
    cellId: 'states#cell',
    cellRevision: 0,
    group: 'states',
    label: 'novel',
    scenarioId: 'states',
    viewport: { height: 844, width: 390 },
  }],
}

const identity: TaoStudioDeviceCellIdentity = {
  appName: 'Demo',
  cellId: 'states#cell',
  cellRevision: 0,
  compileRevision: 7,
  manifestRevision: 'compile:7',
  previewInstanceId: 'instance-1',
}

type Harness = {
  client: StudioDeviceClient
  states: TaoStudioDeviceClientState[]
  storage: ReturnType<typeof memoryStorage>
  studio: StudioPeer
  timers: ReturnType<typeof fakeTimers>
}

function harness(
  overrides: Partial<StudioDeviceClientOptions> & { record?: TaoStudioDeviceStoredRecord; studio?: StudioPeer } = {},
): Harness {
  const { record, studio: peer, ...options } = overrides
  const studio = peer ?? new StudioPeer()
  const timers = fakeTimers()
  const storage = memoryStorage(record)
  const client = createStudioDeviceClient({
    bootstrap: {
      candidates: ['ws://192.168.1.20:8790/device'],
      device: { model: 'iPhone', name: 'roPhone', os: 'iOS 26' },
      metroPort: 8081,
    },
    handshakeTimeoutMs: 5_000,
    now: timers.now,
    publication: { appName: 'Demo', compileRevision: 7 },
    storage,
    timers,
    transport: studio.transport,
    ...options,
  })
  const states: TaoStudioDeviceClientState[] = []
  client.subscribe(state => states.push(state))
  return { client, states, storage, studio, timers }
}

/** Starts the client and runs a complete handshake plus welcome on the newest connection. */
async function connect(run: Harness, options: { mode?: 'pair' | 'reconnect' } = {}): Promise<Session> {
  await run.client.start()
  const connection = run.studio.latest()
  connection.open()
  const session = await run.studio.handshake(connection, options)
  session.welcome({ manifest })
  return session
}

Describe('Studio device client handshake and pairing', () => {
  Test('pairs by showing the code Studio derived, then pins the Studio key on welcome', async () => {
    const run = harness()
    await run.client.start()

    Expect(run.client.state().phase).toBe('connecting')
    Expect(run.client.state().host).toBe('192.168.1.20:8790')
    Expect(run.storage.saves()).toBe(1)
    Expect(run.client.state().deviceFingerprint).toBe(
      StudioDeviceTrust.fingerprint(run.storage.record()!.identity.publicKey),
    )
    const connection = run.studio.latest()
    connection.open()
    const hello = connection.hello()
    Expect(run.client.state().phase).toBe('handshaking')
    Expect(hello.metroPort).toBe(8081)
    Expect(hello.device).toEqual({ model: 'iPhone', name: 'roPhone', os: 'iOS 26' })
    Expect(hello.pinnedStudioKey).toBeUndefined()
    Expect(hello.devicePublicKey).toBe(run.storage.record()!.identity.publicKey)

    const session = await run.studio.handshake(connection, { mode: 'pair' })
    Expect(run.client.state().studioFingerprint).toBe(StudioDeviceTrust.fingerprint(run.studio.identity.publicKey))
    Expect(run.client.state().phase).toBe('handshaking')
    Expect(run.storage.record()?.pinnedStudioKey).toBeUndefined()

    session.send({ type: 'studio.pairingPending' })
    Expect(run.client.state().phase).toBe('pairing')
    Expect(run.client.state().code).toBe(StudioDeviceTrust.formatCode(session.code))
    Expect(run.client.state().code).toMatch(/^\d{3} \d{3}$/)

    session.welcome({ manifest })
    await settle()
    const state = run.client.state()
    Expect(state.phase).toBe('connected')
    Expect(state.code).toBeUndefined()
    Expect(state.welcome).toEqual({
      appName: 'Demo',
      capabilities: ['render'],
      heartbeatMs: 100,
      projectLabel: 'Demo',
      sessionId: 'session-1',
    })
    Expect(state.manifest).toEqual(manifest)
    Expect(state.compile?.compileRevision).toBe(7)
    Expect(state.attempts).toBe(0)
    Expect(run.storage.record()?.pinnedStudioKey).toBe(run.studio.identity.publicKey)
    Expect(connection.closed).toBeUndefined()
  })

  Test('reconnects with the pinned key and refuses a Studio whose key differs', async () => {
    const trusted = new StudioPeer()
    const device = StudioDeviceTrust.generateIdentity()
    const run = harness({
      record: { identity: device, pinnedStudioKey: trusted.identity.publicKey },
      studio: new StudioPeer(),
    })
    await run.client.start()
    const connection = run.studio.latest()
    connection.open()

    Expect(connection.hello().pinnedStudioKey).toBe(trusted.identity.publicKey)
    Expect(connection.hello().devicePublicKey).toBe(device.publicKey)
    Expect(run.storage.saves()).toBe(0)

    // An impostor with a valid signature over its own key still fails the pin check.
    run.studio.answerHello(connection)
    const state = run.client.state()
    Expect(state.phase).toBe('disconnected')
    Expect(state.lastError?.code).toBe('studio-key-mismatch')
    Expect(connection.closed?.code).toBe(4000)
    Expect(connection.inbox).toHaveLength(1)
    Expect(run.timers.pending()).toEqual([])
    Expect(run.studio.connections).toHaveLength(1)

    await run.client.forgetStudio()
    Expect(run.storage.record()).toEqual({ identity: device })
    Expect(run.studio.connections).toHaveLength(2)
    const next = run.studio.latest()
    next.open()
    Expect(next.hello().pinnedStudioKey).toBeUndefined()
    Expect(next.hello().devicePublicKey).toBe(device.publicKey)
    const session = await run.studio.handshake(next, { mode: 'pair' })
    session.welcome()
    Expect(run.client.state().phase).toBe('connected')
    Expect(run.storage.record()?.pinnedStudioKey).toBe(run.studio.identity.publicKey)
  })

  Test('refuses a Studio hello whose signature does not verify', async () => {
    const run = harness()
    await run.client.start()
    const connection = run.studio.latest()
    connection.open()
    const hello = connection.hello()
    const ephemeral = StudioDeviceTrust.generateEphemeral()
    const forged = StudioDeviceTrust.generateIdentity()
    connection.deliver({
      ephemeralPublicKey: ephemeral.publicKey,
      mode: 'pair',
      nonce: StudioDeviceTrust.generateNonce(),
      protocol: TaoStudioDeviceProtocol.name,
      signature: StudioDeviceTrust.sign('studio', new Uint8Array(32), forged),
      studioPublicKey: run.studio.identity.publicKey,
      type: 'studio.hello',
    })

    Expect(hello.type).toBe('device.hello')
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('bad-signature')
    Expect(run.client.state().studioFingerprint).toBeUndefined()
    Expect(connection.inbox).toHaveLength(1)
    Expect(run.timers.pending()).toEqual([])
  })

  Test('falls through the candidate list when the first gateway fails or times out', async () => {
    const run = harness({
      bootstrap: {
        candidates: ['ws://10.0.0.5:8790/device', 'ws://169.254.7.7:8790/device', 'ws://192.168.1.20:8790/device'],
        device: { model: 'iPhone', name: 'roPhone', os: 'iOS 26' },
        metroPort: 8081,
      },
    })
    await run.client.start()
    Expect(run.client.state().host).toBe('10.0.0.5:8790')
    run.studio.latest().error(new HostEnvironmentError('ECONNREFUSED'))

    Expect(run.studio.connections).toHaveLength(2)
    Expect(run.client.state().phase).toBe('connecting')
    Expect(run.client.state().host).toBe('169.254.7.7:8790')
    Expect(run.client.state().lastError).toEqual({
      code: 'transport',
      message: 'Tao Studio at 10.0.0.5:8790 could not be reached: ECONNREFUSED',
    })
    run.timers.advance(5_000)

    Expect(run.studio.connections).toHaveLength(3)
    Expect(run.client.state().host).toBe('192.168.1.20:8790')
    Expect(run.client.state().lastError?.code).toBe('timeout')
    const connection = run.studio.latest()
    connection.open()
    const session = await run.studio.handshake(connection)
    session.welcome()
    Expect(run.client.state().phase).toBe('connected')
    Expect(run.client.state().attempts).toBe(0)
    Expect(run.client.state().lastError).toBeUndefined()

    // A dead connection after the whole list failed waits out the backoff, then starts over.
    connection.end(1006)
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.timers.pending()).toEqual([1_000])
    run.timers.advance(1_000)
    Expect(run.studio.latest().url).toBe('ws://10.0.0.5:8790/device')
  })
})

Describe('Studio device client sealed control plane', () => {
  Test('closes on a replayed sequence and reconnects with capped exponential backoff', async () => {
    const run = harness()
    const session = await connect(run)
    const before = run.studio.connections.length

    session.sendFrame(StudioDeviceTrust.seal(session.keys, 5, { type: 'studio.pong' }))
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('replayed-frame')
    Expect(session.connection.closed?.code).toBe(4000)

    const delays: number[] = []
    for (const expected of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      Expect(run.timers.pending()).toEqual([expected])
      Expect(run.client.state().retryAt).toBe(run.timers.now() + expected)
      delays.push(expected)
      run.timers.advance(expected)
      Expect(run.studio.connections).toHaveLength(before + delays.length)
      run.studio.latest().end(1006, 'gateway down')
    }
    Expect(run.client.state().attempts).toBe(7)
    Expect(run.client.state().lastError).toEqual({ code: 'closed', message: 'gateway down' })

    run.timers.advance(15_000)
    const revived = run.studio.latest()
    revived.open()
    const next = await run.studio.handshake(revived)
    next.welcome()
    Expect(run.client.state().phase).toBe('connected')
    Expect(run.client.state().attempts).toBe(0)
    Expect(run.client.state().retryAt).toBeUndefined()
  })

  Test('rejects a tampered frame as unsealed', async () => {
    const run = harness()
    const session = await connect(run)
    const frame = StudioDeviceTrust.seal(session.keys, 2, { type: 'studio.pong' })

    session.sendFrame({ ...frame, box: frame.box.replace(/^./, char => (char === 'A' ? 'B' : 'A')) })
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('unsealed')
  })

  Test('stops retrying after a revocation until a person reconnects', async () => {
    const run = harness()
    const session = await connect(run)
    const connection = session.connection

    connection.deliver({ code: 'revoked', message: 'Trust was revoked in Studio.', type: 'studio.rejected' })
    connection.end(4001, 'revoked')
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError).toEqual({ code: 'revoked', message: 'Trust was revoked in Studio.' })
    Expect(run.client.state().welcome).toBeUndefined()
    Expect(run.timers.pending()).toEqual([])
    run.timers.advance(60_000)
    Expect(run.studio.connections).toHaveLength(1)
    // The identity and the pinned key both survive: only a person forgets a Studio.
    Expect(run.storage.record()?.pinnedStudioKey).toBe(run.studio.identity.publicKey)

    run.client.reconnect()
    Expect(run.studio.connections).toHaveLength(2)
    Expect(run.client.state().phase).toBe('connecting')
    Expect(run.client.state().lastError).toBeUndefined()
    run.studio.latest().open()
    Expect(run.studio.latest().hello().pinnedStudioKey).toBe(run.studio.identity.publicKey)
  })

  Test('treats a sealed revocation and a declined pairing as final too', async () => {
    const run = harness()
    const session = await connect(run)
    const before = run.states.length
    // Studio revokes as sealed studio.revoked, then clear studio.rejected, then close 4001.
    session.send({ reason: 'by hand', type: 'studio.revoked' })
    session.connection.deliver({
      code: 'revoked',
      message: 'Studio no longer trusts this device.',
      type: 'studio.rejected',
    })
    session.connection.end(4001, 'revoked')
    Expect(run.client.state().lastError).toEqual({ code: 'revoked', message: 'by hand' })
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.states.length).toBe(before + 1)
    Expect(run.timers.pending()).toEqual([])

    run.client.reconnect()
    const connection = run.studio.latest()
    connection.open()
    await run.studio.handshake(connection, { mode: 'pair' })
    connection.deliver({ code: 'pairing-declined', message: 'Declined.', type: 'studio.rejected' })
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('pairing-declined')
    Expect(run.timers.pending()).toEqual([])
  })

  Test('retries a transient rejection with backoff', async () => {
    const run = harness()
    await run.client.start()
    const connection = run.studio.latest()
    connection.open()
    connection.deliver({ code: 'gateway-stopped', message: 'Stopping.', type: 'studio.rejected' })

    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('gateway-stopped')
    Expect(run.timers.pending()).toEqual([1_000])
  })

  Test('dials again immediately when Studio asks for a reconnect', async () => {
    const run = harness()
    const session = await connect(run)
    session.send({ type: 'studio.reconnect' })

    Expect(session.connection.closed?.code).toBe(1000)
    Expect(run.studio.connections).toHaveLength(2)
    Expect(run.client.state().phase).toBe('connecting')
    Expect(run.client.state().lastError).toBeUndefined()
    Expect(run.timers.pending()).toEqual([5_000])
    const connection = run.studio.latest()
    connection.open()
    Expect(connection.hello().pinnedStudioKey).toBe(run.studio.identity.publicKey)
  })

  Test('round-trips cell selection, assignment, and the applied acknowledgement', async () => {
    const run = harness()
    const session = await connect(run)

    // Studio assigns nothing on its own, so the device asks for the manifest's first scenario.
    Expect(session.received()).toEqual([{ cellId: 'states#cell', type: 'device.selectCell' }])
    Expect(run.client.state().selectedCellId).toBeUndefined()
    run.client.selectCell('states#cell')
    Expect(session.received()).toEqual([{ cellId: 'states#cell', type: 'device.selectCell' }])
    Expect(run.client.state().selectedCellId).toBe('states#cell')

    session.send({ identity, runtime: { cell: { scenarioId: 'states' } }, type: 'studio.cellAssigned' })
    Expect(run.client.state().assignment).toEqual({ identity, runtime: { cell: { scenarioId: 'states' } } })

    run.client.applied(identity, 7)
    Expect(session.received()).toEqual([{ appliedRevision: 7, compileRevision: 7, identity, type: 'device.applied' }])
    Expect(run.client.state().appliedRevision).toBe(7)
    Expect(() => run.client.applied(identity, 8)).toThrow(
      'Expected: the applied revision is the loaded bundle revision',
    )

    session.send({ accepted: true, compileRevision: 7, type: 'studio.appliedAck' })
    Expect(run.client.state().appliedAck).toEqual({ accepted: true, compileRevision: 7 })

    session.send({
      cellId: 'gone#cell',
      code: 'unknown-cell',
      message: 'No such cell.',
      type: 'studio.cellUnavailable',
    })
    Expect(run.client.state().cellUnavailable).toEqual({
      cellId: 'gone#cell',
      code: 'unknown-cell',
      message: 'No such cell.',
    })
    session.send({ identity, runtime: {}, type: 'studio.cellAssigned' })
    Expect(run.client.state().cellUnavailable).toBeUndefined()

    session.send({
      appliedRevision: 7,
      compileRevision: 8,
      message: 'Compiling…',
      status: 'compiling',
      type: 'studio.compileState',
    })
    Expect(run.client.state().compile).toEqual({
      appliedRevision: 7,
      compileRevision: 8,
      message: 'Compiling…',
      status: 'compiling',
    })
    session.send({ code: 'unknown-message', message: 'What?', type: 'studio.error' })
    Expect(run.client.state().lastError).toEqual({ code: 'unknown-message', message: 'What?' })
    Expect(run.client.state().phase).toBe('connected')

    run.client.report('info', 'drawn')
    Expect(session.received()).toEqual([{ level: 'info', message: 'drawn', type: 'device.report' }])
  })

  Test('re-selects the chosen cell after a reconnect instead of the manifest default', async () => {
    const run = harness()
    const first = await connect(run)
    Expect(first.received()).toEqual([{ cellId: 'states#cell', type: 'device.selectCell' }])
    run.client.selectCell('editing#cell')
    Expect(first.received()).toEqual([{ cellId: 'editing#cell', type: 'device.selectCell' }])

    first.send({ type: 'studio.reconnect' })
    const connection = run.studio.latest()
    connection.open()
    const second = await run.studio.handshake(connection)
    second.welcome({ manifest })
    Expect(second.received()).toEqual([{ cellId: 'editing#cell', type: 'device.selectCell' }])
  })

  Test('asks for the first scenario when a manifest arrives after a manifest-less welcome', async () => {
    const run = harness()
    await run.client.start()
    const connection = run.studio.latest()
    connection.open()
    const session = await run.studio.handshake(connection)
    session.welcome()
    Expect(session.received()).toEqual([])
    Expect(run.client.state().manifest).toBeUndefined()

    session.send({ manifest, type: 'studio.manifest' })
    Expect(session.received()).toEqual([{ cellId: 'states#cell', type: 'device.selectCell' }])
    session.send({ identity, runtime: {}, type: 'studio.cellAssigned' })
    session.send({ manifest: { ...manifest, manifestRevision: 'compile:8' }, type: 'studio.manifest' })
    // Once a cell is assigned, Studio re-registers it itself on a manifest change.
    Expect(session.received()).toEqual([])
  })

  Test('pings on the welcome interval and drops a Studio that stops answering', async () => {
    const run = harness()
    const session = await connect(run)

    Expect(session.received()).toEqual([{ cellId: 'states#cell', type: 'device.selectCell' }])
    run.timers.advance(100)
    Expect(session.received()).toEqual([{ type: 'device.ping' }])
    session.send({ type: 'studio.pong' })
    run.timers.advance(100)
    Expect(session.received()).toEqual([{ type: 'device.ping' }])
    Expect(run.client.state().phase).toBe('connected')

    run.timers.advance(100)
    Expect(session.received()).toEqual([{ type: 'device.ping' }])
    Expect(run.client.state().phase).toBe('connected')
    run.timers.advance(100)
    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('heartbeat-timeout')
    Expect(session.connection.closed?.code).toBe(4000)
    Expect(run.timers.pending()).toEqual([1_000])
  })

  Test('closes on a sealed frame above the frame limit and on an oversized hello', async () => {
    // The welcome with its one-scenario manifest fits; twenty scenarios do not.
    const run = harness({ frameLimitBytes: 1_024 })
    const session = await connect(run)
    Expect(run.client.state().phase).toBe('connected')
    session.send({
      manifest: { ...manifest, scenarios: Array(20).fill(manifest.scenarios[0]) },
      type: 'studio.manifest',
    })

    Expect(run.client.state().phase).toBe('disconnected')
    Expect(run.client.state().lastError?.code).toBe('oversized')
    Expect(run.client.state().manifest).toEqual(manifest)

    run.timers.advance(1_000)
    const connection = run.studio.latest()
    connection.open()
    connection.deliver(`{"type":"studio.hello","padding":"${'x'.repeat(TaoStudioDeviceProtocol.helloLimitBytes)}"}`)
    Expect(run.client.state().lastError?.code).toBe('oversized')
    Expect(connection.closed?.code).toBe(4000)
  })

  Test('ignores a malformed sealed payload without dropping the connection', async () => {
    const run = harness()
    const session = await connect(run)
    session.send({ type: 'studio.made-up' } as unknown as TaoStudioDeviceStudioMessage)

    Expect(run.client.state().phase).toBe('connected')
    Expect(run.client.state().lastError?.code).toBe('unknown-message')
    session.send({ type: 'studio.pong' })
    Expect(run.client.state().phase).toBe('connected')
  })
})

Describe('Studio device client lifecycle', () => {
  Test('stop releases the socket and every timer, and late events change nothing', async () => {
    const run = harness()
    const session = await connect(run)
    const before = run.states.length

    run.client.stop()
    Expect(run.client.state().phase).toBe('idle')
    Expect(run.client.state().welcome).toBeUndefined()
    Expect(session.connection.closed?.code).toBe(1000)
    Expect(run.timers.pending()).toEqual([])

    session.connection.end(1000, 'stopped')
    session.send({ type: 'studio.reconnect' })
    run.timers.advance(60_000)
    Expect(run.studio.connections).toHaveLength(1)
    Expect(run.client.state().phase).toBe('idle')
    Expect(run.states.length).toBe(before + 1)

    await run.client.start()
    Expect(run.studio.connections).toHaveLength(2)
    Expect(run.studio.latest().url).toBe('ws://192.168.1.20:8790/device')
  })

  Test('stopping while a retry is pending cancels it', async () => {
    const run = harness()
    const session = await connect(run)
    session.connection.end(1006)
    Expect(run.timers.pending()).toEqual([1_000])

    run.client.stop()
    Expect(run.timers.pending()).toEqual([])
    run.timers.advance(5_000)
    Expect(run.studio.connections).toHaveLength(1)
  })

  Test('publishes frozen snapshots to subscribers and unsubscribes cleanly', async () => {
    const run = harness()
    const seen: TaoStudioDeviceClientState[] = []
    const unsubscribe = run.client.subscribe(state => seen.push(state))
    await run.client.start()

    Expect(seen.length).toBeGreaterThan(0)
    Expect(Object.isFrozen(seen[0])).toBe(true)
    Expect(seen.at(-1)).toBe(run.client.state())
    const count = seen.length
    unsubscribe()
    run.studio.latest().open()
    Expect(seen.length).toBe(count)
    Expect(run.client.state().phase).toBe('handshaking')
  })

  Test('generates one identity per install and reuses it afterwards', async () => {
    const run = harness()
    await run.client.start()
    const first = run.storage.record()

    Expect(first?.identity.publicKey).toBeDefined()
    Expect(StudioDeviceTrust.validPublicKey(first!.identity.publicKey)).toBe(true)
    Expect(run.client.state().deviceFingerprint).toBe(StudioDeviceTrust.fingerprint(first!.identity.publicKey))
    run.client.stop()

    const again = harness({ record: first })
    await again.client.start()
    Expect(again.storage.saves()).toBe(0)
    again.studio.latest().open()
    Expect(again.studio.latest().hello().devicePublicKey).toBe(first!.identity.publicKey)
  })
})
