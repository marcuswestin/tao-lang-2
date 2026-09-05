import type TR from '@runtime/TR'
import { Errors } from '@shared/core'

/** Every failure this client raises is the dev server's absence or refusal: a host-environment error. */
function hostError(message: string): Error {
  return new Errors.HostEnvironmentError(message)
}

/**
 * DevProvider is the device side of tao-dev-data-v1: one WebSocket per connection to the dev data
 * server that `tao dev` and Studio host, keyed by the app the dev server is running and the
 * datasource's storage key. The server holds the snapshot; this client loads it on open, saves
 * through an acknowledged frame, and receives every peer's snapshot as it lands. A dropped socket
 * reconnects on its own and the server's current snapshot replaces local state when it does.
 *
 * Everything that touches the platform — the Expo manifest, the bundle URL, the socket, timers —
 * arrives through `DevDataHost`, so Bun tests drive the same code the device runs.
 */

/** The wire contract; `packages/dev/dev-src/dev-data/DevDataServer.ts` mirrors it and must stay in step. */
export const DevDataProtocol = {
  /** The Expo manifest key (`expo.extra.taoDevData`) a development build reads its bootstrap from. */
  manifestKey: 'taoDevData',
  name: 'tao-dev-data-v1',
  path: '/data',
  probePath: '/data/probe',
  reconnect: { initialMs: 500, maxMs: 5_000 },
  /** A dial that has neither opened nor failed by then is treated as failed and retried. */
  connectTimeoutMs: 4_000,
} as const

export type DevDataClientMessage =
  | { seq: number; snapshot: string; type: 'save' }
  | { seq: number; type: 'reset' }
  /** load asks for the stream's current snapshot again; the server answers it before the ack. */
  | { seq: number; type: 'load' }

export type DevDataServerMessage =
  | { revision: number; snapshot: string | null; type: 'snapshot' }
  | { revision: number; seq: number; type: 'ack' }
  | { message: string; seq: number; type: 'rejected' }

/** The non-secret facts written into a development build's Expo manifest by the dev server. */
export type DevDataManifest = {
  app: string
  port: number
  protocol: typeof DevDataProtocol.name
}

/** One WebSocket-shaped connection; the host assigns the handlers the client sets. */
export type DevDataSocket = {
  close(): void
  onclose?: (reason: string) => void
  onerror?: (error: unknown) => void
  onmessage?: (text: string) => void
  onopen?: () => void
  send(text: string): void
}

export type DevDataBootstrap =
  | { app: string; kind: 'ready'; serverUrl: string }
  | { kind: 'missing'; missing: readonly string[] }

export type DevDataHost = {
  /**
   * bootstrap names the server for one connection attempt. It runs again on every attempt, so a
   * dev server restarted on a new port is found without relaunching the app.
   */
  bootstrap(): DevDataBootstrap | Promise<DevDataBootstrap>
  connect(url: string): DevDataSocket
  /** Overrides the protocol's dial bound; a test shortens it. */
  connectTimeoutMs?: number
  timers?: {
    clearTimeout(handle: unknown): void
    setTimeout(callback: () => void, delayMs: number): unknown
  }
}

const appNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const scriptUrlPattern = /^(?:https?|wss?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/

/** DevProvider syncs full datasource snapshots through the Tao dev server's data service. */
export function DevProvider(loadHost: () => DevDataHost = nativeDevDataHost): TR.DataProvider {
  return {
    connect: context => createDevDataConnection(loadHost(), context.storageKey),
  }
}

/** devDataSocketUrl names one (app, storage key) stream on the dev data server. */
export function devDataSocketUrl(serverUrl: string, app: string, storageKey: string): string {
  return `${serverUrl.replace(/\/$/, '')}${DevDataProtocol.path}?app=${encodeURIComponent(app)}&key=${
    encodeURIComponent(storageKey)
  }`
}

/**
 * resolveDevDataBootstrap turns what a loaded bundle can observe into the server URL and app key,
 * or names what is missing. The host is the one the bundle itself loaded from: `location` on web,
 * the bundle URL on a device — the same place Expo's dev server lives, which the dev data server
 * runs beside.
 */
export function resolveDevDataBootstrap(input: {
  bundleHost: string | undefined
  manifest: unknown
  /** The sentence reported when `bundleHost` is absent, naming where the host was looked for. */
  missingHost: string
}): DevDataBootstrap {
  const missing: string[] = []
  const manifest = readManifest(input.manifest)
  if (manifest === undefined) {
    missing.push(
      `the Expo manifest carries no ${DevDataProtocol.name} bootstrap (expo.extra.${DevDataProtocol.manifestKey})`,
    )
  }
  if (input.bundleHost === undefined || input.bundleHost === '') {
    missing.push(input.missingHost)
  }
  if (manifest === undefined || input.bundleHost === undefined || input.bundleHost === '') {
    return { kind: 'missing', missing }
  }
  return { app: manifest.app, kind: 'ready', serverUrl: `ws://${input.bundleHost}:${manifest.port}` }
}

/** parseBundleOrigin reads where a native bundle loaded from; mirrors `TR-studio-device-host`'s parse. */
export function parseBundleOrigin(scriptURL: string | undefined): { host: string; origin: string } | undefined {
  if (scriptURL === undefined) {
    return undefined
  }
  const match = scriptUrlPattern.exec(scriptURL)
  if (match === null) {
    return undefined
  }
  const host = match[1]!
  return { host, origin: `http://${host}${match[2] === undefined ? '' : `:${match[2]}`}` }
}

/** parseBundleHost reads the host a native bundle loaded from. */
export function parseBundleHost(scriptURL: string | undefined): string | undefined {
  return parseBundleOrigin(scriptURL)?.host
}

function readManifest(value: unknown): DevDataManifest | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const app = record['app']
  const port = record['port']
  if (
    record['protocol'] !== DevDataProtocol.name
    || typeof app !== 'string' || !appNamePattern.test(app)
    || typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0 || port > 65_535
  ) {
    return undefined
  }
  return { app, port, protocol: DevDataProtocol.name }
}

type Pending = { reject(error: Error): void; resolve(): void }
/** A caller waiting for the stream's snapshot; a load consumes it, a write only waits for it. */
type ReadyWaiter = { consumes: boolean; reject(error: Error): void; resolve(): void }
type MissedResult = { error: unknown } | { snapshot: string | undefined }

