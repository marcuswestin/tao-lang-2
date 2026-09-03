/**
 * The device side of tao-studio-device-v1: one state machine that dials the Studio gateway, runs
 * the authenticated handshake, keeps the sealed control plane alive, and publishes an immutable
 * snapshot for the native host to render. Everything that touches the platform — the socket, the
 * keychain, timers, the clock — is injected, so the machine runs unchanged under Bun tests and on
 * the device. `TR-studio-device-host.tsx` supplies the React Native wiring.
 */

import { RuntimeAssert } from './TR-assert'
import { errorDetail, errorMessage } from './TR-errors'
import {
  StudioDeviceProtocol,
  type TaoStudioDeviceCellCode,
  type TaoStudioDeviceCellIdentity,
  type TaoStudioDeviceCompileState,
  type TaoStudioDeviceDescription,
  type TaoStudioDeviceDeviceMessage,
  type TaoStudioDeviceHelloMessage,
  type TaoStudioDeviceManifest,
  type TaoStudioDeviceMoveRender,
  type TaoStudioDeviceOccurrence,
  TaoStudioDeviceProtocol,
  type TaoStudioDeviceRejectCode,
  type TaoStudioDeviceRejectedMessage,
  type TaoStudioDeviceSealedFrame,
  type TaoStudioDeviceStudioHelloMessage,
  type TaoStudioDeviceStudioMessage,
} from './TR-studio-device-protocol'
import {
  StudioDeviceTrust,
  StudioDeviceTrustError,
  type TaoStudioDeviceEphemeral,
  type TaoStudioDeviceIdentity,
  type TaoStudioDeviceSessionKeys,
} from './TR-studio-device-trust'

/** One WebSocket-shaped connection the client drives; the transport assigns the handlers it sets. */
export type TaoStudioDeviceSocket = {
  close(code?: number, reason?: string): void
  onclose?: (code: number, reason: string) => void
  onerror?: (error: unknown) => void
  onmessage?: (text: string) => void
  onopen?: () => void
  send(text: string): void
}

export type TaoStudioDeviceTransport = {
  connect(url: string): TaoStudioDeviceSocket
}

/** The one record the device keeps: its long-term identity and the Studio key it has pinned. */
export type TaoStudioDeviceStoredRecord = {
  identity: TaoStudioDeviceIdentity
  pinnedStudioKey?: string
}

export type TaoStudioDeviceStorage = {
  clear(): Promise<void>
  load(): Promise<TaoStudioDeviceStoredRecord | undefined>
  save(record: TaoStudioDeviceStoredRecord): Promise<void>
}

/** The non-secret facts a loaded bundle needs to find and introduce itself to the gateway. */
export type TaoStudioDeviceBootstrap = {
  /** Gateway WebSocket URLs, in the order to try them. */
  candidates: readonly string[]
  device: TaoStudioDeviceDescription
  metroPort?: number
  sessionId?: string
}

export type TaoStudioDeviceTimers = {
  clearTimeout(handle: unknown): void
  setTimeout(callback: () => void, delayMs: number): unknown
}

export type StudioDeviceClientOptions = {
  backoff?: { initialMs?: number; maxMs?: number }
  bootstrap: TaoStudioDeviceBootstrap
  /**
   * Produces the runtime capture Studio asks for. Injected rather than imported so this client stays
   * free of the capture registry, and so a test can hand it a capture that fails.
   */
  captureRuntime?: () => Promise<unknown>
  frameLimitBytes?: number
  handshakeTimeoutMs?: number
  now?: () => number
  storage: TaoStudioDeviceStorage
  timers?: TaoStudioDeviceTimers
  transport: TaoStudioDeviceTransport
}

export type TaoStudioDeviceClientPhase =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'handshaking'
  | 'idle'
  | 'pairing'

/**
 * A snapshot error code is a protocol reject code or one of the client's own: `closed` for a socket
 * that ended without a rejection, `heartbeat-timeout` for a Studio that stopped answering pings,
 * `storage` for a keychain failure, `transport` for a socket the platform could not open, and
 * `unsealed` for a frame that failed authentication.
 */
export type TaoStudioDeviceClientErrorCode =
  | TaoStudioDeviceRejectCode
  | 'closed'
  | 'heartbeat-timeout'
  | 'storage'
  | 'transport'
  | 'unsealed'

export type TaoStudioDeviceClientError = Readonly<{
  code: TaoStudioDeviceClientErrorCode | string
  message: string
}>

