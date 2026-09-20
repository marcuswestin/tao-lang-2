import {
  StudioDeviceProtocol,
  type TaoStudioDeviceCompileState,
  type TaoStudioDeviceConfirmMessage,
  type TaoStudioDeviceDescription,
  type TaoStudioDeviceDeviceMessage,
  type TaoStudioDeviceHelloMessage,
  type TaoStudioDeviceLogEntry,
  type TaoStudioDeviceManifest,
  type TaoStudioDeviceNetworkCondition,
  type TaoStudioDeviceOccurrence,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceRejectCode,
  type TaoStudioDeviceStudioMessage,
} from '@runtime/TR-studio-device-protocol'
import {
  StudioDeviceTrust,
  StudioDeviceTrustError,
  type TaoStudioDeviceSessionKeys,
} from '@runtime/TR-studio-device-trust'
import { Errors, FS, Http, Json, Switch } from '@shared'
import type { StudioCompileSnapshot } from '../StudioCompileCoordinator'
import { StudioPreviewManifest, type StudioPreviewManifestV2 } from '../StudioPreviewManifest'
import type { StudioProjectSession, StudioSessionEvent } from '../StudioProjectSession'
import { studioProtocolChannel, studioProtocolVersion, studioSourceActionVersion } from '../StudioProtocol'
import {
  type StartedStudioDeviceBonjour,
  startStudioDeviceBonjour,
  type StudioDeviceBonjourOptions,
} from './StudioDeviceBonjour'
import type {
  StudioDeviceConnection,
  StudioDeviceSourceSelection,
  StudioDeviceStatus,
} from './StudioDeviceStatus'
import type { StudioDeviceTrustStore } from './StudioDeviceTrustStore'

/** The slice of a project session the gateway drives; a real `StudioProjectSession` satisfies it. */
export type StudioDeviceGatewaySession = Pick<
  StudioProjectSession,
  | 'acknowledgePreview'
  | 'appName'
  | 'applySourceAction'
  | 'reconfigureCell'
  | 'compileSnapshot'
  | 'previewCellInstance'
  | 'previewManifest'
  | 'projectRoot'
  | 'registerCellPreview'
  | 'subscribe'
  | 'unregisterCellPreview'
>

export type StudioDeviceGatewaySessionRef = {
  /** The project's Metro origin; a hello naming that port resolves to this session. */
  previewUrl?: string
  session: StudioDeviceGatewaySession
  sessionId: string
}

/** How the gateway finds open sessions; `StudioSessionManager` adapts to it in one line each. */
export type StudioDeviceGatewaySessions = {
  get(sessionId: string): StudioDeviceGatewaySessionRef | undefined
  list(): readonly StudioDeviceGatewaySessionRef[]
}

export type StudioDeviceGatewayOptions = {
  /** Disable in tests, or inject a recorder; production advertises the authenticated gateway. */
  bonjour?: false | ((options: StudioDeviceBonjourOptions) => StartedStudioDeviceBonjour | undefined)
  handshakeTimeoutMs?: number
  hostname?: string
  /** Candidate LAN hosts a phone may reach; shown in the status snapshot, never used to bind. */
  hosts?: () => Promise<readonly string[]>
  log?: (line: string) => void
  now?: () => Date
  pairingWindowMs?: number
  port?: number
  sessions: StudioDeviceGatewaySessions
  trustStore: StudioDeviceTrustStore
  /** How often a live gateway observes revocations written by another Studio process. */
  trustRefreshMs?: number
}

export type StudioDeviceStatusListener = (status: StudioDeviceStatus) => void

type ConnectionState = 'authenticating' | 'closed' | 'confirm' | 'connected' | 'hello' | 'pairing'

type Connection = {
  appliedRevision?: number
  /** The cell this device renders, kept whole so an edit from the phone can name its instance. */
  assignment?: {
    identity: {
      appName: string
      cellId: string
      cellRevision: number
      compileRevision: number
      manifestRevision: string
    }
    previewInstanceId: string
    scenarioId?: string
  }
  cellId?: string
  device?: TaoStudioDeviceDescription
  devicePublicKey?: string
  handshakeTimer?: ReturnType<typeof setTimeout>
  keys?: TaoStudioDeviceSessionKeys
  lastError?: string
  lastReport?: StudioDeviceConnection['lastReport']
  mode?: 'pair' | 'reconnect'
  /** The live preview instance this device renders, released on reassignment or disconnect. */
  previewInstanceId?: string
  /** The address the device dialed from, kept for the log after the socket is gone. */
  peerAddress?: string
  /** The sequence the next device frame must carry. */
  receiveSeq: number
  ref?: StudioDeviceGatewaySessionRef
  scenarioLabel?: string
  /** The sequence the last Studio frame carried. */
  sendSeq: number
  socket?: Socket
  state: ConnectionState
  transcript?: Uint8Array
  unsubscribe?: () => void
}

type SessionState = {
  listeners: Set<StudioDeviceStatusListener>
  /** The render a device last tapped, and the counter the workbench uses to act on it once. */
  selection?: StudioDeviceSourceSelection
  pairing?: { expiresAt: Date; timer: ReturnType<typeof setTimeout> }
  /** The one unknown device allowed into pair mode while the window is open. */
  pending?: Connection
}

type SocketData = { connection: Connection }

type Socket = Bun.ServerWebSocket<SocketData>

const deviceCapabilities: readonly string[] = ['render', 'select-cell', 'applied-revision']

const closeCodes = { rejected: 4000, revoked: 4001 } as const

/**
 * StudioDeviceGateway is the one LAN-facing surface of a Studio process: a single WebSocket path
 * speaking tao-studio-device-v1. It authenticates every device against the trust store, seals the
 * control plane per connection, and adapts the existing matrix session so a phone is one more
 * opaque preview instance. Nothing here exposes the loopback Studio API.
 */
export class StudioDeviceGateway {
  static readonly deviceManifest = deviceManifest

  readonly port: number
  #bonjour?: StartedStudioDeviceBonjour
  readonly #connections = new Set<Connection>()
  readonly #handshakeTimeoutMs: number
  readonly #hostsProvider: () => Promise<readonly string[]>
  readonly #log: (line: string) => void
  #repeatedOutcome: { address?: string; code: TaoStudioDeviceRejectCode; count: number } | undefined
  readonly #now: () => Date
  readonly #pairingWindowMs: number
  readonly #server: Bun.Server<SocketData>
  readonly #sessions: StudioDeviceGatewaySessions
  readonly #states = new Map<string, SessionState>()
  /** Capture requests waiting on a device answer, keyed by the id the request carried. */
  readonly #captures = new Map<
    string,
    {
      resolve: (result: { capture?: unknown; error?: string }) => void
      sessionId: string
      timer: ReturnType<typeof setTimeout>
    }
  >()
  readonly #store: StudioDeviceTrustStore
  readonly #trustRefreshMs: number
  #trustRefreshTimer?: ReturnType<typeof setTimeout>
  #hosts: readonly string[] = []
  /** Advances on every device selection so the workbench can tell a new tap from a re-sent status. */
  #selectionSequence = 0
  #stopped = false