function createDevDataConnection(host: DevDataHost, storageKey: string): TR.DataConnection {
  const timers = host.timers ?? {
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  }
  let socket: DevDataSocket | undefined
  let opening = false
  /** The stream URL of the latest attempt, for messages; empty until a bootstrap has resolved. */
  let url = ''
  let opened = false
  let closed = false
  let attempt = 0
  let strandedDials = 0
  let reconnectHandle: unknown
  let latest: { snapshot: string | undefined } | undefined
  let readyWaiters: ReadyWaiter[] = []
  let observer: TR.DataConnectionObserver | undefined
  let missed: MissedResult | undefined
  let nextSeq = 0
  let pendingLoads = 0
  const pending = new Map<number, Pending>()

  const failPending = (error: Error): void => {
    const waiting = [...pending.values()]
    pending.clear()
    for (const entry of waiting) {
      entry.reject(error)
    }
  }

  const closedError = (): Error => hostError('The Dev datasource connection is closed.')
  // Read through a call: `latest` changes under an await, which flow narrowing cannot see.
  const currentSnapshot = (): string | undefined => latest?.snapshot

  const publish = (result: MissedResult): void => {
    if (observer === undefined) {
      // The runtime subscribes one microtask after load resolves; keep the latest result from
      // that gap so subscribe can replay it.
      missed = result
      return
    }
    if ('error' in result) {
      observer.error(result.error)
    } else {
      observer.snapshot(result.snapshot)
    }
  }

  const handle = (message: DevDataServerMessage): void => {
    if (message.type === 'snapshot') {
      const snapshot = message.snapshot ?? undefined
      latest = { snapshot }
      const waiters = readyWaiters
      readyWaiters = []
      for (const waiter of waiters) {
        waiter.resolve()
      }
      // A pending load takes this snapshot as its answer; otherwise it is a peer's write, or the
      // server's state after a reconnect, and the runtime learns it through the subscription.
      if (pendingLoads === 0 && !waiters.some(waiter => waiter.consumes)) {
        publish({ snapshot })
      }
      return
    }
    const entry = pending.get(message.seq)
    if (entry === undefined) {
      return
    }
    pending.delete(message.seq)
    if (message.type === 'ack') {
      entry.resolve()
    } else {
      entry.reject(hostError(message.message))
    }
  }

  const scheduleReconnect = (): void => {
    if (closed || reconnectHandle !== undefined) {
      return
    }
    const delay = Math.min(
      DevDataProtocol.reconnect.maxMs,
      DevDataProtocol.reconnect.initialMs * 2 ** Math.min(attempt, 8),
    )
    attempt += 1
    reconnectHandle = timers.setTimeout(() => {
      reconnectHandle = undefined
      if (!closed && socket === undefined) {
        open()
      }
    }, delay)
  }

  const disconnected = (reason: string): void => {
    socket = undefined
    opened = false
    latest = undefined
    const detail = reason === '' ? '' : ` (${reason})`
    failPending(hostError(`The Tao dev data server disconnected${detail}.`))
    if (closed) {
      return
    }
    failReadyWaiters(
      `Could not reach the Tao dev data server${serverName()}${detail}. Is \`tao dev\` or Studio running?`,
    )
      || publish({ error: hostError(`The Tao dev data server disconnected${detail}; reconnecting.`) })
    scheduleReconnect()
  }

  const serverName = (): string => (url === '' ? '' : ` at ${url}`)

  /** failReadyWaiters rejects every caller waiting on this attempt; false when nobody was waiting. */
  const failReadyWaiters = (message: string): boolean => {
    const waiters = readyWaiters
    readyWaiters = []
    if (waiters.length === 0) {
      return false
    }
    const error = hostError(message)
    for (const waiter of waiters) {
      waiter.reject(error)
    }
    return true
  }

  /** ready resolves once the live socket has delivered the stream's snapshot, opening one if needed. */
  const ready = (consumes: boolean): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (closed) {
        reject(closedError())
        return
      }
      if (latest !== undefined) {
        resolve()
        return
      }
      readyWaiters.push({ consumes, reject, resolve })
      if (socket === undefined) {
        if (reconnectHandle !== undefined) {
          timers.clearTimeout(reconnectHandle)
          reconnectHandle = undefined
        }
        open()
      }
    })

  /** open runs one attempt: bootstrap, then dial. A failed bootstrap fails the callers waiting on it. */
  const open = (): void => {
    if (opening || socket !== undefined || closed) {
      return
    }
    opening = true
    void Promise.resolve()
      .then(() => host.bootstrap())
      .then(bootstrap => {
        opening = false
        if (closed) {
          return
        }
        if (bootstrap.kind === 'missing') {
          const message = `The Dev datasource needs a running Tao dev server, but ${bootstrap.missing.join(', and ')}.`
            + ' Start `tao dev` or Studio and reload the app.'
          failReadyWaiters(message) || publish({ error: hostError(message) })
          scheduleReconnect()
          return
        }
        url = devDataSocketUrl(bootstrap.serverUrl, bootstrap.app, storageKey)
        dial()
      }, error => {
        opening = false
        if (!closed) {
          disconnected(errorText(error))
        }
      })
  }

  const dial = (): void => {
    let next: DevDataSocket
    try {
      next = host.connect(url)
    } catch (error) {
      disconnected(errorText(error))
      return
    }
    socket = next
    let failure = ''
    // A dial to a dead address can sit in the transport for a long time — a phone dialing the
    // LAN address of a Mac that went to sleep, say — and a socket the platform strands never
    // reports at all. Bound the wait so the next attempt happens in time.
    let connectTimer: unknown = timers.setTimeout(() => {
      connectTimer = undefined
      if (socket !== next || opened) {
        return
      }
      socket = undefined
      next.close()
      // A stranded dial is transient far more often than not: redial at once, and only fail the
      // waiting callers once a second and third dial went the same way.
      if (strandedDials < 2) {
        strandedDials += 1
        dial()
        return
      }
      strandedDials = 0
      disconnected('the dial did not complete in time')
    }, host.connectTimeoutMs ?? DevDataProtocol.connectTimeoutMs)
    const clearConnectTimer = (): void => {
      if (connectTimer !== undefined) {
        timers.clearTimeout(connectTimer)
        connectTimer = undefined
      }
    }
    next.onopen = () => {
      clearConnectTimer()
      if (socket === next) {
        opened = true
        attempt = 0
        strandedDials = 0
      }
    }
    next.onmessage = text => {
      if (socket !== next) {
        return
      }
      const message = parseServerMessage(text)
      if (message !== undefined) {
        handle(message)
      }
    }
    next.onerror = error => {
      failure = errorText(error)
    }
    next.onclose = reason => {
      clearConnectTimer()
      if (socket === next) {
        disconnected(reason === '' ? failure : reason)
      }
    }
  }

  const request = async (message: DevDataClientMessage): Promise<void> => {
    await ready(false)
    const current = socket
    if (current === undefined || !opened) {
      throw hostError(`The Tao dev data server${serverName()} is not connected. Is \`tao dev\` or Studio running?`)
    }
    await new Promise<void>((resolve, reject) => {
      pending.set(message.seq, { reject, resolve })
      current.send(JSON.stringify(message))
    })
  }

  return {
    automaticReset: true,
    close: () => {
      if (closed) {
        return
      }
      closed = true
      if (reconnectHandle !== undefined) {
        timers.clearTimeout(reconnectHandle)
        reconnectHandle = undefined
      }
      const current = socket
      socket = undefined
      opened = false
      observer = undefined
      const waiters = readyWaiters
      readyWaiters = []
      for (const waiter of waiters) {
        waiter.reject(closedError())
      }
      failPending(closedError())
      current?.close()
    },
    load: async () => {
      if (latest === undefined) {
        // A fresh stream answers with its snapshot on open; that answer is this load's.
        await ready(true)
        return currentSnapshot()
      }
      // An open stream asks again rather than trusting what it last saw: a peer's write may be in
      // flight on another socket, and the server's ordered answer lands before this ack.
      pendingLoads += 1
      try {
        await request({ seq: ++nextSeq, type: 'load' })
      } finally {
        pendingLoads -= 1
      }
      return currentSnapshot()
    },
    // The full envelope round-trips row ids untouched, so identity tokens restore across
    // relaunches and across devices exactly as for the local snapshot providers.
    referenceToken: reference => reference.id,
    reset: () => request({ seq: ++nextSeq, type: 'reset' }),
    resolveReference: reference => reference.token,
    save: snapshot => request({ seq: ++nextSeq, snapshot, type: 'save' }),
    subscribe: next => {
      observer = next
      const replay = missed
      missed = undefined
      if (replay !== undefined) {
        publish(replay)
      }
      return () => {
        if (observer === next) {
          observer = undefined
        }
      }
    },
  }
}