export type TaoStudioDeviceWelcome = Readonly<{
  appName: string
  capabilities: readonly string[]
  heartbeatMs: number
  projectLabel: string
  sessionId: string
}>

export type TaoStudioDeviceAssignment = Readonly<{
  identity: TaoStudioDeviceCellIdentity
  runtime: unknown
}>

/** The immutable snapshot the host renders; every change publishes a new frozen object. */
export type TaoStudioDeviceClientState = Readonly<{
  appliedAck?: Readonly<{ accepted: boolean; compileRevision: number }>
  appliedRevision?: number
  assignment?: TaoStudioDeviceAssignment
  /** Consecutive failed connection rounds; the backoff exponent. Resets on a welcome. */
  attempts: number
  cellUnavailable?: Readonly<{ cellId: string; code: TaoStudioDeviceCellCode; message: string }>
  /** The formatted short authentication string, present only while pairing. */
  code?: string
  compile?: TaoStudioDeviceCompileState
  deviceFingerprint?: string
  /** What Studio asked this device to outline, so a selection made on the Mac is visible on screen. */
  highlight?: TaoStudioDeviceOccurrence
  host?: string
  lastError?: TaoStudioDeviceClientError
  manifest?: TaoStudioDeviceManifest
  phase: TaoStudioDeviceClientPhase
  /** When the next automatic dial is due, in the injected clock's milliseconds. */
  retryAt?: number
  selectedCellId?: string
  /** The outcome of the last edit this device asked Studio to make, so the phone can report it. */
  sourceAction?: Readonly<{ error?: string; ok: boolean; requestId: string }>
  studioFingerprint?: string
  transport: 'lan'
  welcome?: TaoStudioDeviceWelcome
}>

export type StudioDeviceClient = {
  applied(identity: TaoStudioDeviceCellIdentity, compileRevision: number): void
  forgetStudio(): Promise<void>
  reconnect(): void
  report(level: 'error' | 'info', message: string): void
  selectCell(cellId: string): void
  /** Tells Studio which render the person tapped, so the Mac opens that source and selects it. */
  selectSource(occurrence: TaoStudioDeviceOccurrence): void
  /** Asks Studio to edit the project from the device; returns the request id the result names. */
  sourceAction(action: TaoStudioDeviceMoveRender, occurrence: TaoStudioDeviceOccurrence): string
  start(): Promise<void>
  state(): TaoStudioDeviceClientState
  stop(): void
  subscribe(listener: (state: TaoStudioDeviceClientState) => void): () => void
}

type Attempt = {
  candidateIndex: number
  ephemeral?: TaoStudioDeviceEphemeral
  handshakeTimer?: unknown
  heartbeat?: { pending: number; timer: unknown }
  keys?: TaoStudioDeviceSessionKeys
  nonce?: string
  receiveSeq: number
  sendSeq: number
  settled: boolean
  socket: TaoStudioDeviceSocket
  studioPublicKey?: string
  welcomed: boolean
}

const defaultBackoff = { initialMs: 1_000, maxMs: 15_000 } as const
const normalCloseCode = 1_000
const protocolCloseCode = 4_000

/**
 * Rejections that describe Studio's momentary state rather than a trust decision. A closed pairing
 * window is one of them: the phone is launched first and pairing is opened afterwards, so an
 * unknown device keeps knocking until someone opens the window or closes the app. Everything else
 * — a declined pairing, a revoked or unknown device, a key or protocol mismatch, another instance
 * taking over — is an answer about this device, and stays disconnected until a person reconnects.
 */
const transientRejectCodes: ReadonlySet<string> = new Set<TaoStudioDeviceRejectCode>([
  'gateway-stopped',
  'pairing-closed',
  'timeout',
  'unknown-session',
])