  private constructor(options: StudioDeviceGatewayOptions) {
    this.#handshakeTimeoutMs = options.handshakeTimeoutMs ?? TaoStudioDeviceProtocol.handshakeTimeoutMs
    this.#hostsProvider = options.hosts ?? (async () => [])
    this.#log = options.log ?? (() => {})
    this.#now = options.now ?? (() => new Date())
    this.#pairingWindowMs = options.pairingWindowMs ?? TaoStudioDeviceProtocol.pairingWindowMs
    this.#sessions = options.sessions
    this.#store = options.trustStore
    this.#trustRefreshMs = options.trustRefreshMs ?? 1_000
    this.#server = Bun.serve<SocketData>({
      fetch: (request, server) => this.#fetch(request, server),
      hostname: options.hostname ?? '0.0.0.0',
      port: options.port ?? 0,
      websocket: {
        close: socket => this.#dispose(socket.data.connection),
        // Twice the sealed limit lets the gateway answer an oversized frame with a named rejection
        // instead of the transport's anonymous 1009 close.
        maxPayloadLength: TaoStudioDeviceProtocol.frameLimitBytes * 2,
        message: (socket, message) => this.#message(socket.data.connection, message),
        open: socket => this.#open(socket),
      },
    })
    this.port = this.#server.port ?? options.port ?? 0
    this.#scheduleTrustRefresh()
  }

  static async start(options: StudioDeviceGatewayOptions): Promise<StudioDeviceGateway> {
    const gateway = new StudioDeviceGateway(options)
    await gateway.#refreshHosts()
    if (options.bonjour !== false) {
      gateway.#bonjour = (options.bonjour ?? startStudioDeviceBonjour)({
        log: gateway.#log,
        port: gateway.port,
        studioPublicKey: gateway.#store.publicKey(),
      })
    }
    return gateway
  }

  status(sessionId: string): StudioDeviceStatus {
    const state = this.#states.get(sessionId)
    const connection = this.#liveConnection(sessionId)
    const pending = state?.pending?.state === 'pairing' ? state.pending : undefined
    return {
      ...(connection === undefined ? {} : { connection: connectionSnapshot(connection) }),
      gateway: { hosts: this.#hosts, port: this.port, studioFingerprint: this.#store.fingerprint() },
      pairing: {
        ...(state?.pairing === undefined ? {} : { expiresAt: state.pairing.expiresAt.toISOString() }),
        open: state?.pairing !== undefined,
        ...(pending?.device === undefined || pending.devicePublicKey === undefined || pending.keys === undefined
          ? {}
          : {
            pending: {
              code: pending.keys.code,
              device: { ...pending.device },
              devicePublicKey: pending.devicePublicKey,
              fingerprint: StudioDeviceTrust.fingerprint(pending.devicePublicKey),
            },
          }),
      },
      ...(state?.selection === undefined ? {} : { selection: state.selection }),
      sessionId,
      trusted: this.#store.trusted(),
    }
  }

  subscribe(sessionId: string, listener: StudioDeviceStatusListener): () => void {
    const state = this.#state(sessionId)
    state.listeners.add(listener)
    return () => {
      state.listeners.delete(listener)
    }
  }

  /** openPairing lets one unknown device pair with this session until the window expires. */
  openPairing(sessionId: string): { expiresAt: string } {
    this.#requireSession(sessionId)
    const state = this.#state(sessionId)
    if (state.pairing !== undefined) {
      clearTimeout(state.pairing.timer)
    }
    const expiresAt = new Date(this.#now().getTime() + this.#pairingWindowMs)
    state.pairing = {
      expiresAt,
      timer: setTimeout(() => this.#closePairing(sessionId, 'The pairing window expired.'), this.#pairingWindowMs),
    }
    void this.#refreshHosts().then(() => this.#emit(sessionId))
    this.#emit(sessionId)
    return { expiresAt: expiresAt.toISOString() }
  }

  /** confirmPairing is the person's decision that both screens show the same code. */
  async confirmPairing(sessionId: string, devicePublicKey: string): Promise<{ accepted: true }> {
    const connection = this.#pendingConnection(sessionId, devicePublicKey)
    const device = connection.device
    if (device === undefined) {
      Errors.throwUnexpected('A pairing device has no description.')
    }
    // The connection is checked before the device is trusted, not after: a device that walked away
    // between asking and being confirmed should leave no record behind, and trusting it first meant
    // the refusal that follows left a device in the trust list nobody ever finished pairing.
    if (connection.state !== 'pairing') {
      Errors.throwUserInput('The device disconnected before pairing was confirmed.')
    }
    const pairedAt = this.#now().toISOString()
    await this.#store.trust({
      device,
      devicePublicKey,
      fingerprint: StudioDeviceTrust.fingerprint(devicePublicKey),
      lastSeenAt: pairedAt,
      pairedAt,
    })
    // Checked again: the write above is awaited, and a phone that goes away during it must not be
    // welcomed into a session over a socket that is already gone.
    if (connection.state !== 'pairing') {
      Errors.throwUserInput('The device disconnected before pairing was confirmed.')
    }
    const state = this.#state(sessionId)
    state.pending = undefined
    if (state.pairing !== undefined) {
      clearTimeout(state.pairing.timer)
      state.pairing = undefined
    }
    this.#welcome(connection)
    return { accepted: true }
  }

  declinePairing(sessionId: string, devicePublicKey: string): { declined: true } {
    const connection = this.#pendingConnection(sessionId, devicePublicKey)
    this.#reject(connection, 'pairing-declined', 'Studio declined the pairing request.')
    return { declined: true }
  }

  /** revoke forgets a device and drops its live connection, if any, with `studio.revoked`. */
  async revoke(sessionId: string, devicePublicKey: string): Promise<{ revoked: boolean }> {
    this.#requireSession(sessionId)
    const revoked = await this.#store.revoke(devicePublicKey)
    for (const connection of [...this.#connections]) {
      if (
        connection.devicePublicKey === devicePublicKey
        && (connection.state === 'connected' || connection.state === 'pairing')
      ) {
        this.#sendSealed(connection, { reason: 'Studio revoked this device.', type: 'studio.revoked' })
        this.#reject(connection, 'revoked', 'Studio revoked this device.')
      }
    }
    this.#emit(sessionId)
    return { revoked }
  }

  /** requestReconnect asks every live device on the session to drop and dial again. */
  requestReconnect(sessionId: string): { requested: boolean } {
    this.#requireSession(sessionId)
    let requested = false
    for (const connection of this.#connections) {
      if (connection.ref?.sessionId === sessionId && connection.state === 'connected') {
        this.#sendSealed(connection, { type: 'studio.reconnect' })
        requested = true
      }
    }
    return { requested }
  }

  /** detachSession drops every resource that still points at a project session that has closed. */
  detachSession(sessionId: string): { detached: number } {
    let detached = 0
    for (const connection of [...this.#connections]) {
      if (connection.ref?.sessionId === sessionId) {
        this.#reject(connection, 'unknown-session', 'The Studio project session closed.')
        detached += 1
      }
    }
    for (const [requestId, pending] of this.#captures) {
      if (pending.sessionId === sessionId) {
        clearTimeout(pending.timer)
        this.#captures.delete(requestId)
        pending.resolve({ error: 'The Studio project session closed.' })
      }
    }
    const state = this.#states.get(sessionId)
    if (state?.pairing !== undefined) {
      clearTimeout(state.pairing.timer)
    }
    state?.listeners.clear()
    this.#states.delete(sessionId)
    return { detached }
  }

  /**
   * Outlines one render on the connected device, which is the other half of selecting both ways:
   * the workbench calls this when a person selects source on the Mac. Passing no occurrence clears
   * the outline, so a cleared selection in the editor does not leave a stale box on the phone.
   */
  highlightSource(sessionId: string, occurrence?: TaoStudioDeviceOccurrence): { delivered: boolean } {
    this.#requireSession(sessionId)
    const connection = this.#liveConnection(sessionId)
    if (connection === undefined || connection.state !== 'connected') {
      return { delivered: false }
    }
    this.#sendSealed(connection, {
      ...(occurrence === undefined ? {} : { occurrence }),
      type: 'studio.highlightSource',
    })
    return { delivered: true }
  }

  /** selectCell assigns a cell from the workbench exactly as `device.selectCell` would. */
  selectCell(sessionId: string, cellId: string): { requested: boolean } {
    this.#requireSession(sessionId)
    const connection = this.#liveConnection(sessionId)
    if (connection === undefined || connection.state !== 'connected') {
      Errors.throwUserInput('No device is connected to this project.')
    }
    this.#assign(connection, cellId)
    return { requested: true }
  }

  /**
   * Asks the connected device for its runtime state and waits for the answer. The device always
   * answers — with the artifact, or with why it could not — so the only way this rejects is a
   * device that went away mid-request, which the timeout covers.
   */
  async captureRuntime(sessionId: string, timeoutMs = 10_000): Promise<{ capture?: unknown; error?: string }> {
    this.#requireSession(sessionId)
    const connection = this.#liveConnection(sessionId)
    if (connection === undefined || connection.state !== 'connected') {
      Errors.throwUserInput('No device is connected to this project.')
    }
    const requestId = crypto.randomUUID()
    return await new Promise<{ capture?: unknown; error?: string }>(resolve => {
      const timer = setTimeout(() => {
        this.#captures.delete(requestId)
        resolve({ error: `The device did not answer the capture request within ${timeoutMs}ms.` })
      }, timeoutMs)
      this.#captures.set(requestId, { resolve, sessionId, timer })
      this.#sendSealed(connection, { requestId, type: 'studio.captureRuntime' })
    })
  }

  stop(): void {
    if (this.#stopped) {
      return
    }
    this.#stopped = true
    for (const connection of [...this.#connections]) {
      this.#reject(connection, 'gateway-stopped', 'The Studio device gateway stopped.')
    }
    // Answer anyone still waiting on a device rather than leaving a promise and its timer behind.
    for (const [requestId, pending] of this.#captures) {
      clearTimeout(pending.timer)
      this.#captures.delete(requestId)
      pending.resolve({ error: 'The Studio device gateway stopped.' })
    }
    for (const state of this.#states.values()) {
      if (state.pairing !== undefined) {
        clearTimeout(state.pairing.timer)
        state.pairing = undefined
      }
      state.listeners.clear()
    }
    this.#states.clear()
    this.#bonjour?.stop()
    this.#bonjour = undefined
    clearTimeout(this.#trustRefreshTimer)
    this.#trustRefreshTimer = undefined
    this.#server.stop(true)
  }

  #fetch(request: Request, server: Bun.Server<SocketData>): Response | undefined {
    const url = new URL(request.url)
    if (url.pathname === '/device/probe' && request.method === 'GET') {
      return Http.jsonResponse({ protocol: TaoStudioDeviceProtocol.name })
    }
    if (url.pathname === '/device') {
      const connection: Connection = { receiveSeq: 1, sendSeq: 0, state: 'hello' }
      return server.upgrade(request, { data: { connection } })
        ? undefined
        : Http.jsonResponse({ error: 'Expected a WebSocket upgrade.' }, 426)
    }
    return Http.jsonResponse({ error: 'Not found.' }, 404)
  }

  #open(socket: Socket): void {
    const connection = socket.data.connection
    connection.socket = socket
    if (this.#stopped) {
      this.#reject(connection, 'gateway-stopped', 'The Studio device gateway stopped.')
      return
    }
    this.#connections.add(connection)
    connection.handshakeTimer = setTimeout(
      () => this.#reject(connection, 'timeout', `The handshake did not complete within ${this.#handshakeTimeoutMs}ms.`),
      this.#handshakeTimeoutMs,
    )
    connection.peerAddress = socket.remoteAddress
    this.#logConnectionAttempt(connection)
  }

  #message(connection: Connection, raw: string | Buffer): void {
    if (connection.state === 'closed') {
      return
    }
    if (connection.state === 'authenticating') {
      this.#reject(connection, 'malformed', 'The device sent another handshake frame before authentication finished.')
      return
    }
    if (typeof raw !== 'string') {
      this.#reject(connection, 'malformed', 'Expected a text frame.')
      return
    }
    if (connection.state === 'hello' || connection.state === 'confirm') {
      void this.#clearFrame(connection, raw)
    } else {
      this.#sealedFrame(connection, raw)
    }
  }

  async #clearFrame(connection: Connection, text: string): Promise<void> {
    const parsed = StudioDeviceProtocol.parseText(text, TaoStudioDeviceProtocol.helloLimitBytes)
    if (parsed.kind === 'oversized') {
      this.#reject(
        connection,
        'oversized',
        `Handshake frames are limited to ${TaoStudioDeviceProtocol.helloLimitBytes} bytes.`,
      )
      return
    }
    if (parsed.kind === 'invalid') {
      this.#reject(connection, 'malformed', 'Handshake frames must be JSON.')
      return
    }
    const message = StudioDeviceProtocol.parseClearMessage(parsed.value)
    if (message === undefined) {
      if (
        Json.isRecord(parsed.value) && parsed.value['type'] === 'device.hello'
        && typeof parsed.value['protocol'] === 'string'
      ) {
        this.#reject(
          connection,
          'unsupported-protocol',
          `This Studio speaks ${TaoStudioDeviceProtocol.name}, not ${parsed.value['protocol']}.`,
        )
      } else {
        this.#reject(connection, 'malformed', 'Expected a tao-studio-device-v1 handshake frame.')
      }
      return
    }
    if (connection.state === 'hello') {
      if (message.type !== 'device.hello') {
        this.#reject(connection, 'malformed', 'Expected device.hello first.')
        return
      }
      await this.#hello(connection, message)
      return
    }
    if (message.type !== 'device.confirm') {
      this.#reject(connection, 'malformed', 'Expected device.confirm after studio.hello.')
      return
    }
    this.#confirm(connection, message)
  }

  async #hello(connection: Connection, hello: TaoStudioDeviceHelloMessage): Promise<void> {
    const ref = this.#resolveSession(hello)
    if (ref === undefined) {
      this.#reject(connection, 'unknown-session', 'No open Studio project matches this hello.')
      return
    }
    // Assigned now rather than after the handshake succeeds: #dispose only clears a session's
    // `pending` slot when it can find the session through connection.ref, so a connection that
    // occupies the slot and then fails later in this method (a malformed key, an invalid ephemeral
    // that fails derivation) must still be attributable to this session, or the slot stays jammed
    // against every other device until the pairing window closes and reopens.
    connection.ref = ref
    if (
      !StudioDeviceTrust.validPublicKey(hello.devicePublicKey)
      || !StudioDeviceTrust.validPublicKey(hello.ephemeralPublicKey)
      || !StudioDeviceTrust.validNonce(hello.nonce)
    ) {
      this.#reject(connection, 'malformed', 'Handshake keys must be 32-byte base64 values and the nonce 16 bytes.')
      return
    }
    connection.state = 'authenticating'
    try {
      await this.#store.refresh()
    } catch (error) {
      this.#log(`could not refresh device trust: ${Errors.formatForLog(error)}`)
      this.#reject(connection, 'gateway-stopped', 'Studio could not read the device trust store.')
      return
    }
    if (!this.#connections.has(connection) || this.#resolveSession(hello) === undefined) {
      this.#reject(connection, 'unknown-session', 'The Studio project session closed during the handshake.')
      return
    }
    let mode: 'pair' | 'reconnect'
    if (this.#store.isTrusted(hello.devicePublicKey)) {
      mode = 'reconnect'
    } else {
      const state = this.#state(ref.sessionId)
      if (state.pairing === undefined) {
        this.#reject(connection, 'pairing-closed', 'Open pairing for this project in Studio, then try again.')
        return
      }
      if (state.pending !== undefined && state.pending !== connection) {
        this.#reject(connection, 'pairing-closed', 'Another device is already pairing with this project.')
        return
      }
      state.pending = connection
      mode = 'pair'
    }
    const identity = this.#store.identity()
    const ephemeral = StudioDeviceTrust.generateEphemeral()
    const nonce = StudioDeviceTrust.generateNonce()
    // The transcript binds the session id the device itself named; a hello resolved by Metro port
    // carries none, and both sides must hash the same bytes before Studio can tell the device more.
    const transcript = StudioDeviceTrust.transcript({
      deviceEphemeralPublicKey: hello.ephemeralPublicKey,
      deviceNonce: hello.nonce,
      devicePublicKey: hello.devicePublicKey,
      sessionId: hello.sessionId ?? '',
      studioEphemeralPublicKey: ephemeral.publicKey,
      studioNonce: nonce,
      studioPublicKey: identity.publicKey,
    })
    let keys: TaoStudioDeviceSessionKeys
    try {
      keys = StudioDeviceTrust.deriveSession('studio', ephemeral.secretKey, hello.ephemeralPublicKey, transcript)
    } catch {
      this.#reject(connection, 'malformed', 'The device ephemeral key is not a valid X25519 key.')
      return
    }
    connection.device = { ...hello.device }
    connection.devicePublicKey = hello.devicePublicKey
    connection.keys = keys
    connection.mode = mode
    connection.transcript = transcript
    connection.state = 'confirm'
    this.#sendClear(connection, {
      ephemeralPublicKey: ephemeral.publicKey,
      mode,
      nonce,
      protocol: TaoStudioDeviceProtocol.name,
      signature: StudioDeviceTrust.sign('studio', transcript, identity),
      studioPublicKey: identity.publicKey,
      type: 'studio.hello',
    })
  }

  #confirm(connection: Connection, confirm: TaoStudioDeviceConfirmMessage): void {
    const { devicePublicKey, mode, ref, transcript } = connection
    if (devicePublicKey === undefined || mode === undefined || ref === undefined || transcript === undefined) {
      Errors.throwUnexpected('A device connection reached confirm without a hello.')
    }
    if (!StudioDeviceTrust.verify('device', transcript, confirm.signature, devicePublicKey)) {
      this.#reject(connection, 'bad-signature', 'The device signature does not match this handshake.')
      return
    }
    clearTimeout(connection.handshakeTimer)
    connection.handshakeTimer = undefined
    for (const other of [...this.#connections]) {
      if (other !== connection && other.devicePublicKey === devicePublicKey && other.state !== 'closed') {
        this.#reject(other, 'replaced', 'The device opened a newer connection.')
      }
    }
    if (mode === 'reconnect') {
      if (!this.#store.isTrusted(devicePublicKey)) {
        this.#reject(connection, 'revoked', 'Studio no longer trusts this device.')
        return
      }
      void this.#store.touch(devicePublicKey, this.#now().toISOString()).catch(error => {
        this.#log(`could not record the device handshake: ${Errors.formatForLog(error)}`)
      })
      this.#welcome(connection)
      return
    }
    const state = this.#state(ref.sessionId)
    if (state.pairing === undefined || state.pending !== connection) {
      this.#reject(connection, 'pairing-closed', 'The pairing window closed before the device confirmed.')
      return
    }
    connection.state = 'pairing'
    this.#sendSealed(connection, { type: 'studio.pairingPending' })
    this.#log(`device ${deviceText(connection.device?.name ?? 'unknown')} is waiting for pairing confirmation`)
    this.#emit(ref.sessionId)
  }

  #welcome(connection: Connection): void {
    const ref = connection.ref
    if (ref === undefined) {
      Errors.throwUnexpected('A device connection has no session to welcome it into.')
    }
    connection.state = 'connected'
    const manifest = ref.session.previewManifest()
    this.#sendSealed(connection, {
      appName: ref.session.appName,
      capabilities: deviceCapabilities,
      compile: compileState(ref.session.compileSnapshot()),
      heartbeatMs: TaoStudioDeviceProtocol.heartbeatMs,
      ...(manifest === undefined ? {} : { manifest: deviceManifest(manifest) }),
      projectLabel: FS.basename(ref.session.projectRoot),
      sessionId: ref.sessionId,
      type: 'studio.welcome',
    })
    connection.unsubscribe = ref.session.subscribe(event => this.#sessionEvent(connection, event))
    this.#repeatedOutcome = undefined
    this.#log(`device ${deviceText(connection.device?.name ?? 'unknown')} connected to ${ref.session.appName}`)
    this.#emit(ref.sessionId)
  }

  #sessionEvent(connection: Connection, event: StudioSessionEvent): void {
    if (connection.state !== 'connected') {
      return
    }
    Switch.on(event, 'type', {
      // The reconfigure released every instance of this cell, this device's included, so its next
      // `device.applied` would be refused as no longer current. Re-assign to hand it a live instance
      // carrying the new arguments, environment, state layers, or replayed capture.
      'cell-reconfigured': reconfigured => {
        if (connection.cellId === reconfigured.cellId) {
          this.#assign(connection, reconfigured.cellId)
        }
      },
      'checkpoint-changed': Switch.nothing,
      'compile-state': compiled => {
        this.#sendSealed(connection, { ...compileState(compiled.state), type: 'studio.compileState' })
      },
      'file-changed': Switch.nothing,
      'files-changed': Switch.nothing,
      'preview-manifest-changed': changed => this.#manifestChanged(connection, changed.manifest),
      'sketch-catalog-changed': Switch.nothing,
      'studio-writes-acknowledged': Switch.nothing,
    })
  }

  #manifestChanged(connection: Connection, manifest: StudioPreviewManifestV2): void {
    this.#sendSealed(connection, { manifest: deviceManifest(manifest), type: 'studio.manifest' })
    if (connection.cellId === undefined) {
      return
    }
    const cellId = manifest.cells.some(cell => cell.cellId === connection.cellId)
      ? connection.cellId
      : manifest.cells[0]?.cellId
    if (cellId !== undefined) {
      this.#assign(connection, cellId)
    }
  }

  #assign(connection: Connection, cellId: string): void {
    const ref = connection.ref
    if (ref === undefined) {
      Errors.throwUnexpected('A device connection has no session to assign a cell from.')
    }
    const manifest = ref.session.previewManifest()
    if (manifest === undefined) {
      this.#sendSealed(connection, {
        cellId,
        code: 'manifest-unavailable',
        message: 'Studio has not published a preview manifest yet.',
        type: 'studio.cellUnavailable',
      })
      return
    }
    const cell = manifest.cells.find(candidate => candidate.cellId === cellId)
    if (cell === undefined) {
      this.#sendSealed(connection, {
        cellId,
        code: 'unknown-cell',
        message: `The preview manifest has no cell ${cellId}.`,
        type: 'studio.cellUnavailable',
      })
      return
    }
    const identity = StudioPreviewManifest.cellIdentity(manifest, cell)
    const previewInstanceId = crypto.randomUUID()
    try {
      this.#releaseInstance(connection)
      ref.session.registerCellPreview({ ...identity, previewInstanceId })
      const runtime = ref.session.previewCellInstance(previewInstanceId)
      connection.previewInstanceId = previewInstanceId
      connection.cellId = cellId
      connection.assignment = {
        identity: {
          appName: identity.appName,
          cellId: identity.cellId,
          cellRevision: identity.cellRevision,
          compileRevision: identity.compileRevision,
          manifestRevision: identity.manifestRevision,
        },
        previewInstanceId,
        ...(cell.scenarioId === undefined ? {} : { scenarioId: cell.scenarioId }),
      }
      connection.lastError = undefined
      connection.scenarioLabel = manifest.scenarios.find(scenario => scenario.scenarioId === cell.scenarioId)?.label
      this.#sendSealed(connection, {
        identity: {
          appName: identity.appName,
          cellId: identity.cellId,
          cellRevision: identity.cellRevision,
          compileRevision: identity.compileRevision,
          manifestRevision: identity.manifestRevision,
          previewInstanceId,
        },
        runtime: deviceCellRuntime(runtime),
        type: 'studio.cellAssigned',
      })
    } catch (error) {
      connection.lastError = Errors.formatForUser(error)
      this.#sendSealed(connection, {
        cellId,
        code: 'unknown-cell',
        message: connection.lastError,
        type: 'studio.cellUnavailable',
      })
    }
    this.#emit(ref.sessionId)
  }

  #sealedFrame(connection: Connection, text: string): void {
    const keys = connection.keys
    if (keys === undefined) {
      Errors.throwUnexpected('A sealed frame arrived on a connection without session keys.')
    }
    const parsed = StudioDeviceProtocol.parseText(text, TaoStudioDeviceProtocol.frameLimitBytes)
    if (parsed.kind === 'oversized') {
      this.#reject(
        connection,
        'oversized',
        `Sealed frames are limited to ${TaoStudioDeviceProtocol.frameLimitBytes} bytes.`,
      )
      return
    }
    if (parsed.kind === 'invalid') {
      this.#reject(connection, 'malformed', 'Sealed frames must be JSON.')
      return
    }
    const frame = StudioDeviceProtocol.parseClearMessage(parsed.value)
    if (frame?.type !== 'sealed') {
      this.#reject(connection, 'malformed', 'Only sealed frames are accepted after the handshake.')
      return
    }
    let payload: unknown
    try {
      payload = StudioDeviceTrust.open(keys, connection.receiveSeq, frame)
    } catch (error) {
      const replayed = error instanceof StudioDeviceTrustError && error.code === 'replayed-frame'
      this.#reject(
        connection,
        replayed ? 'replayed-frame' : 'malformed',
        replayed ? `Expected sealed frame ${connection.receiveSeq}.` : 'The sealed frame could not be opened.',
      )
      return
    }
    connection.receiveSeq += 1
    const message = StudioDeviceProtocol.parseDeviceMessage(payload)
    if (message === undefined) {
      this.#sendSealed(connection, {
        code: 'unknown-message',
        message: 'Studio does not understand that device message.',
        type: 'studio.error',
      })
      return
    }
    this.#deviceMessage(connection, message)
  }

  /**
   * Applies an edit a person made on the phone.
   *
   * The envelope is built here rather than on the device on purpose: everything that decides whether
   * the edit is legal — which cell instance is current, which scenario it renders, what version the
   * file is at — is Studio's own state, and a device that could assert those could edit against a
   * tree Studio has already replaced. The device supplies only what it alone knows: which render was
   * touched and where it should go.
   */
  async #applyDeviceSourceAction(
    connection: Connection,
    ref: StudioDeviceGatewaySessionRef,
    message: Extract<TaoStudioDeviceDeviceMessage, { type: 'device.sourceAction' }>,
  ): Promise<void> {
    const assignment = connection.assignment
    if (assignment === undefined) {
      this.#sendSealed(connection, {
        error: 'This device is not rendering a cell.',
        ok: false,
        requestId: message.requestId,
        type: 'studio.sourceActionResult',
      })
      return
    }
    try {
      await ref.session.applySourceAction({
        action: message.action,
        channel: studioProtocolChannel,
        checkpoint: { id: crypto.randomUUID(), phase: 'single' },
        identity: {
          appName: assignment.identity.appName,
          cellId: assignment.identity.cellId,
          cellRevision: assignment.identity.cellRevision,
          compileRevision: assignment.identity.compileRevision,
          manifestRevision: assignment.identity.manifestRevision,
          occurrence: {
            nodeKind: 'render',
            ...(message.occurrence.ownerName === undefined ? {} : { renderOwner: message.occurrence.ownerName }),
          },
          path: message.occurrence.sourcePath,
          previewInstanceId: assignment.previewInstanceId,
          project: ref.session.projectRoot,
          ...(assignment.scenarioId === undefined ? {} : { scenarioId: assignment.scenarioId }),
          // The device's own version, not the file's current one. Studio refuses the edit if the
          // file moved on since the bundle was built, which is the whole point of sending it.
          sourceVersion: message.occurrence.sourceVersion,
        },
        protocolVersion: studioProtocolVersion,
        // Studio's own id, not the device's: `applySourceAction` caches by request id and refuses a
        // reused one, and a device's counter restarts from zero every time it reconnects.
        requestId: crypto.randomUUID(),
        sourceActionVersion: studioSourceActionVersion,
        type: 'source-action',
      })
      this.#sendSealed(connection, { ok: true, requestId: message.requestId, type: 'studio.sourceActionResult' })
    } catch (error) {
      this.#sendSealed(connection, {
        error: Errors.formatForUser(error),
        ok: false,
        requestId: message.requestId,
        type: 'studio.sourceActionResult',
      })
    }
  }

  #deviceMessage(connection: Connection, message: TaoStudioDeviceDeviceMessage): void {
    const ref = connection.ref
    if (ref === undefined) {
      Errors.throwUnexpected('A device message arrived on a connection without a session.')
    }
    // Nothing a device says is acted on before a person confirmed the pairing. A ping is answered
    // because it is the device's only way to learn the connection is alive while it waits, and it
    // carries nothing; every other message — a log line, a report, a selection — would put an
    // unconfirmed device's text in front of the person who is deciding whether to trust it.
    if (connection.state !== 'connected') {
      this.#sendSealed(
        connection,
        message.type === 'device.ping'
          ? { type: 'studio.pong' }
          : { code: 'pairing-pending', message: 'Studio has not confirmed pairing yet.', type: 'studio.error' },
      )
      return
    }
    Switch.on(message, 'type', {
      'device.applied': applied => this.#deviceApplied(connection, ref, applied),
      'device.log': logged => this.#deviceLog(connection, logged.entries),
      'device.ping': () => this.#sendSealed(connection, { type: 'studio.pong' }),
      'device.report': reported => this.#deviceReport(connection, ref, reported.level, reported.message),
      'device.runtimeCaptureFailed': failed => this.#resolveCapture(failed.requestId, { error: failed.error }),
      'device.runtimeCaptured': captured => this.#resolveCapture(captured.requestId, { capture: captured.capture }),
      'device.selectCell': selected => this.#assign(connection, selected.cellId),
      'device.selectSource': selected => this.#deviceSelectSource(ref, selected.occurrence),
      'device.setNetwork': chosen => this.#deviceSetNetwork(connection, ref, chosen.network),
      'device.sourceAction': action => void this.#applyDeviceSourceAction(connection, ref, action),
    })
  }

  /**
   * Straight into Studio's own output, where a person driving Studio is already looking. The lines
   * also still print on the phone, so a dropped connection loses the mirror, not the log.
   */
  #deviceLog(connection: Connection, entries: readonly TaoStudioDeviceLogEntry[]): void {
    const name = deviceText(connection.device?.name ?? 'unknown')
    for (const entry of entries) {
      this.#log(`device ${name} ${entry.level}: ${deviceText(entry.message)}`)
    }
  }

  #deviceReport(
    connection: Connection,
    ref: StudioDeviceGatewaySessionRef,
    level: 'error' | 'info',
    message: string,
  ): void {
    const reported = deviceText(message)
    connection.lastReport = { level, message: reported }
    this.#log(`device ${deviceText(connection.device?.name ?? 'unknown')} ${level}: ${reported}`)
    this.#emit(ref.sessionId)
  }

  #deviceSelectSource(ref: StudioDeviceGatewaySessionRef, occurrence: TaoStudioDeviceOccurrence): void {
    const state = this.#states.get(ref.sessionId)
    if (state === undefined) {
      return
    }
    state.selection = { ...occurrence, sequence: ++this.#selectionSequence }
    this.#emit(ref.sessionId)
  }

  #deviceSetNetwork(
    connection: Connection,
    ref: StudioDeviceGatewaySessionRef,
    condition: TaoStudioDeviceNetworkCondition,
  ): void {
    const assignment = connection.assignment
    if (assignment === undefined) {
      return
    }
    // Studio owns the figures behind each named condition; the phone chooses the situation.
    const network = condition === 'offline'
      ? { latencyMs: 0, outcome: 'offline' as const }
      : condition === 'slow'
      ? { latencyMs: 1_200, outcome: 'normal' as const }
      : { latencyMs: 0, outcome: 'normal' as const }
    try {
      // An environment is reconfigured whole, so the chosen condition is merged into the one the
      // cell is already under rather than replacing it — the phone is changing the network, not
      // resetting the scheme and viewport with it.
      const current = (ref.session.previewCellInstance(assignment.previewInstanceId) as {
        cell?: { environment?: Record<string, unknown> }
      }).cell?.environment ?? {}
      // The whole identity, because a reconfigure is refused against a cell revision that has
      // moved on — the phone names a condition, Studio decides whether the cell is still current.
      ref.session.reconfigureCell({
        appName: assignment.identity.appName,
        cellId: assignment.identity.cellId,
        cellRevision: assignment.identity.cellRevision,
        compileRevision: assignment.identity.compileRevision,
        environment: { ...current, network },
        manifestRevision: assignment.identity.manifestRevision,
        project: ref.session.projectRoot,
      })
      connection.lastError = undefined
    } catch (error) {
      connection.lastError = Errors.formatForUser(error)
    }
    this.#emit(ref.sessionId)
  }

  /** A request with no pending entry was already timed out or already answered; the answer is dropped. */
  #resolveCapture(requestId: string, result: { capture?: unknown; error?: string }): void {
    const pending = this.#captures.get(requestId)
    if (pending === undefined) {
      return
    }
    this.#captures.delete(requestId)
    clearTimeout(pending.timer)
    pending.resolve(result)
  }

  #deviceApplied(
    connection: Connection,
    ref: StudioDeviceGatewaySessionRef,
    message: Extract<TaoStudioDeviceDeviceMessage, { type: 'device.applied' }>,
  ): void {
    let accepted = false
    let refused = false
    try {
      accepted = ref.session.acknowledgePreview({
        appliedRevision: message.appliedRevision,
        channel: studioProtocolChannel,
        compileRevision: message.compileRevision,
        identity: {
          appName: message.identity.appName,
          cellId: message.identity.cellId,
          cellRevision: message.identity.cellRevision,
          compileRevision: message.identity.compileRevision,
          manifestRevision: message.identity.manifestRevision,
          previewInstanceId: message.identity.previewInstanceId,
          project: ref.session.projectRoot,
        },
        protocolVersion: studioProtocolVersion,
        type: 'preview-applied',
      })
      connection.lastError = undefined
    } catch (error) {
      refused = true
      connection.lastError = Errors.formatForUser(error)
    }
    // Two answers mean the claim is real. `accepted` is the coordinator advancing to it. A plain
    // `false` without a throw is not a refusal — the coordinator also answers that when the browser
    // canvas already acknowledged this revision — so it still counts, but only up to the revision
    // the coordinator has actually seen applied, which it only ever advances for a revision that
    // compiled. `compileRevision` would be the wrong bound: it is incremented when a compile
    // *starts* and stays incremented when that compile fails, so bounding by it would let a device
    // claim "applied ✓" for a revision that never produced a bundle. A throw is the session refusing
    // the identity outright (stale, wrong instance), and proves nothing about the device at all.
    const snapshot = ref.session.compileSnapshot()
    const claimProven = accepted || (!refused && message.appliedRevision <= snapshot.appliedRevision)
    if (claimProven) {
      connection.appliedRevision = message.appliedRevision
    }
    this.#sendSealed(connection, { accepted, compileRevision: message.compileRevision, type: 'studio.appliedAck' })
    this.#emit(ref.sessionId)
  }

  #sendClear(connection: Connection, message: unknown): void {
    const socket = connection.socket
    if (socket === undefined || connection.state === 'closed') {
      return
    }
    try {
      socket.send(JSON.stringify(message))
    } catch (error) {
      this.#log(`could not send to device: ${Errors.formatForLog(error)}`)
    }
  }

  #sendSealed(connection: Connection, message: TaoStudioDeviceStudioMessage): void {
    const keys = connection.keys
    if (keys === undefined || connection.state === 'closed') {
      return
    }
    connection.sendSeq += 1
    this.#sendClear(connection, StudioDeviceTrust.seal(keys, connection.sendSeq, message))
  }

  #reject(connection: Connection, code: TaoStudioDeviceRejectCode, message: string): void {
    if (connection.state === 'closed') {
      return
    }
    this.#sendClear(connection, { code, message, type: 'studio.rejected' })
    const socket = connection.socket
    this.#dispose(connection)
    try {
      socket?.close(code === 'revoked' ? closeCodes.revoked : closeCodes.rejected, code)
    } catch {
      // The peer may already be gone; the connection is disposed either way.
    }
    this.#logRejection(connection, code)
  }

  /**
   * A phone that is waiting for pairing knocks every few seconds, so the same two lines would fill
   * the Studio log. One streak of identical outcomes from one address is reported once, then every
   * tenth knock, and the counter resets as soon as anything else happens on that address.
   */
  #logConnectionAttempt(connection: Connection): void {
    if (this.#repeatedOutcome?.address !== connection.peerAddress) {
      this.#log(`device connection from ${connection.peerAddress}`)
    }
  }

  #logRejection(connection: Connection, code: TaoStudioDeviceRejectCode): void {
    const address = connection.peerAddress
    const repeated = this.#repeatedOutcome
    const streak = repeated !== undefined && repeated.address === address && repeated.code === code
      ? repeated.count + 1
      : 1
    this.#repeatedOutcome = { address, code, count: streak }
    if (streak === 1) {
      this.#log(`device connection rejected: ${code}`)
      return
    }
    if (streak % 10 === 0) {
      this.#log(`device connection rejected: ${code} (${streak} times from ${address})`)
    }
  }

  #dispose(connection: Connection): void {
    if (connection.state === 'closed') {
      return
    }
    connection.state = 'closed'
    clearTimeout(connection.handshakeTimer)
    connection.handshakeTimer = undefined
    connection.unsubscribe?.()
    connection.unsubscribe = undefined
    this.#releaseInstance(connection)
    this.#connections.delete(connection)
    const sessionId = connection.ref?.sessionId
    if (sessionId !== undefined) {
      const state = this.#states.get(sessionId)
      if (state?.pending === connection) {
        state.pending = undefined
      }
      this.#emit(sessionId)
    }
  }

  /** A device holds at most one live instance; the browser keeps its own instances of the same cell. */
  #releaseInstance(connection: Connection): void {
    const previewInstanceId = connection.previewInstanceId
    if (previewInstanceId === undefined) {
      return
    }
    connection.previewInstanceId = undefined
    try {
      connection.ref?.session.unregisterCellPreview(previewInstanceId)
    } catch (error) {
      connection.lastError = Errors.formatForUser(error)
    }
  }

  #closePairing(sessionId: string, reason: string): void {
    const state = this.#states.get(sessionId)
    if (state === undefined) {
      return
    }
    if (state.pairing !== undefined) {
      clearTimeout(state.pairing.timer)
      state.pairing = undefined
    }
    const pending = state.pending
    state.pending = undefined
    if (pending !== undefined && pending.state !== 'connected') {
      this.#reject(pending, 'pairing-closed', reason)
    }
    this.#emit(sessionId)
  }

  #pendingConnection(sessionId: string, devicePublicKey: string): Connection {
    this.#requireSession(sessionId)
    const pending = this.#states.get(sessionId)?.pending
    if (pending === undefined || pending.state !== 'pairing' || pending.devicePublicKey !== devicePublicKey) {
      Errors.throwUserInput('No device with that key is waiting to pair with this project.')
    }
    return pending
  }

  #liveConnection(sessionId: string): Connection | undefined {
    let found: Connection | undefined
    for (const connection of this.#connections) {
      if (
        connection.ref?.sessionId === sessionId && (connection.state === 'connected' || connection.state === 'pairing')
      ) {
        found = connection
      }
    }
    return found
  }

  #resolveSession(hello: TaoStudioDeviceHelloMessage): StudioDeviceGatewaySessionRef | undefined {
    if (hello.sessionId !== undefined) {
      return this.#sessions.get(hello.sessionId)
    }
    if (hello.metroPort === undefined) {
      return undefined
    }
    return this.#sessions.list().find(ref => previewPort(ref.previewUrl) === hello.metroPort)
  }

  #requireSession(sessionId: string): StudioDeviceGatewaySessionRef {
    const ref = this.#sessions.get(sessionId)
    if (ref === undefined) {
      Errors.throwUserInput('Studio session is not open.')
    }
    return ref
  }

  #state(sessionId: string): SessionState {
    let state = this.#states.get(sessionId)
    if (state === undefined) {
      state = { listeners: new Set() }
      this.#states.set(sessionId, state)
    }
    return state
  }

  #emit(sessionId: string): void {
    const state = this.#states.get(sessionId)
    if (state === undefined || state.listeners.size === 0) {
      return
    }
    const status = this.status(sessionId)
    for (const listener of state.listeners) {
      try {
        listener(status)
      } catch (error) {
        this.#log(`device status listener failed: ${Errors.formatForLog(error)}`)
      }
    }
  }

  async #refreshHosts(): Promise<void> {
    try {
      this.#hosts = [...await this.#hostsProvider()]
    } catch (error) {
      this.#log(`could not list gateway hosts: ${Errors.formatForLog(error)}`)
    }
  }

  #scheduleTrustRefresh(): void {
    this.#trustRefreshTimer = setTimeout(() => {
      this.#trustRefreshTimer = undefined
      void this.#refreshTrust().finally(() => {
        if (!this.#stopped) {
          this.#scheduleTrustRefresh()
        }
      })
    }, this.#trustRefreshMs)
  }

  async #refreshTrust(): Promise<void> {
    try {
      await this.#store.refresh()
    } catch (error) {
      this.#log(`could not refresh device trust: ${Errors.formatForLog(error)}`)
      return
    }
    const affected = new Set<string>()
    for (const connection of [...this.#connections]) {
      if (
        connection.state === 'connected'
        && connection.devicePublicKey !== undefined
        && !this.#store.isTrusted(connection.devicePublicKey)
      ) {
        if (connection.ref !== undefined) {
          affected.add(connection.ref.sessionId)
        }
        this.#sendSealed(connection, { reason: 'Studio revoked this device.', type: 'studio.revoked' })
        this.#reject(connection, 'revoked', 'Studio revoked this device.')
      }
    }
    for (const sessionId of affected) {
      this.#emit(sessionId)
    }
  }
}