function parseServerMessage(text: string): DevDataServerMessage | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }
  const record = parsed as Record<string, unknown>
  const revision = typeof record['revision'] === 'number' ? record['revision'] : 0
  const type = record['type']
  if (type === 'snapshot') {
    return typeof record['snapshot'] === 'string' || record['snapshot'] === null
      ? { revision, snapshot: record['snapshot'], type }
      : undefined
  }
  if (typeof record['seq'] !== 'number') {
    return undefined
  }
  if (type === 'ack') {
    return { revision, seq: record['seq'], type }
  }
  if (type === 'rejected') {
    return {
      message: String(record['message'] ?? 'The dev data server rejected the write.'),
      seq: record['seq'],
      type,
    }
  }
  return undefined
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return typeof error === 'string' ? error : ''
}

type ReactNativeModule = {
  NativeModules?: { SourceCode?: { getConstants?(): { scriptURL?: string }; scriptURL?: string } }
  Platform?: { OS?: string }
}

type ExpoConstantsModule = {
  default?: { expoConfig?: { extra?: Record<string, unknown> } | null }
}

/**
 * fetchDevDataManifest asks the Expo dev server the bundle loaded from for its current manifest and
 * reads the dev data fact out of it. Fetched rather than read from the bundle because the web
 * bundle carries no manifest, and because a fetch sees a dev server restarted on a new port where a
 * fact baked at bundle time would not. Any failure yields undefined and the caller's fallback.
 */