const socketHostPattern = /^wss?:\/\/(\[[^\]]+\]|[^/:?#]+)(:\d+)?/

/** createStudioDeviceClient builds one device client over injected platform seams. */
export function createStudioDeviceClient(options: StudioDeviceClientOptions): StudioDeviceClient {
  RuntimeAssert(options.bootstrap.candidates.length > 0, 'at least one gateway candidate URL')
  const timers: TaoStudioDeviceTimers = options.timers ?? {
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  }
  const now = options.now ?? (() => Date.now())
  const frameLimitBytes = options.frameLimitBytes ?? TaoStudioDeviceProtocol.frameLimitBytes
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? TaoStudioDeviceProtocol.handshakeTimeoutMs
  const backoff = { ...defaultBackoff, ...options.backoff }
  const listeners = new Set<(state: TaoStudioDeviceClientState) => void>()

  let snapshot: TaoStudioDeviceClientState = Object.freeze({ attempts: 0, phase: 'idle', transport: 'lan' })
  let identity: TaoStudioDeviceIdentity | undefined
  let pinnedStudioKey: string | undefined
  let current: Attempt | undefined
  let retryTimer: unknown
  let started = false
  /** Numbers this device's edit requests so a result can be matched to the request that caused it. */
  let sourceActionCounter = 0

  const update = (patch: Partial<TaoStudioDeviceClientState>): void => {
    const next: Record<string, unknown> = { ...snapshot }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete next[key]
      } else {
        next[key] = value
      }
    }
    snapshot = Object.freeze(next) as TaoStudioDeviceClientState
    for (const listener of listeners) {
      listener(snapshot)
    }
  }

  const persist = async (): Promise<void> => {
    if (identity === undefined) {
      return
    }
    try {
      await options.storage.save({
        identity,
        ...(pinnedStudioKey === undefined ? {} : { pinnedStudioKey }),
      })
    } catch (error) {
      update({ lastError: { code: 'storage', message: errorMessage(error) } })
    }
  }

  const clearRetry = (): void => {
    if (retryTimer !== undefined) {
      timers.clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  const settle = (attempt: Attempt, closeCode: number, reason: string): void => {
    if (attempt.settled) {
      return
    }
    attempt.settled = true
    if (attempt.handshakeTimer !== undefined) {
      timers.clearTimeout(attempt.handshakeTimer)
      attempt.handshakeTimer = undefined
    }
    if (attempt.heartbeat !== undefined) {
      timers.clearTimeout(attempt.heartbeat.timer)
      attempt.heartbeat = undefined
    }
    try {
      attempt.socket.close(closeCode, reason)
    } catch {
      // The socket is already gone; there is nothing left to release.
    }
    if (current === attempt) {
      current = undefined
    }
  }

  const scheduleRetry = (): void => {
    clearRetry()
    const attempts = snapshot.attempts + 1
    const delayMs = Math.min(backoff.initialMs * 2 ** (attempts - 1), backoff.maxMs)
    retryTimer = timers.setTimeout(() => {
      retryTimer = undefined
      dial(0)
    }, delayMs)
    update({ attempts, retryAt: now() + delayMs })
  }

  /** failed ends one attempt and decides what follows: the next candidate, a backoff, or a halt. */
  const failed = (
    attempt: Attempt,
    code: TaoStudioDeviceClientError['code'],
    message: string,
    options_: { halt?: boolean } = {},
  ): void => {
    if (attempt.settled) {
      return
    }
    const wasCurrent = current === attempt
    settle(attempt, code === 'closed' ? normalCloseCode : protocolCloseCode, code)
    if (!wasCurrent || !started) {
      return
    }
    const lastError = { code, message }
    const nextCandidate = attempt.candidateIndex + 1
    if (!attempt.welcomed && !options_.halt && nextCandidate < options.bootstrap.candidates.length) {
      update({ lastError })
      dial(nextCandidate)
      return
    }
    update({
      assignment: undefined,
      cellUnavailable: undefined,
      code: undefined,
      lastError,
      phase: 'disconnected',
      welcome: undefined,
    })
    if (!options_.halt) {
      scheduleRetry()
    }
  }

  const redial = (attempt: Attempt): void => {
    settle(attempt, normalCloseCode, 'reconnect')
    if (started) {
      dial(0)
    }
  }

  const sendClear = (
    attempt: Attempt,
    message: TaoStudioDeviceHelloMessage | { signature: string; type: 'device.confirm' },
  ): void => {
    try {
      attempt.socket.send(JSON.stringify(message))
    } catch (error) {
      failed(attempt, 'transport', errorMessage(error))
    }
  }

  const sendSealed = (attempt: Attempt, message: TaoStudioDeviceDeviceMessage): void => {
    if (attempt.settled || attempt.keys === undefined) {
      return
    }
    attempt.sendSeq += 1
    try {
      attempt.socket.send(JSON.stringify(StudioDeviceTrust.seal(attempt.keys, attempt.sendSeq, message)))
    } catch (error) {
      failed(attempt, 'transport', errorMessage(error))
    }
  }

  /**
   * Answers one `studio.captureRuntime`. A capture that throws is reported as a failure against the
   * same request rather than dropped, so the asking side always gets an answer to wait on, and a
   * capture too large for one sealed frame surfaces as that failure rather than as a closed socket.
   */
  const sendCapture = (attempt: Attempt, requestId: string): void => {
    const capture = options.captureRuntime
    if (capture === undefined) {
      sendSealed(attempt, {
        error: 'This device cannot capture runtime state.',
        requestId,
        type: 'device.runtimeCaptureFailed',
      })
      return
    }
    void capture().then(
      artifact => {
        const message: TaoStudioDeviceDeviceMessage = { capture: artifact, requestId, type: 'device.runtimeCaptured' }
        const size = JSON.stringify(message).length
        if (size > frameLimitBytes) {
          sendSealed(attempt, {
            error: `The captured state is ${size} bytes, over the ${frameLimitBytes}-byte frame limit.`,
            requestId,
            type: 'device.runtimeCaptureFailed',
          })
          return
        }
        sendSealed(attempt, message)
      },
      error => {
        sendSealed(attempt, { error: errorMessage(error), requestId, type: 'device.runtimeCaptureFailed' })
      },
    )
  }

  const sendWhenConnected = (message: TaoStudioDeviceDeviceMessage): void => {
    if (current !== undefined && current.welcomed) {
      sendSealed(current, message)
    }
  }

  const startHeartbeat = (attempt: Attempt, intervalMs: number): void => {
    const tick = (): void => {
      if (attempt.settled || attempt.heartbeat === undefined) {
        return
      }
      if (attempt.heartbeat.pending >= 2) {
        failed(attempt, 'heartbeat-timeout', 'Tao Studio stopped answering heartbeats.')
        return
      }
      attempt.heartbeat.pending += 1
      attempt.heartbeat.timer = timers.setTimeout(tick, intervalMs)
      sendSealed(attempt, { type: 'device.ping' })
    }
    attempt.heartbeat = { pending: 0, timer: timers.setTimeout(tick, intervalMs) }
  }

  const receiveStudioHello = (attempt: Attempt, hello: TaoStudioDeviceStudioHelloMessage): void => {
    RuntimeAssert.defined(identity, 'device identity is loaded before a handshake')
    RuntimeAssert.defined(attempt.ephemeral, 'device ephemeral key exists before Studio answers')
    RuntimeAssert.defined(attempt.nonce, 'device nonce exists before Studio answers')
    if (pinnedStudioKey !== undefined && pinnedStudioKey !== hello.studioPublicKey) {
      failed(
        attempt,
        'studio-key-mismatch',
        'This Tao Studio has a different identity than the one this device paired with. '
          + 'Forget Studio on this device to pair again.',
        { halt: true },
      )
      return
    }
    let transcript: Uint8Array
    let keys: TaoStudioDeviceSessionKeys
    let signature: string
    let studioFingerprint: string
    try {
      transcript = StudioDeviceTrust.transcript({
        deviceEphemeralPublicKey: attempt.ephemeral.publicKey,
        deviceNonce: attempt.nonce,
        devicePublicKey: identity.publicKey,
        sessionId: options.bootstrap.sessionId ?? '',
        studioEphemeralPublicKey: hello.ephemeralPublicKey,
        studioNonce: hello.nonce,
        studioPublicKey: hello.studioPublicKey,
      })
      if (!StudioDeviceTrust.verify('studio', transcript, hello.signature, hello.studioPublicKey)) {
        failed(attempt, 'bad-signature', 'Tao Studio did not prove it holds the identity it announced.', {
          halt: true,
        })
        return
      }
      keys = StudioDeviceTrust.deriveSession(
        'device',
        attempt.ephemeral.secretKey,
        hello.ephemeralPublicKey,
        transcript,
      )
      signature = StudioDeviceTrust.sign('device', transcript, identity)
      studioFingerprint = StudioDeviceTrust.fingerprint(hello.studioPublicKey)
    } catch (error) {
      failed(attempt, 'malformed', errorMessage(error))
      return
    }
    attempt.keys = keys
    attempt.studioPublicKey = hello.studioPublicKey
    update({ studioFingerprint })
    sendClear(attempt, { signature, type: 'device.confirm' })
  }

  const receiveRejected = (attempt: Attempt, rejected: TaoStudioDeviceRejectedMessage): void => {
    failed(attempt, rejected.code, rejected.message, { halt: !transientRejectCodes.has(rejected.code) })
  }

  const receiveWelcome = (
    attempt: Attempt,
    welcome: Extract<TaoStudioDeviceStudioMessage, { type: 'studio.welcome' }>,
  ): void => {
    attempt.welcomed = true
    if (attempt.handshakeTimer !== undefined) {
      timers.clearTimeout(attempt.handshakeTimer)
      attempt.handshakeTimer = undefined
    }
    if (attempt.studioPublicKey !== undefined && pinnedStudioKey !== attempt.studioPublicKey) {
      pinnedStudioKey = attempt.studioPublicKey
      void persist()
    }
    update({
      attempts: 0,
      code: undefined,
      compile: welcome.compile,
      lastError: undefined,
      manifest: welcome.manifest,
      phase: 'connected',
      retryAt: undefined,
      welcome: {
        appName: welcome.appName,
        capabilities: welcome.capabilities,
        heartbeatMs: welcome.heartbeatMs,
        projectLabel: welcome.projectLabel,
        sessionId: welcome.sessionId,
      },
    })
    startHeartbeat(attempt, welcome.heartbeatMs)
    selectDefaultCell(attempt)
  }

  /**
   * Studio assigns a cell only when the device names one, so a device with no choice yet asks for
   * the manifest's first scenario; a person's earlier choice wins over that default, including
   * across reconnects.
   */
  const selectDefaultCell = (attempt: Attempt): void => {
    const cellId = snapshot.selectedCellId ?? snapshot.manifest?.scenarios[0]?.cellId
    if (cellId !== undefined) {
      sendSealed(attempt, { cellId, type: 'device.selectCell' })
    }
  }

  const receiveStudioMessage = (attempt: Attempt, message: TaoStudioDeviceStudioMessage): void => {
    if (message.type === 'studio.pairingPending') {
      RuntimeAssert.defined(attempt.keys, 'session keys exist before pairing starts')
      update({ code: StudioDeviceTrust.formatCode(attempt.keys.code), phase: 'pairing' })
    } else if (message.type === 'studio.welcome') {
      receiveWelcome(attempt, message)
    } else if (message.type === 'studio.manifest') {
      update({ manifest: message.manifest })
      if (snapshot.selectedCellId === undefined && snapshot.assignment === undefined) {
        selectDefaultCell(attempt)
      }
    } else if (message.type === 'studio.compileState') {
      update({
        compile: {
          appliedRevision: message.appliedRevision,
          compileRevision: message.compileRevision,
          message: message.message,
          status: message.status,
        },
      })
    } else if (message.type === 'studio.cellAssigned') {
      // Remember the cell whoever chose it, not only the on-device sheet: a reconnect asks for
      // `selectedCellId` and otherwise falls back to the manifest's first scenario, so without this
      // a cell chosen from the workbench is forgotten the moment the client redials — which the
      // background/foreground pause now does routinely.
      update({
        assignment: { identity: message.identity, runtime: message.runtime },
        cellUnavailable: undefined,
        selectedCellId: message.identity.cellId,
      })
    } else if (message.type === 'studio.cellUnavailable') {
      update({ cellUnavailable: { cellId: message.cellId, code: message.code, message: message.message } })
    } else if (message.type === 'studio.appliedAck') {
      update({ appliedAck: { accepted: message.accepted, compileRevision: message.compileRevision } })
    } else if (message.type === 'studio.captureRuntime') {
      sendCapture(attempt, message.requestId)
    } else if (message.type === 'studio.highlightSource') {
      update({ highlight: message.occurrence })
    } else if (message.type === 'studio.sourceActionResult') {
      update({
        sourceAction: {
          ...(message.error === undefined ? {} : { error: message.error }),
          ok: message.ok,
          requestId: message.requestId,
        },
      })
    } else if (message.type === 'studio.reconnect') {
      redial(attempt)
    } else if (message.type === 'studio.revoked') {
      failed(attempt, 'revoked', message.reason, { halt: true })
    } else if (message.type === 'studio.pong') {
      if (attempt.heartbeat !== undefined) {
        attempt.heartbeat.pending = 0
      }
    } else {
      update({ lastError: { code: message.code, message: message.message } })
    }
  }

  const receiveSealed = (attempt: Attempt, frame: TaoStudioDeviceSealedFrame): void => {
    RuntimeAssert.defined(attempt.keys, 'session keys exist before a sealed frame is opened')
    let value: unknown
    try {
      value = StudioDeviceTrust.open(attempt.keys, attempt.receiveSeq + 1, frame)
    } catch (error) {
      failed(attempt, trustFailureCode(error), errorMessage(error))
      return
    }
    attempt.receiveSeq += 1
    const message = StudioDeviceProtocol.parseStudioMessage(value)
    if (message === undefined) {
      update({
        lastError: {
          code: 'unknown-message',
          message: 'Tao Studio sent a control message this device does not understand.',
        },
      })
      return
    }
    receiveStudioMessage(attempt, message)
  }

  const receive = (attempt: Attempt, text: string): void => {
    if (attempt.settled) {
      return
    }
    const limit = attempt.keys === undefined ? TaoStudioDeviceProtocol.helloLimitBytes : frameLimitBytes
    const parsed = StudioDeviceProtocol.parseText(text, limit)
    if (parsed.kind === 'oversized') {
      failed(attempt, 'oversized', `Tao Studio sent a frame above ${limit} bytes.`)
      return
    }
    if (parsed.kind === 'invalid') {
      failed(attempt, 'malformed', 'Tao Studio sent a frame that is not JSON.')
      return
    }
    const message = StudioDeviceProtocol.parseClearMessage(parsed.value)
    if (message === undefined) {
      failed(attempt, 'malformed', 'Tao Studio sent a frame this device does not recognize.')
    } else if (message.type === 'studio.rejected') {
      receiveRejected(attempt, message)
    } else if (message.type === 'studio.hello') {
      if (attempt.keys === undefined) {
        receiveStudioHello(attempt, message)
      } else {
        failed(attempt, 'malformed', 'Tao Studio repeated its hello after the handshake finished.')
      }
    } else if (message.type === 'sealed') {
      if (attempt.keys === undefined) {
        failed(attempt, 'malformed', 'Tao Studio sealed a frame before the handshake finished.')
      } else {
        receiveSealed(attempt, message)
      }
    } else {
      failed(attempt, 'malformed', `Tao Studio sent a device frame '${message.type}'.`)
    }
  }

  const opened = (attempt: Attempt): void => {
    if (attempt.settled) {
      return
    }
    RuntimeAssert.defined(identity, 'device identity is loaded before a socket opens')
    attempt.ephemeral = StudioDeviceTrust.generateEphemeral()
    attempt.nonce = StudioDeviceTrust.generateNonce()
    update({ phase: 'handshaking' })
    sendClear(attempt, {
      device: options.bootstrap.device,
      devicePublicKey: identity.publicKey,
      ephemeralPublicKey: attempt.ephemeral.publicKey,
      ...(options.bootstrap.metroPort === undefined ? {} : { metroPort: options.bootstrap.metroPort }),
      nonce: attempt.nonce,
      ...(pinnedStudioKey === undefined ? {} : { pinnedStudioKey }),
      protocol: TaoStudioDeviceProtocol.name,
      ...(options.bootstrap.sessionId === undefined ? {} : { sessionId: options.bootstrap.sessionId }),
      type: 'device.hello',
    })
  }

  function dial(candidateIndex: number): void {
    if (!started) {
      return
    }
    if (current !== undefined) {
      settle(current, normalCloseCode, 'redial')
    }
    const url = options.bootstrap.candidates[candidateIndex]
    RuntimeAssert.defined(url, 'gateway candidate index is within the candidate list', { candidateIndex })
    const attempt: Attempt = {
      candidateIndex,
      receiveSeq: 0,
      sendSeq: 0,
      settled: false,
      socket: inertSocket,
      welcomed: false,
    }
    current = attempt
    update({
      assignment: undefined,
      cellUnavailable: undefined,
      code: undefined,
      host: socketHost(url),
      phase: 'connecting',
      retryAt: undefined,
      welcome: undefined,
    })
    let socket: TaoStudioDeviceSocket
    try {
      socket = options.transport.connect(url)
    } catch (error) {
      failed(attempt, 'transport', unreachableStudioMessage(url, error))
      return
    }
    attempt.socket = socket
    socket.onopen = () => opened(attempt)
    socket.onmessage = text => receive(attempt, text)
    socket.onclose = (code, reason) =>
      failed(attempt, 'closed', reason.trim().length > 0 ? reason : `The connection closed (${code}).`)
    socket.onerror = error => failed(attempt, 'transport', unreachableStudioMessage(url, error))
    attempt.handshakeTimer = timers.setTimeout(() => {
      failed(attempt, 'timeout', `Tao Studio did not finish the handshake within ${handshakeTimeoutMs}ms.`)
    }, handshakeTimeoutMs)
  }

  const loadIdentity = async (): Promise<void> => {
    let record: TaoStudioDeviceStoredRecord | undefined
    try {
      record = await options.storage.load()
    } catch (error) {
      update({ lastError: { code: 'storage', message: errorMessage(error) } })
    }
    if (record !== undefined && StudioDeviceTrust.validPublicKey(record.identity.publicKey)) {
      identity = record.identity
      pinnedStudioKey = record.pinnedStudioKey
    } else {
      identity = StudioDeviceTrust.generateIdentity()
      pinnedStudioKey = undefined
      await persist()
    }
    update({ deviceFingerprint: StudioDeviceTrust.fingerprint(identity.publicKey) })
  }

  return {
    /**
     * The revision is the one the caller has on screen. The client cannot check it against a
     * revision of its own: Fast Refresh replaces the bundle under a live client, so any copy the
     * client kept from construction is stale by exactly the amount that matters here. The host
     * compares the assignment against its live bundle revision to decide the stale-bundle overlay.
     */
    applied(cellIdentity, compileRevision) {
      sendWhenConnected({
        appliedRevision: compileRevision,
        compileRevision,
        identity: cellIdentity,
        type: 'device.applied',
      })
      update({ appliedRevision: compileRevision })
    },
    async forgetStudio() {
      pinnedStudioKey = undefined
      update({ lastError: undefined, studioFingerprint: undefined })
      await persist()
      if (started) {
        clearRetry()
        dial(0)
      }
    },
    reconnect() {
      if (!started) {
        return
      }
      clearRetry()
      update({ attempts: 0, lastError: undefined, retryAt: undefined })
      if (identity !== undefined) {
        dial(0)
      }
    },
    report(level, message) {
      sendWhenConnected({ level, message, type: 'device.report' })
    },
    selectCell(cellId) {
      RuntimeAssert(cellId.trim().length > 0, 'a selected cell id is not empty')
      update({ selectedCellId: cellId })
      sendWhenConnected({ cellId, type: 'device.selectCell' })
    },
    selectSource(occurrence) {
      sendWhenConnected({ occurrence, type: 'device.selectSource' })
    },
    sourceAction(action, occurrence) {
      const requestId = `device-${++sourceActionCounter}`
      update({ sourceAction: undefined })
      sendWhenConnected({ action, occurrence, requestId, type: 'device.sourceAction' })
      return requestId
    },
    async start() {
      if (started) {
        return
      }
      started = true
      if (identity === undefined) {
        await loadIdentity()
      }
      if (started && current === undefined && retryTimer === undefined) {
        dial(0)
      }
    },
    state: () => snapshot,
    stop() {
      started = false
      clearRetry()
      if (current !== undefined) {
        settle(current, normalCloseCode, 'stopped')
      }
      update({
        assignment: undefined,
        attempts: 0,
        cellUnavailable: undefined,
        code: undefined,
        phase: 'idle',
        retryAt: undefined,
        welcome: undefined,
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

const inertSocket: TaoStudioDeviceSocket = {
  close() {},
  send() {},
}

function trustFailureCode(error: unknown): TaoStudioDeviceClientErrorCode {
  if (error instanceof StudioDeviceTrustError) {
    if (error.code === 'replayed-frame') {
      return 'replayed-frame'
    }
    if (error.code === 'unsealed') {
      return 'unsealed'
    }
  }
  return 'malformed'
}

/** socketHost reads the host and port a gateway URL names, for the snapshot and the overlay. */
export function socketHost(url: string): string | undefined {
  const match = socketHostPattern.exec(url)
  return match === null ? undefined : `${match[1]}${match[2] ?? ''}`
}

/**
 * A socket that never opened reports an event, not an error: React Native and the browser both hand
 * the handler a bare `Event`. The address the device dialed is the fact that helps, so the message
 * names it and appends whatever the platform did say.
 */
export function unreachableStudioMessage(url: string, error: unknown): string {
  const detail = errorDetail(error)
  const endpoint = socketHost(url) ?? url
  return detail === undefined
    ? `Tao Studio at ${endpoint} could not be reached.`
    : `Tao Studio at ${endpoint} could not be reached: ${detail}`
}