/** deviceManifest projects the browser manifest onto what a device may know: cells and labels. */
/**
 * The bootstrap record a device renders, minus `identity`. That field carries the project's absolute
 * root and a second copy of the cell id, and the gateway otherwise never lets a device learn the
 * root — it substitutes `ref.session.projectRoot` for whatever a device claims. The device host
 * reads only `cell`, `resolvedState`, and `replay` (`runtime-toolchain`'s `studioCellRuntime`), so
 * dropping it changes no behaviour. What remains in `cell` still embeds the source path: making a
 * device genuinely path-free means changing the compiler's identifier scheme, which the Metro
 * bundle bakes in and the browser canvas shares — see this slice's known limitations.
 */
/** How much of one device-supplied line Studio mirrors; a phone cannot flood the log with one report. */
const deviceTextLimit = 500

/**
 * deviceText makes a device-supplied string safe to put on one line of Studio's log or in the
 * popover. A device chooses its own name and writes its own log lines, so those strings can carry a
 * newline that forges a second log entry, or an ANSI escape that repaints the terminal the person is
 * reading Studio's output in. Every control character becomes a space and the line is bounded.
 */
function deviceText(value: string): string {
  const flattened = [...value].map(character => (/\p{Cc}|\p{Cf}/u.test(character) ? ' ' : character)).join('')
  return flattened.length > deviceTextLimit ? `${flattened.slice(0, deviceTextLimit)}…` : flattened
}