export async function fetchDevDataManifest(
  bundleOrigin: string,
  request: (url: string, init: { headers: Record<string, string> }) => Promise<{ json(): Promise<unknown> }> = fetch,
): Promise<unknown> {
  try {
    const response = await request(`${bundleOrigin.replace(/\/$/, '')}/`, { headers: { 'expo-platform': 'ios' } })
    const manifest = await response.json()
    // An Expo dev server answers with the updates-style manifest, whose app config — the `expo`
    // object of app.json — sits under `extra.expoClient`; a classic manifest is that object itself.
    const expoConfig = record(record(manifest)?.['extra'])?.['expoClient'] ?? manifest
    return record(record(expoConfig)?.['extra'])?.[DevDataProtocol.manifestKey]
  } catch {
    return undefined
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** nativeDevDataHost wires the client to the running platform: the bundle URL, Expo's dev server, and WebSocket. */
function nativeDevDataHost(): DevDataHost {
  return {
    bootstrap: async () => {
      const reactNative = require('react-native') as ReactNativeModule
      if (reactNative.Platform?.OS === 'web') {
        const location = (globalThis as { location?: { hostname?: string; origin?: string } }).location
        const bundleHost = location?.hostname
        return resolveDevDataBootstrap({
          bundleHost,
          manifest: bundleHost === undefined || bundleHost === '' || location?.origin === undefined
            ? undefined
            : await fetchDevDataManifest(location.origin),
          missingHost: 'the page location names no host',
        })
      }
      const sourceCode = reactNative.NativeModules?.SourceCode
      const scriptURL = sourceCode?.scriptURL ?? sourceCode?.getConstants?.().scriptURL
      const bundle = parseBundleOrigin(scriptURL)
      // The manifest the dev client launched with is the fallback: it names the port of the dev
      // server that served this bundle, which is right until that server restarts.
      const launched = (require('expo-constants') as ExpoConstantsModule).default?.expoConfig?.extra
        ?.[DevDataProtocol.manifestKey]
      return resolveDevDataBootstrap({
        bundleHost: bundle?.host,
        manifest: (bundle === undefined ? undefined : await fetchDevDataManifest(bundle.origin)) ?? launched,
        missingHost: scriptURL === undefined
          ? 'the bundle URL (NativeModules.SourceCode.scriptURL) is unavailable'
          : `the bundle URL '${scriptURL}' names no host`,
      })
    },
    connect: url => {
      const raw = new WebSocket(url)
      const wrapped: DevDataSocket = {
        close: () => raw.close(),
        send: text => raw.send(text),
      }
      raw.onopen = () => wrapped.onopen?.()
      raw.onmessage = event => wrapped.onmessage?.(String((event as { data: unknown }).data))
      raw.onerror = event => wrapped.onerror?.(event)
      raw.onclose = event => wrapped.onclose?.(String((event as { reason?: string }).reason ?? ''))
      return wrapped
    },
  }
}