function deviceCellRuntime(runtime: unknown): unknown {
  if (typeof runtime !== 'object' || runtime === null) {
    return runtime
  }
  const { identity: _identity, ...rest } = runtime as Record<string, unknown>
  return rest
}

function deviceManifest(manifest: StudioPreviewManifestV2): TaoStudioDeviceManifest {
  const scenarios = new Map(manifest.scenarios.map(scenario => [scenario.scenarioId, scenario]))
  return {
    compileRevision: manifest.compileRevision,
    manifestRevision: manifest.manifestRevision,
    scenarios: manifest.cells.map(cell => {
      const scenario = scenarios.get(cell.scenarioId)
      return {
        cellId: cell.cellId,
        cellRevision: cell.cellRevision,
        group: scenario?.group ?? '',
        label: scenario?.label ?? cell.scenarioId,
        scenarioId: cell.scenarioId,
        viewport: {
          height: Math.max(1, Math.round(cell.environment.viewport.height)),
          width: Math.max(1, Math.round(cell.environment.viewport.width)),
        },
      }
    }),
  }
}

function compileState(snapshot: StudioCompileSnapshot): TaoStudioDeviceCompileState {
  return {
    appliedRevision: snapshot.appliedRevision,
    compileRevision: snapshot.compileRevision,
    message: snapshot.message,
    status: snapshot.status,
  }
}

function connectionSnapshot(connection: Connection): StudioDeviceConnection {
  return {
    ...(connection.appliedRevision === undefined ? {} : { appliedRevision: connection.appliedRevision }),
    ...(connection.cellId === undefined ? {} : { cellId: connection.cellId }),
    device: { ...(connection.device ?? { model: '', name: 'Unknown device', os: '' }) },
    fingerprint: connection.devicePublicKey === undefined
      ? ''
      : StudioDeviceTrust.fingerprint(connection.devicePublicKey),
    ...(connection.lastError === undefined ? {} : { lastError: connection.lastError }),
    ...(connection.lastReport === undefined ? {} : { lastReport: { ...connection.lastReport } }),
    ...(connection.socket === undefined ? {} : { remoteAddress: connection.socket.remoteAddress }),
    ...(connection.scenarioLabel === undefined ? {} : { scenarioLabel: connection.scenarioLabel }),
    state: connection.state === 'pairing' ? 'pairing' : connection.state === 'connected' ? 'connected' : 'handshaking',
    transport: 'lan',
  }
}

function previewPort(previewUrl: string | undefined): number | undefined {
  if (previewUrl === undefined) {
    return undefined
  }
  try {
    const url = new URL(previewUrl)
    if (url.port !== '') {
      return Number(url.port)
    }
    return url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : undefined
  } catch {
    return undefined
  }
}
