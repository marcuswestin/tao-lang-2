/**
 * The native Tao Studio device host: the generated preview root mounts it on every platform but
 * web, around the same generated app, fixture, and scenario adapters the browser canvas uses. It
 * wires `TR-studio-device-client.ts` to the device — bundle URL, Expo manifest, keychain, socket —
 * and renders the assigned cell when its compile revision matches the loaded bundle, an
 * unmistakable full-screen overlay otherwise, and a floating badge that opens the scenario sheet.
 * Every decision the screen depends on is a pure exported function so Bun tests cover it without
 * a React renderer.
 */

import React from 'react'
import { Dev } from './dev-runtime/TR-dev'
import { accessibilityStateProps } from './TR-accessibility'
import { requireSafeAreaContext } from './TR-app-shell'
import { createElement } from './TR-create-element'
import { errorMessage, errorStack, onUnownedFailure } from './TR-errors'
import { NativeModules } from './TR-native-modules'
import { resetNavigationRuntime } from './TR-navigation-registry'
import { beginNavigationPreviewCell, setNavigationPreviewScope } from './TR-navigation-restoration'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import {
  captureRuntime,
  registerRuntimeCaptureDomain,
  type TaoRuntimeCaptureArtifact,
  type TaoRuntimeJson,
} from './TR-runtime-capture'
import {
  createStudioDeviceClient,
  type StudioDeviceClient,
  type TaoStudioDeviceAssignment,
  type TaoStudioDeviceBootstrap,
  type TaoStudioDeviceClientState,
  type TaoStudioDeviceSocket,
  type TaoStudioDeviceStorage,
  type TaoStudioDeviceStoredRecord,
  type TaoStudioDeviceTransport,
} from './TR-studio-device-client'
import {
  bestInspectHit,
  measureStudioInspectIdentity,
  measureStudioInspectNodes,
  moveRenderFor,
  type StudioInspectHit,
  type StudioInspectRect,
} from './TR-studio-device-inspect'
import { captureStudioDeviceLogs, formatStack, type StudioDeviceLogConsole } from './TR-studio-device-logs'
import {
  type TaoStudioDeviceCellIdentity,
  type TaoStudioDeviceDescription,
  type TaoStudioDeviceLensCause,
  type TaoStudioDeviceLensSample,
  type TaoStudioDeviceNetworkCondition,
  type TaoStudioDeviceOccurrence,
  TaoStudioDeviceProtocol,
} from './TR-studio-device-protocol'
import { StudioDeviceTrust } from './TR-studio-device-trust'
import { StudioEnvironmentControls, type TaoStudioCellRuntime } from './TR-studio-environment'
import { StudioLensHost, type TaoStudioLensRenderSample } from './TR-studio-lens'
import { StudioPreview } from './TR-studio-preview'

export type TaoStudioDeviceHostPublication = {
  appName: string
  compileRevision: number
  project: string
  sourceVersions: Readonly<Record<string, string>>
}

/** Reduces the browser and native Lens shape to the sealed device contract. */
export function deviceLensSample(
  sample: TaoStudioLensRenderSample,
  sourceVersions: Readonly<Record<string, string>>,
): TaoStudioDeviceLensSample | undefined {
  const sourceVersion = sourceVersions[sample.identity.sourcePath]
  if (sourceVersion === undefined) {
    return undefined
  }
  return {
    actualDurationMs: sample.actualDurationMs,
    causes: sample.causes.map(deviceLensCause),
    instanceId: sample.instanceId,
    occurrence: {
      end: sample.identity.end,
      ...(sample.identity.ownerName === undefined ? {} : { ownerName: sample.identity.ownerName }),
      sourcePath: sample.identity.sourcePath,
      sourceVersion,
      start: sample.identity.start,
    },
    phase: sample.phase,
    timestamp: sample.timestamp,
  }
}

function deviceLensCause(cause: TaoStudioLensRenderSample['causes'][number]): TaoStudioDeviceLensCause {
  return cause.kind === 'state'
    ? { kind: 'state' }
    : {
      entity: cause.entity,
      kind: 'data',
      ...(cause.providerWaitMs === undefined ? {} : { providerWaitMs: cause.providerWaitMs }),
      schema: cause.schema,
    }
}

/** The cell runtime the generated adapter builds, plus the replay artifact the browser root also passes. */
type TaoStudioDeviceCellRuntime = TaoStudioCellRuntime & { replay?: TaoRuntimeCaptureArtifact }

export type StudioDeviceHostProps = {
  App: React.ComponentType
  cellRuntime: (runtime: unknown, manifest: unknown) => TaoStudioDeviceCellRuntime
  /** A test seam: an injected client is started and stopped by its owner, not by the host. */
  client?: StudioDeviceClient
  manifest: unknown
  publication: TaoStudioDeviceHostPublication
}

/** The host and port a Metro bundle URL names; the gateway shares the host. */
export type TaoStudioDeviceScriptOrigin = {
  host: string
  port?: number
}

type TaoStudioDeviceHostAction = 'forget' | 'reconnect'

/** What the screen shows for one client snapshot: the assigned cell, or one named overlay. */
export type TaoStudioDeviceHostPresentation =
  | { assignment: TaoStudioDeviceAssignment; kind: 'cell' }
  | {
    actions: readonly TaoStudioDeviceHostAction[]
    code?: string
    kind: 'overlay'
    message: string
    reason:
      | 'cell-unavailable'
      | 'connecting'
      | 'disconnected'
      | 'handshaking'
      | 'idle'
      | 'key-mismatch'
      | 'pairing'
      | 'pairing-closed'
      | 'stale-bundle'
      | 'waiting-for-cell'
    title: string
  }

export type TaoStudioDeviceBootstrapResolution =
  | { bootstrap: TaoStudioDeviceBootstrap; kind: 'ready' }
  | { kind: 'missing'; missing: readonly string[] }

type ExpoConstantsModule = {
  default?: {
    deviceName?: string
    expoConfig?: { extra?: Record<string, unknown>; version?: string } | null
  }
}

type SecureStoreModule = {
  deleteItemAsync(key: string): Promise<void>
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
}

type StudioBonjourNativeModule = {
  discover(timeoutMs: number): Promise<unknown>
}

type ExpoModulesCore = {
  requireOptionalNativeModule<T>(name: string): T | null
}

type NativePlatform = {
  OS: string
  Version?: number | string
  constants?: { interfaceIdiom?: string; osVersion?: string; systemName?: string }
}

type NativeReactNativeRuntime = ReactNativeRuntime & {
  NativeModules?: { SourceCode?: { getConstants?(): { scriptURL?: string }; scriptURL?: string } }
  Platform?: NativePlatform
}

type WebSocketLike = {
  close(code?: number, reason?: string): void
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onopen: (() => void) | null
  send(data: string): void
}

type WebSocketConstructor = new(url: string) => WebSocketLike

const secureStoreKey = 'tao-studio-device-v1'
const scriptUrlPattern = /^(?:https?|wss?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/

/** parseScriptUrl reads the host a bundle loaded from; a device reaches Studio's gateway there. */
export function parseScriptUrl(scriptURL: string | undefined): TaoStudioDeviceScriptOrigin | undefined {
  if (scriptURL === undefined) {
    return undefined
  }
  const match = scriptUrlPattern.exec(scriptURL)
  if (match === null) {
    return undefined
  }
  const port = match[2] === undefined ? undefined : Number(match[2])
  return { host: match[1]!, ...(port === undefined || !Number.isSafeInteger(port) || port <= 0 ? {} : { port }) }
}

/** resolveDeviceBootstrap turns the facts a bundle can observe into gateway candidates, or names what is missing. */
export function resolveDeviceBootstrap(input: {
  device: TaoStudioDeviceDescription
  gatewayPort: unknown
  scriptURL: string | undefined
}): TaoStudioDeviceBootstrapResolution {
  const missing: string[] = []
  const origin = parseScriptUrl(input.scriptURL)
  if (origin === undefined) {
    missing.push(
      input.scriptURL === undefined
        ? 'the bundle URL (NativeModules.SourceCode.scriptURL) is unavailable'
        : `the bundle URL '${input.scriptURL}' names no host`,
    )
  }
  const gatewayPort = validPort(input.gatewayPort) ? input.gatewayPort : undefined
  if (gatewayPort === undefined) {
    missing.push('the gateway port (expo.extra.taoStudioDevice.gatewayPort) is missing from the Expo manifest')
  }
  if (origin === undefined || gatewayPort === undefined) {
    return { kind: 'missing', missing }
  }
  return {
    bootstrap: {
      candidates: [`ws://${origin.host}:${gatewayPort}/device`],
      device: input.device,
      ...(origin.port === undefined ? {} : { metroPort: origin.port }),
    },
    kind: 'ready',
  }
}

/** describeDevice names the device for Studio's trusted-device list from what React Native exposes. */
export function describeDevice(
  platform: NativePlatform | undefined,
  constants: ExpoConstantsModule['default'] | undefined,
): TaoStudioDeviceDescription {
  const os = platform?.OS ?? 'unknown'
  const systemName = platform?.constants?.systemName ?? os
  const version = platform?.constants?.osVersion ?? platform?.Version
  const idiom = platform?.constants?.interfaceIdiom
  const appVersion = constants?.expoConfig?.version
  return {
    ...(appVersion === undefined ? {} : { appVersion }),
    model: idiom === undefined ? systemName : `${systemName} ${idiom}`,
    name: constants?.deviceName ?? 'iPhone',
    os: version === undefined ? systemName : `${systemName} ${String(version)}`,
  }
}

/** cellIdentityKey is the full identity a mounted cell is keyed by, so any change remounts it. */
export function cellIdentityKey(identity: TaoStudioDeviceCellIdentity): string {
  return [
    identity.appName,
    identity.cellId,
    identity.cellRevision,
    identity.compileRevision,
    identity.manifestRevision,
    identity.previewInstanceId,
  ].join(':')
}

/**
 * shouldAcknowledgeCell decides whether the currently mounted identity should send `device.applied`:
 * not already sent for this identity, and not the identity whose first render threw into the error
 * boundary. Acknowledging a cell that failed to render would tell Studio the phone is showing the
 * assigned revision when it is actually showing an error screen.
 */
export function shouldAcknowledgeCell(
  identityKey: string,
  appliedKey: string | undefined,
  erroredKey: string | undefined,
): boolean {
  return identityKey !== appliedKey && identityKey !== erroredKey
}

/**
 * studioDeviceAppStateAction decides what an `AppState` transition should do to a client the host
 * owns: "backgrounding pauses the client; foregrounding dials again with the stored key" (the
 * settled protocol contract). `paused` is the host's own record of whether it already stopped the
 * client, not the client's `phase` — `stop()` resets the client to `idle`, so the client's own state
 * cannot tell a paused client apart from one that never started. `'inactive'` is a transient blip
 * (a system alert, the app switcher, a brief interruption) that iOS reports on the way into and out
 * of `'background'`; reacting to it directly would pause and resume the connection for interruptions
 * that were never really backgrounding.
 */
export function studioDeviceAppStateAction(nextAppState: string, paused: boolean): 'none' | 'pause' | 'resume' {
  if (nextAppState === 'background') {
    return paused ? 'none' : 'pause'
  }
  if (nextAppState === 'active') {
    return paused ? 'resume' : 'none'
  }
  return 'none'
}

/**
 * studioDeviceAppStateHandler is the `AppState` listener the host installs, carrying the `paused`
 * bookkeeping the decision above needs. Extracted so a test can drive the transitions against a
 * client and see which calls actually land — the host can only install this for a client it owns
 * the lifecycle of, so there is no way to observe it through the injected-client seam.
 */
export function studioDeviceAppStateHandler(
  client: Pick<StudioDeviceClient, 'start' | 'stop'>,
): (nextAppState: string) => void {
  let paused = false
  return nextAppState => {
    const action = studioDeviceAppStateAction(nextAppState, paused)
    if (action === 'pause') {
      paused = true
      client.stop()
    } else if (action === 'resume') {
      paused = false
      void client.start()
    }
  }
}

type TaoStudioDeviceOverlay = Extract<TaoStudioDeviceHostPresentation, { kind: 'overlay' }>

/**
 * Every overlay is the same frame — why the cell is not on screen, in a title and a sentence, with
 * whatever the person can do about it — so each reason below names only its own words, and one that
 * offers nothing to do says nothing about actions.
 */
function deviceOverlay(
  overlay: Omit<TaoStudioDeviceOverlay, 'actions' | 'kind'> & { actions?: readonly TaoStudioDeviceHostAction[] },
): TaoStudioDeviceHostPresentation {
  return { actions: [], ...overlay, kind: 'overlay' }
}

/** deviceHostPresentation decides what one client snapshot puts on the screen. */
export function deviceHostPresentation(
  state: TaoStudioDeviceClientState,
  publication: Pick<TaoStudioDeviceHostPublication, 'compileRevision'>,
): TaoStudioDeviceHostPresentation {
  const host = state.host === undefined ? 'Tao Studio' : `Tao Studio at ${state.host}`
  if (state.phase === 'idle') {
    return deviceOverlay({
      actions: ['reconnect'],
      message: 'The device host is not connected to Tao Studio.',
      reason: 'idle',
      title: 'Not connected',
    })
  }
  if (state.phase === 'connecting') {
    return deviceOverlay({ message: `Reaching ${host}…`, reason: 'connecting', title: 'Connecting' })
  }
  if (state.phase === 'handshaking') {
    return deviceOverlay({
      message: `Verifying ${host}${state.studioFingerprint === undefined ? '' : ` (${state.studioFingerprint})`}…`,
      reason: 'handshaking',
      title: 'Verifying Tao Studio',
    })
  }
  if (state.phase === 'pairing') {
    return deviceOverlay({
      ...(state.code === undefined ? {} : { code: state.code }),
      message: 'Compare this code with Tao Studio, then confirm there.',
      reason: 'pairing',
      title: 'Pair with Tao Studio',
    })
  }
  if (state.phase === 'disconnected') {
    if (state.lastError?.code === 'studio-key-mismatch') {
      return deviceOverlay({
        actions: ['forget', 'reconnect'],
        message: state.lastError.message,
        reason: 'key-mismatch',
        title: 'Tao Studio changed its identity',
      })
    }
    if (state.lastError?.code === 'pairing-closed' && state.retryAt !== undefined) {
      return deviceOverlay({
        actions: ['reconnect'],
        message: `${state.lastError.message} This phone keeps asking until you do.`,
        reason: 'pairing-closed',
        title: 'Waiting for pairing',
      })
    }
    const retry = state.retryAt === undefined ? '' : ' Retrying automatically.'
    return deviceOverlay({
      actions: ['reconnect'],
      message: `${state.lastError?.message ?? 'The connection ended.'}${retry}`,
      reason: 'disconnected',
      title: `Disconnected${state.lastError === undefined ? '' : ` (${state.lastError.code})`}`,
    })
  }
  if (state.cellUnavailable !== undefined) {
    return deviceOverlay({
      message: state.cellUnavailable.message,
      reason: 'cell-unavailable',
      title: `Scenario unavailable (${state.cellUnavailable.code})`,
    })
  }
  if (state.assignment === undefined) {
    return deviceOverlay({
      message: 'Connected. Waiting for Tao Studio to assign a scenario.',
      reason: 'waiting-for-cell',
      title: 'Waiting for a scenario',
    })
  }
  const assigned = state.assignment.identity.compileRevision
  if (assigned !== publication.compileRevision) {
    return deviceOverlay({
      message: `Stale bundle: device has revision ${publication.compileRevision}, `
        + `Studio assigned ${assigned} — waiting for Fast Refresh.`,
      reason: 'stale-bundle',
      title: 'Waiting for Fast Refresh',
    })
  }
  return { assignment: state.assignment, kind: 'cell' }
}

/** createNativeStudioDeviceClient wires a client to the device, or names the facts the bundle lacks. */
export function createNativeStudioDeviceClient(): {
  client: StudioDeviceClient
  kind: 'ready'
} | { kind: 'missing'; missing: readonly string[] } {
  const RN = requireReactNativeRuntime() as NativeReactNativeRuntime
  const constants = NativeModules.optional<ExpoConstantsModule>('Studio device host', 'expo-constants')?.default
  const extra = constants?.expoConfig?.extra?.['taoStudioDevice']
  const gatewayPort = typeof extra === 'object' && extra !== null
    ? (extra as Record<string, unknown>)['gatewayPort']
    : undefined
  const sourceCode = RN.NativeModules?.SourceCode
  const scriptURL = sourceCode?.scriptURL ?? sourceCode?.getConstants?.().scriptURL
  const resolution = resolveDeviceBootstrap({
    device: describeDevice(RN.Platform, constants),
    gatewayPort,
    scriptURL,
  })
  if (resolution.kind === 'missing') {
    return resolution
  }
  const missing: string[] = []
  try {
    ensureRandomValues()
  } catch (error) {
    missing.push(errorMessage(error))
  }
  const WebSocketImplementation = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
  if (WebSocketImplementation === undefined) {
    missing.push('a global WebSocket implementation is unavailable')
  }
  let secureStore: SecureStoreModule | undefined
  try {
    secureStore = NativeModules.required<SecureStoreModule>('Studio device trust', 'expo-secure-store')
  } catch (error) {
    missing.push(errorMessage(error))
  }
  if (WebSocketImplementation === undefined || secureStore === undefined || missing.length > 0) {
    return { kind: 'missing', missing }
  }
  const discover = nativeStudioBonjourDiscovery()
  return {
    client: createStudioDeviceClient({
      bootstrap: resolution.bootstrap,
      // The capture domains register at module scope on every platform, so the device already has a
      // complete artifact to give; Studio just had no way to ask for one.
      captureRuntime: () => captureRuntime(),
      ...(discover === undefined ? {} : { discover }),
      storage: secureStoreStorage(secureStore),
      transport: webSocketTransport(WebSocketImplementation),
    }),
    kind: 'ready',
  }
}

/** Parses untrusted native discovery output; key matching remains the device client's responsibility. */
export function studioBonjourGateways(value: unknown): readonly { studioPublicKey: string; url: string }[] {
  if (!Array.isArray(value)) {
    return []
  }
  const gateways: { studioPublicKey: string; url: string }[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue
    }
    const record = item as Record<string, unknown>
    const host = typeof record['host'] === 'string' ? record['host'].replace(/\.$/, '') : undefined
    const port = typeof record['port'] === 'number' ? record['port'] : Number(record['port'])
    const studioPublicKey = record['studioPublicKey']
    if (
      record['protocol'] !== TaoStudioDeviceProtocol.name
      || host === undefined
      || !validBonjourHost(host)
      || !validPort(port)
      || typeof studioPublicKey !== 'string'
      || !StudioDeviceTrust.validPublicKey(studioPublicKey)
    ) {
      continue
    }
    const address = host.includes(':') ? `[${host}]` : host
    gateways.push({ studioPublicKey, url: `ws://${address}:${port}/device` })
  }
  return gateways
}

function validBonjourHost(host: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host) || /^[0-9a-fA-F:]+$/.test(host)
}

/** A usable TCP port: a whole number inside the port range, however the advertiser spelled it. */
function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 65_535
}

/** An optional stored field is either absent or text; anything else is a record to discard. */
function optionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function nativeStudioBonjourDiscovery():
  | (() => Promise<readonly { studioPublicKey: string; url: string }[]>)
  | undefined
{
  const native = NativeModules.optional<ExpoModulesCore>('Studio device discovery', 'expo-modules-core')
    ?.requireOptionalNativeModule<StudioBonjourNativeModule>('TaoStudioDiscovery')
  // The generic development client has no Tao module; QR/deep-link bootstrap remains functional.
  return native == null ? undefined : async () => studioBonjourGateways(await native.discover(750))
}

/** The trust primitives draw randomness from `crypto.getRandomValues`, which Hermes lacks without the polyfill. */
function ensureRandomValues(): void {
  const crypto = (globalThis as { crypto?: { getRandomValues?: unknown } }).crypto
  if (typeof crypto?.getRandomValues === 'function') {
    return
  }
  NativeModules.required('Studio device pairing', 'react-native-get-random-values')
}

/** secureStoreStorage keeps the one device record as JSON in the keychain through expo-secure-store. */
export function secureStoreStorage(store: SecureStoreModule): TaoStudioDeviceStorage {
  return {
    clear: () => store.deleteItemAsync(secureStoreKey),
    async load() {
      const raw = await store.getItemAsync(secureStoreKey)
      return raw === null ? undefined : parseStoredRecord(raw)
    },
    save: record => store.setItemAsync(secureStoreKey, JSON.stringify(record)),
  }
}

/**
 * parseStoredRecord accepts only a complete, self-consistent record; anything else — including a
 * secretKey that does not actually derive publicKey, the way a partial write or a Keychain
 * migration gone wrong could leave one — is treated as no record at all, the same as a first launch.
 * A mismatched pair would otherwise fail every signature the device ever tries to make with no way
 * to recover short of Forget Studio; falling back to "no record" instead means the client generates
 * and persists a fresh identity and simply re-pairs.
 */
export function parseStoredRecord(raw: string): TaoStudioDeviceStoredRecord | undefined {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) {
      return undefined
    }
    const record = value as Record<string, unknown>
    const identityValue = record['identity']
    if (typeof identityValue !== 'object' || identityValue === null) {
      return undefined
    }
    const { publicKey, secretKey } = identityValue as Record<string, unknown>
    const pinnedStudioKey = record['pinnedStudioKey']
    if (
      typeof publicKey !== 'string'
      || typeof secretKey !== 'string'
      || !StudioDeviceTrust.validPublicKey(publicKey)
      || !optionalText(pinnedStudioKey)
    ) {
      return undefined
    }
    const identity = { publicKey, secretKey }
    if (StudioDeviceTrust.publicKeyOf(identity) !== publicKey) {
      return undefined
    }
    return {
      identity,
      ...(pinnedStudioKey === undefined ? {} : { pinnedStudioKey }),
    }
  } catch {
    return undefined
  }
}

/** webSocketTransport adapts the platform WebSocket to the client's socket shape. */
export function webSocketTransport(WebSocketImplementation: WebSocketConstructor): TaoStudioDeviceTransport {
  return {
    connect(url) {
      const raw = new WebSocketImplementation(url)
      const socket: TaoStudioDeviceSocket = {
        close: (code, reason) => raw.close(code, reason),
        send: text => raw.send(text),
      }
      raw.onopen = () => socket.onopen?.()
      raw.onmessage = event => socket.onmessage?.(typeof event.data === 'string' ? event.data : String(event.data))
      raw.onclose = event => socket.onclose?.(event.code, event.reason)
      raw.onerror = event => socket.onerror?.(event)
      return socket
    },
  }
}

/** StudioDeviceHost mounts the generated Tao app under Studio's device control plane. */
export function StudioDeviceHost(props: StudioDeviceHostProps): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const [resolution] = React.useState(() =>
    props.client === undefined
      ? createNativeStudioDeviceClient()
      : { client: props.client, kind: 'ready' as const }
  )
  const client = resolution.kind === 'ready' ? resolution.client : undefined
  const ownsClient = props.client === undefined
  React.useEffect(() => {
    if (client === undefined || !ownsClient) {
      return undefined
    }
    void client.start()
    return () => client.stop()
  }, [client, ownsClient])
  // "Backgrounding pauses the client; foregrounding dials again with the stored key" — only for a
  // client this host owns the lifecycle of; a caller-supplied client controls its own start/stop.
  React.useEffect(() => {
    const AppState = RN.AppState
    if (client === undefined || !ownsClient || AppState === undefined) {
      return undefined
    }
    const subscription = AppState.addEventListener('change', studioDeviceAppStateHandler(client))
    return () => subscription.remove()
  }, [RN.AppState, client, ownsClient])
  // LogBox is worse than useless on a Studio canvas, and actively breaks it. Its window becomes the
  // key window the moment anything is logged and keeps every touch afterwards, so one contained
  // failure leaves the whole phone frozen — the badge, the tab bar and the app all stop responding
  // while still looking alive. Nothing is lost by turning it off: console output is mirrored to
  // Studio, a render failure still renders this host's own failure screen, and a contained failure
  // still shows the notice below.
  React.useEffect(() => {
    RN.LogBox?.ignoreAllLogs(true)
  }, [RN.LogBox])
  if (client === undefined || resolution.kind === 'missing') {
    return createElement(
      RN.View,
      { style: overlayStyle, testID: 'tao-studio-device-overlay' },
      createElement(
        RN.Text,
        { style: overlayTitleStyle, testID: 'tao-studio-device-overlay-title' },
        'Tao Studio device host cannot start',
      ),
      createElement(
        RN.Text,
        { selectable: true, style: overlayMessageStyle, testID: 'tao-studio-device-overlay-message' },
        (resolution.kind === 'missing' ? resolution.missing : []).map(item => `• ${item}`).join('\n'),
      ),
    )
  }
  return createElement(ConnectedDeviceHost, { ...props, client })
}

function ConnectedDeviceHost(props: StudioDeviceHostProps & { client: StudioDeviceClient }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const { client } = props
  const state = React.useSyncExternalStore(client.subscribe, client.state, client.state)
  const devMode = Dev.useMode()
  const presentation = deviceHostPresentation(state, props.publication)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [inspecting, setInspecting] = React.useState(false)
  const [selection, setSelection] = React.useState<
    { hit: StudioInspectHit; hits: readonly StudioInspectHit[] } | undefined
  >(undefined)
  const [remoteHighlight, setRemoteHighlight] = React.useState<readonly StudioInspectRect[]>([])
  const [containedFailure, setContainedFailure] = React.useState<string | undefined>(undefined)
  const [viewportNoticeSeen, setViewportNoticeSeen] = React.useState(false)
  const identityKey = presentation.kind === 'cell' ? cellIdentityKey(presentation.assignment.identity) : undefined
  const assignedScenario = presentation.kind === 'cell'
    ? state.manifest?.scenarios.find(scenario => scenario.cellId === presentation.assignment.identity.cellId)
    : undefined
  // One process renders every cell this device is ever assigned, and keeps real device storage
  // between them. A cell change is therefore a relaunch, not a re-render, and it needs both halves:
  // the stored position has to be scoped to the cell, or one scenario restores another's stack; and
  // the mounted navigation has to be dropped, because an app definition lives at generated-module
  // scope and keeps its stack between cells without reading storage at all. The incoming cell seeds
  // its fixture into a new provider generation, so that carried-over stack names handles from the
  // old one — its screens re-offer their queries on every revision, every offer throws, and the
  // phone ends up showing a blank screen and a Back button while ignoring every touch.
  //
  // A layout effect is the one place this fits. The outgoing tree is already unmounted by the time
  // it runs, so resetting cannot update a component that is still rendering; and every layout
  // effect runs before any passive one, so it still lands before `attachRestoration` reads the
  // store — which is the read that has to see the new cell's scope.
  const assignedCellId = presentation.kind === 'cell' ? presentation.assignment.identity.cellId : undefined
  React.useLayoutEffect(() => {
    resetNavigationRuntime()
    beginNavigationPreviewCell(assignedCellId)
  }, [assignedCellId])
  React.useEffect(() => () => setNavigationPreviewScope(undefined), [])
  // Set during render, because the app's own shell reads it while rendering and this host renders
  // first. The device menu below carries the dev options, so the app's floating one would be a
  // second button over the same screen, offering what the first one already offers.
  Dev.hideMenu(true)
  React.useEffect(() => () => Dev.hideMenu(false), [])
  // A failure nobody in the program can observe is the phone's business, not the platform's: it is
  // named on this screen and sent to Studio rather than thrown at the device, where it would reach
  // LogBox (see above) or, worse, take the process down.
  //
  // Only the first of a repeat, and by identity rather than by count: the failures worth containing
  // include the ones a render or a live query reproduces on every revision, and answering each of
  // those with a state update and a frame to Studio would make this the thing that runs the phone
  // out of frames. The console mirror still carries every line, with its own drop accounting.
  const lastFailure = React.useRef<string | undefined>(undefined)
  React.useEffect(() =>
    onUnownedFailure(error => {
      const message = `${errorMessage(error)}${formatStack(errorStack(error))}`
      if (lastFailure.current === message) {
        return
      }
      lastFailure.current = message
      setContainedFailure(message)
      client.report('error', message)
    }), [client])
  // Mirrored for as long as this host is mounted, not only while a cell renders: the lines worth
  // seeing most are the ones from a cell that failed to render at all.
  React.useEffect(() =>
    captureStudioDeviceLogs({
      console: globalThis.console as StudioDeviceLogConsole,
      sink: entries => client.log(entries),
    }), [client])
  const identity = presentation.kind === 'cell' ? presentation.assignment.identity : undefined
  const appliedKey = React.useRef<string | undefined>(undefined)
  const erroredKey = React.useRef<string | undefined>(undefined)
  const compileRevision = props.publication.compileRevision
  const handleCellError = React.useCallback((error: unknown) => {
    if (identityKey !== undefined) {
      erroredKey.current = identityKey
    }
    client.report('error', errorMessage(error))
  }, [client, identityKey])
  // Runs after the cell subtree mounted, once per identity: the acknowledgement names what is on
  // screen. `componentDidCatch` (which sets erroredKey) fires during commit, before this passive
  // effect, so a cell that failed on its first render for this identity is visible here — the
  // acknowledgement would otherwise claim a revision the phone is showing an error screen for, not
  // the assigned cell.
  React.useEffect(() => {
    if (identityKey === undefined || identity === undefined) {
      return
    }
    if (!shouldAcknowledgeCell(identityKey, appliedKey.current, erroredKey.current)) {
      return
    }
    appliedKey.current = identityKey
    client.applied(identity, compileRevision)
  }, [client, compileRevision, identity, identityKey])

  // A selection belongs to the cell it was made in: a new scenario, or a recompile that re-assigns
  // one, renders a different tree, and holding onto rectangles measured in the old one would outline
  // whatever now happens to sit at those coordinates.
  React.useEffect(() => {
    setSelection(undefined)
    setInspecting(false)
    setContainedFailure(undefined)
    setViewportNoticeSeen(false)
    lastFailure.current = undefined
  }, [identityKey])

  const highlight = state.highlight
  React.useEffect(() => {
    if (highlight === undefined) {
      setRemoteHighlight([])
      return undefined
    }
    let live = true
    void measureStudioInspectIdentity({ ...highlight, kind: 'render' }).then(rects => {
      if (live) {
        setRemoteHighlight(rects)
      }
    })
    return () => {
      live = false
    }
  }, [highlight, identityKey])

  const sourceVersions = props.publication.sourceVersions
  const selectSource = React.useCallback(
    (next: { hit: StudioInspectHit; hits: readonly StudioInspectHit[] } | undefined) => {
      setSelection(next)
      if (next === undefined) {
        return
      }
      const occurrence = occurrenceOf(next.hit, sourceVersions)
      if (occurrence === undefined) {
        client.report('info', `${occurrenceLabel(next.hit.identity)} is not in a file this bundle published.`)
        return
      }
      client.selectSource(occurrence)
    },
    [client, sourceVersions],
  )
  const move = React.useCallback((direction: 'down' | 'up') => {
    if (selection === undefined) {
      return
    }
    const occurrence = occurrenceOf(selection.hit, sourceVersions)
    const action = occurrence === undefined ? undefined : moveRenderFor(selection.hits, selection.hit, direction)
    if (occurrence === undefined || action === undefined) {
      client.report('info', `${occurrenceLabel(selection.hit.identity)} has nowhere to move ${direction}.`)
      return
    }
    client.sourceAction(action, occurrence)
  }, [client, selection, sourceVersions])

  // Read from the cell the device is actually rendering, never from what it last asked for: the
  // request can be dropped while disconnected, ignored without an assignment, or refused against a
  // stale cell revision, and a menu claiming "Offline: on" over a fully online cell is a lie the
  // person would have no way to notice.
  const assignedNetwork = networkConditionOf(presentation.kind === 'cell' ? presentation.assignment.runtime : undefined)

  // A device runs the scenario, and a scenario's `device` clause is not part of it — it frames a
  // preview in Studio's canvas, and a phone is already a device. The clause is dropped, and the
  // notice below says it was, once per cell.
  const deviceScreen = screenSize(RN)
  const viewportNotice = deviceViewportNotice({
    ...(assignedScenario === undefined ? {} : { declared: assignedScenario.viewport }),
    ...(deviceScreen === undefined ? {} : { screen: deviceScreen }),
  })

  // An edit made on the phone is answered by the Mac; the phone is where the person is looking, so
  // that answer belongs on this screen rather than only in Studio's log.
  const sourceActionOutcome = state.sourceAction === undefined
    ? undefined
    : state.sourceAction.ok
    ? 'Studio applied the move.'
    : `Studio refused the move: ${state.sourceAction.error ?? 'no reason given'}`

  // Choosing anything in the badge menu closes it, so each action below names only its own work.
  /** Turning a named network condition on means asking for it; turning it off means normal. */
  const networkToggle = (condition: 'offline' | 'slow', id: string, name: string): DeviceMenuAction =>
    menuToggle(
      id,
      name,
      assignedNetwork === condition,
      () => client.setNetwork(assignedNetwork === condition ? 'normal' : condition),
    )
  const menuActions: readonly DeviceMenuAction[] = ([
    menuToggle('inspect', 'Inspect', inspecting, () =>
      setInspecting(on => {
        if (on) {
          setSelection(undefined)
        }
        return !on
      })),
    { disabled: selection === undefined, id: 'move-up', label: 'Move up', onPress: () => move('up') },
    { disabled: selection === undefined, id: 'move-down', label: 'Move down', onPress: () => move('down') },
    networkToggle('offline', 'offline', 'Offline'),
    networkToggle('slow', 'slow-network', 'Slow network'),
    menuToggle('layout-bounds', 'Layout bounds', devMode.layoutBounds, () => Dev.toggleLayoutBounds()),
    { id: 'scenarios', label: 'Scenarios', onPress: () => setSheetOpen(true) },
  ] satisfies readonly DeviceMenuAction[]).map(action => ({
    ...action,
    onPress: () => {
      action.onPress()
      setMenuOpen(false)
    },
  }))

  const content = presentation.kind === 'cell'
    ? createElement(StudioDeviceCell, {
      App: props.App,
      assignment: presentation.assignment,
      cellRuntime: props.cellRuntime,
      key: identityKey,
      manifest: props.manifest,
      onError: handleCellError,
    })
    : createElement(DeviceOverlay, { client, presentation })
  const observedContent = presentation.kind === 'cell'
    ? createElement(StudioDeviceLens, { client, sourceVersions: props.publication.sourceVersions }, content)
    : content
  // One provider for the whole host: the badge and sheet are its siblings, not descendants, of
  // `content`, so they need their own path to real insets too — see DeviceBadge and DeviceSheet.
  const safeArea = requireSafeAreaContext()
  return createElement(
    safeArea.SafeAreaProvider,
    // Without the startup metrics this provider is the outermost element with no parent insets, so
    // it would withhold the whole host — connecting overlay and pairing code included — until the
    // native side reports insets for the first time.
    { initialMetrics: safeArea.initialWindowMetrics ?? null },
    createElement(
      RN.View,
      { style: rootStyle, testID: 'tao-studio-device-host' },
      observedContent,
      presentation.kind === 'cell' && !inspecting
        ? createElement(DeviceRemoteHighlight, { rects: remoteHighlight })
        : null,
      presentation.kind === 'cell' && inspecting
        ? createElement(DeviceInspectOverlay, {
          onSelect: selectSource,
          ...(sourceActionOutcome === undefined ? {} : { outcome: sourceActionOutcome }),
          selection,
        })
        : null,
      createElement(DeviceNotices, {
        notices: [
          ...deviceNotice(
            'failure',
            'TAO STUDIO · SENT TO STUDIO',
            'tao-studio-device-failure',
            containedFailure,
            () => setContainedFailure(undefined),
          ),
          ...deviceNotice(
            'info',
            'TAO STUDIO · DEVICE VIEWPORT',
            'tao-studio-device-viewport',
            viewportNoticeSeen ? undefined : viewportNotice,
            () => setViewportNoticeSeen(true),
          ),
        ],
      }),
      presentation.kind === 'cell'
        ? createElement(DeviceBadge, {
          actions: menuActions,
          onPress: () => setMenuOpen(open => !open),
          open: menuOpen,
        })
        : null,
      sheetOpen
        ? createElement(DeviceSheet, { client, onClose: () => setSheetOpen(false), state })
        : null,
    ),
  )
}

/** Batches profiler callbacks after commit so a chatty render does not make one sealed frame per callback. */
function StudioDeviceLens(props: {
  children?: React.ReactNode
  client: StudioDeviceClient
  sourceVersions: Readonly<Record<string, string>>
}): React.JSX.Element {
  const pending = React.useRef<TaoStudioDeviceLensSample[]>([])
  const queued = React.useRef(false)
  const live = React.useRef(true)
  const flush = React.useCallback(() => {
    queued.current = false
    if (!live.current || pending.current.length === 0) {
      return
    }
    const samples = pending.current
    pending.current = []
    props.client.lens(samples)
  }, [props.client])
  React.useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      pending.current = []
    }
  }, [])
  const publish = React.useCallback((sample: TaoStudioLensRenderSample) => {
    const deviceSample = deviceLensSample(sample, props.sourceVersions)
    if (deviceSample === undefined || !live.current) {
      return
    }
    if (pending.current.length === TaoStudioDeviceProtocol.lensBatchLimit) {
      flush()
    }
    pending.current.push(deviceSample)
    if (!queued.current) {
      queued.current = true
      void Promise.resolve().then(flush)
    }
  }, [flush, props.sourceVersions])
  return createElement(StudioLensHost, { publish }, props.children)
}

function StudioDeviceCell(props: {
  App: React.ComponentType
  assignment: TaoStudioDeviceAssignment
  cellRuntime: StudioDeviceHostProps['cellRuntime']
  manifest: unknown
  onError: (error: unknown) => void
}): React.JSX.Element {
  const { onError, ...content } = props
  return createElement(
    StudioPreview.ErrorBoundary,
    { onError },
    createElement(StudioDeviceCellContent, content),
  )
}

/** Mirrors the browser root's `StudioPreviewContent`: register the environment domain, then mount the cell. */
function StudioDeviceCellContent(props: {
  App: React.ComponentType
  assignment: TaoStudioDeviceAssignment
  cellRuntime: StudioDeviceHostProps['cellRuntime']
  manifest: unknown
}): React.JSX.Element {
  const runtime = props.assignment.runtime
  React.useEffect(() => {
    // The bootstrap record is JSON off the wire, so its environment is capturable as it stands.
    const environment = (runtime as { cell?: { environment?: TaoRuntimeJson } } | undefined)?.cell?.environment
    if (environment === undefined) {
      return undefined
    }
    return registerRuntimeCaptureDomain({ capture: () => environment, domain: 'environment', version: 1 })
  }, [runtime])
  const cell = React.useMemo(() => props.cellRuntime(runtime, props.manifest), [
    props.cellRuntime,
    props.manifest,
    runtime,
  ])
  return createElement(
    StudioPreview.ReplayHost,
    cell.replay === undefined ? {} : { replay: cell.replay },
    createElement(StudioEnvironmentControls.Host, {
      cell,
      children: createElement(
        DeviceCellFrame,
        { bareView: cell.scenario.kind === 'view', testID: 'tao-studio-device-cell' },
        createElement(props.App),
      ),
    }),
  )
}

/**
 * A `view`-kind scenario mounts one Tao view directly inside AppShell with no navigator to apply
 * insets (AppShell only provides the SafeAreaProvider context; a navigator's own AppSurfaceFrame is
 * what turns that into padding), so on a device it paints under the status bar and home indicator.
 * An `app`-kind scenario keeps its own AppSurfaceFrame or native chrome and must stay unpadded here,
 * or a window-owning navigator (a native tab bar or stack) would be squeezed inward from the true
 * screen edges it depends on. `ConnectedDeviceHost` already establishes the `SafeAreaProvider` this
 * reads from — it does not need its own.
 */
function DeviceCellFrame(props: { bareView: boolean; children?: React.ReactNode; testID: string }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const padding = {
    paddingBottom: insets.bottom,
    paddingLeft: insets.left,
    paddingRight: insets.right,
    paddingTop: insets.top,
  }
  return createElement(
    RN.View,
    { style: props.bareView ? [rootStyle, padding] : rootStyle, testID: props.testID },
    props.children,
  )
}

type DeviceNotice = {
  eyebrow: string
  message: string
  onDismiss: () => void
  testID: string
  tone: 'failure' | 'info'
}

/** A notice exists only while it has something to say, so an absent message is no notice at all. */
function deviceNotice(
  tone: DeviceNotice['tone'],
  eyebrow: string,
  testID: string,
  message: string | undefined,
  onDismiss: () => void,
): readonly DeviceNotice[] {
  return message === undefined ? [] : [{ eyebrow, message, onDismiss, testID, tone }]
}

/**
 * Says something without taking the screen.
 *
 * Notices sit at the top rather than over the content: the person is usually mid-gesture in the app
 * when one arrives, and a failure is already on its way to Studio besides, so a notice only has to
 * say what happened — not stop the session to say it. Tapping one dismisses it.
 */
function DeviceNotices(props: { notices: readonly DeviceNotice[] }): React.JSX.Element | null {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  if (props.notices.length === 0) {
    return null
  }
  return createElement(
    RN.View,
    { style: { ...noticeLayerStyle, paddingTop: insets.top } },
    ...props.notices.map(notice =>
      createElement(
        RN.Pressable,
        {
          accessibilityLabel: `Dismiss: ${notice.message}`,
          accessibilityRole: 'button',
          key: notice.testID,
          onPress: notice.onDismiss,
          style: noticeToneStyles[notice.tone].panel,
          testID: notice.testID,
        },
        createElement(RN.Text, { style: noticeToneStyles[notice.tone].eyebrow }, notice.eyebrow),
        createElement(
          RN.Text,
          { numberOfLines: 4, style: noticeToneStyles[notice.tone].body },
          notice.message,
        ),
      )
    ),
  )
}

function DeviceOverlay(props: {
  client: StudioDeviceClient
  presentation: Extract<TaoStudioDeviceHostPresentation, { kind: 'overlay' }>
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const { presentation } = props
  return createElement(
    RN.View,
    { accessibilityRole: 'alert', style: overlayStyle, testID: 'tao-studio-device-overlay' },
    createElement(RN.Text, { style: overlayEyebrowStyle }, 'Tao Studio'),
    createElement(
      RN.Text,
      { style: overlayTitleStyle, testID: 'tao-studio-device-overlay-title' },
      presentation.title,
    ),
    presentation.code === undefined
      ? null
      : createElement(
        RN.Text,
        { selectable: true, style: codeStyle, testID: 'tao-studio-device-code' },
        presentation.code,
      ),
    createElement(
      RN.Text,
      { selectable: true, style: overlayMessageStyle, testID: 'tao-studio-device-overlay-message' },
      presentation.message,
    ),
    createElement(DeviceActions, { actions: presentation.actions, client: props.client }),
  )
}

function DeviceActions(props: {
  actions: readonly TaoStudioDeviceHostAction[]
  client: StudioDeviceClient
}): React.JSX.Element | null {
  const RN = requireReactNativeRuntime()
  if (props.actions.length === 0) {
    return null
  }
  return createElement(
    RN.View,
    { style: actionsRowStyle },
    ...props.actions.map(action =>
      createElement(
        RN.Pressable,
        {
          accessibilityRole: 'button',
          key: action,
          onPress: () => deviceActionButtons[action].press(props.client),
          style: deviceActionButtons[action].style,
          testID: `tao-studio-device-${action}`,
        },
        createElement(RN.Text, { style: actionTextStyle }, deviceActionButtons[action].label),
      )
    ),
  )
}

/**
 * The sheet's standing answer to "why does this tablet scenario look like a phone".
 *
 * The notice is dismissed and gone; this stays where a person goes to ask.
 */
export function viewportLine(
  assigned: { viewport: { height: number; width: number } } | undefined,
  screen: { height: number; width: number } | undefined,
): string {
  if (screen === undefined) {
    return 'Viewport: this device'
  }
  const declared = assigned?.viewport
  return declared === undefined || describeViewport(declared) === describeViewport(screen)
    ? `Viewport: ${describeViewport(screen)}`
    : `Viewport: ${describeViewport(screen)} · scenario declares ${describeViewport(declared)}`
}

/** The device's own size in points, or nothing where the platform will not say. */
function screenSize(runtime: ReactNativeRuntime): { height: number; width: number } | undefined {
  const window = runtime.Dimensions?.get('window')
  return typeof window?.height === 'number' && typeof window.width === 'number'
    ? { height: window.height, width: window.width }
    : undefined
}

/** A viewport as a person reads it: whole points, the way the scenario sheet writes them. */
function describeViewport(viewport: { height: number; width: number }): string {
  return `${Math.round(viewport.width)}×${Math.round(viewport.height)}`
}

/**
 * What the phone says about a viewport it cannot honour.
 *
 * A scenario's `device` clause frames a preview in Studio's canvas. A phone is already a device and
 * its own size is the truth, so what a device loads is the scenario — the fixture, the subject, the
 * appearance, the network — and not the one clause that only ever described a frame.
 *
 * It speaks up when the declared frame does not fit on this screen, because a tablet scenario
 * arriving at phone width is otherwise indistinguishable from a layout that broke. It stays quiet
 * when the frame does fit: no device is ever exactly a declared preset, and a notice on every
 * scenario would be a notice nobody reads. The sheet carries the exact numbers either way.
 */
export function deviceViewportNotice(input: {
  declared?: { height: number; width: number }
  screen?: { height: number; width: number }
}): string | undefined {
  const { declared, screen } = input
  if (declared === undefined || screen === undefined) {
    return undefined
  }
  if (
    Math.round(declared.width) <= Math.round(screen.width) && Math.round(declared.height) <= Math.round(screen.height)
  ) {
    return undefined
  }
  return `Running at this device's ${describeViewport(screen)}. The scenario declares ${
    describeViewport(declared)
  }, which is a Studio canvas frame and not something a device can be.`
}

/** DeviceBadge is the floating "Tao" affordance over a rendered cell; a drag moves it, a tap opens the sheet. */
/**
 * The named network condition the assigned cell is under, read from the bootstrap record the gateway
 * sent. Anything unrecognised reads as `normal`, which is what an unconfigured cell is.
 */
export function networkConditionOf(runtime: unknown): TaoStudioDeviceNetworkCondition {
  const network = (runtime as { cell?: { environment?: { network?: { latencyMs?: unknown; outcome?: unknown } } } })
    ?.cell?.environment?.network
  if (network?.outcome === 'offline') {
    return 'offline'
  }
  return typeof network?.latencyMs === 'number' && network.latencyMs > 0 ? 'slow' : 'normal'
}

/** Names an occurrence for the label over a selection: the owner if the compiler knew one, else the file. */
function occurrenceLabel(identity: { ownerName?: string; sourcePath: string; start: number }): string {
  if (identity.ownerName !== undefined) {
    return identity.ownerName
  }
  const name = identity.sourcePath.split('/').pop() ?? identity.sourcePath
  return `${name}:${identity.start}`
}

/**
 * Produces the wire form the gateway parses: the runtime's identity without its `kind`, plus the
 * version of that file in this bundle.
 *
 * Returns undefined when the publication does not know the file, which is the honest answer — the
 * span would be unverifiable, and Studio would have to either trust it blindly or guess a version.
 */
function occurrenceOf(
  hit: StudioInspectHit,
  sourceVersions: Readonly<Record<string, string>>,
): TaoStudioDeviceOccurrence | undefined {
  const sourceVersion = sourceVersionFor(sourceVersions, hit.identity.sourcePath)
  if (sourceVersion === undefined) {
    return undefined
  }
  return {
    end: hit.identity.end,
    ...(hit.identity.ownerName === undefined ? {} : { ownerName: hit.identity.ownerName }),
    sourcePath: hit.identity.sourcePath,
    sourceVersion,
    start: hit.identity.start,
  }
}

/**
 * Looks a file's version up in the publication, tolerating the difference between the path the
 * compiler recorded and the key the publication used — the same allowance the browser preview makes.
 */
function sourceVersionFor(
  sourceVersions: Readonly<Record<string, string>>,
  sourcePath: string,
): string | undefined {
  const direct = sourceVersions[sourcePath]
  if (direct !== undefined) {
    return direct
  }
  const normalized = normalizeSourcePath(sourcePath)
  return Object.entries(sourceVersions).find(([path]) => normalizeSourcePath(path) === normalized)?.[1]
}

function normalizeSourcePath(path: string): string {
  return path.replace(/\\/gu, '/').replace(/^\.\//u, '')
}

/**
 * The inspect mode: a full-screen tap target over the running app that answers "what is this?" with
 * the render occurrence under the finger, tells Studio to open it, and outlines it on screen.
 *
 * It also holds the measured frames from the tap that produced the selection, so a follow-up move
 * reorders against the geometry the person was actually looking at rather than re-measuring a tree
 * that may have moved underneath.
 */
function DeviceInspectOverlay(props: {
  onSelect: (selection: { hit: StudioInspectHit; hits: readonly StudioInspectHit[] } | undefined) => void
  /** What the last edit asked for did, so a refusal on the Mac is answerable on the phone. */
  outcome?: string
  selection: { hit: StudioInspectHit; hits: readonly StudioInspectHit[] } | undefined
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const [missed, setMissed] = React.useState(false)
  const onTap = React.useCallback(async (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    const point = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
    const hits = await measureStudioInspectNodes()
    const hit = bestInspectHit(hits, point)
    setMissed(hit === undefined)
    props.onSelect(hit === undefined ? undefined : { hit, hits })
  }, [props])
  const selected = props.selection
  return createElement(
    React.Fragment,
    null,
    createElement(RN.Pressable, {
      accessibilityLabel: 'Tao Studio inspect',
      onPress: onTap,
      style: inspectOverlayStyle,
      testID: 'tao-studio-device-inspect-overlay',
    }),
    selected === undefined ? null : createElement(
      RN.View,
      {
        style: outlineStyle(inspectHighlightStyle, selected.hit.rect),
        testID: 'tao-studio-device-inspect-highlight',
      },
      createElement(RN.Text, { style: inspectLabelStyle }, occurrenceLabel(selected.hit.identity)),
    ),
    createElement(
      RN.Text,
      { style: { ...inspectHintStyle, top: 12 + insets.top } },
      props.outcome !== undefined
        ? props.outcome
        : selected !== undefined
        ? `Inspecting ${occurrenceLabel(selected.hit.identity)} — open the menu to move it`
        : missed
        ? 'Nothing to inspect there — tap a rendered view'
        : 'Inspect: tap anything to select its source',
    ),
  )
}

/** Outlines what Studio selected on the Mac, so a selection made there is visible on the phone. */
function DeviceRemoteHighlight(props: { rects: readonly StudioInspectRect[] }): React.JSX.Element | null {
  const RN = requireReactNativeRuntime()
  if (props.rects.length === 0) {
    return null
  }
  return createElement(
    React.Fragment,
    null,
    ...props.rects.map((rect, index) =>
      createElement(RN.View, {
        key: `${rect.x}:${rect.y}:${index}`,
        style: outlineStyle(inspectRemoteHighlightStyle, rect),
        testID: 'tao-studio-device-remote-highlight',
      })
    ),
  )
}

/** An outline is drawn over a measured frame the same way wherever the measurement came from. */
function outlineStyle<StyleT extends object>(
  outline: StyleT,
  rect: StudioInspectRect,
): StyleT & { height: number; left: number; top: number; width: number } {
  return { ...outline, height: rect.height, left: rect.x, top: rect.y, width: rect.width }
}

/** One entry in the fan-out menu; `active` is what makes a mode read as on rather than available. */
type DeviceMenuAction = {
  active?: boolean
  disabled?: boolean
  id: string
  label: string
  onPress: () => void
}

/** A menu toggle says it is on in its label, not only in its highlight. */
function menuToggle(id: string, name: string, on: boolean, onPress: () => void): DeviceMenuAction {
  return { active: on, id, label: on ? `${name}: on` : name, onPress }
}

function DeviceBadge(
  props: { actions: readonly DeviceMenuAction[]; onPress: () => void; open: boolean },
): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const screen = screenSize(RN)
  const bounds = badgeDragBounds({ insets, screen })
  const [dragged, setDragged] = React.useState(() =>
    clampBadgePosition({ bottom: 24 + insets.bottom, right: 16 + insets.right }, bounds)
  )
  // Clamped on every render, not only on drag: a rotation shrinks the bounds under a position that
  // was legal in the other orientation, and the badge is the only way to open the sheet, so letting
  // it render off-screen would strand scenario switching, Reconnect, and Forget Studio with it.
  const position = clampBadgePosition(dragged, bounds)
  const setPosition = setDragged
  const dragStart = React.useRef<
    { bottom: number; moved: boolean; pageX: number; pageY: number; right: number } | undefined
  >(undefined)
  const badge = createElement(
    RN.Pressable,
    {
      accessibilityLabel: 'Tao Studio device menu',
      accessibilityRole: 'button',
      onPress: () => {
        if (dragStart.current?.moved !== true) {
          props.onPress()
        }
      },
      onTouchEnd: () => {
        dragStart.current = undefined
      },
      onTouchMove: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
        const start = dragStart.current
        if (start === undefined) {
          return
        }
        const dx = event.nativeEvent.pageX - start.pageX
        const dy = event.nativeEvent.pageY - start.pageY
        if (Math.abs(dx) > dragThresholdPx || Math.abs(dy) > dragThresholdPx) {
          start.moved = true
        }
        setPosition(clampBadgePosition({ bottom: start.bottom - dy, right: start.right - dx }, bounds))
      },
      onTouchStart: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
        dragStart.current = {
          bottom: position.bottom,
          moved: false,
          pageX: event.nativeEvent.pageX,
          pageY: event.nativeEvent.pageY,
          right: position.right,
        }
      },
      style: { ...badgeStyle, bottom: position.bottom, right: position.right },
      testID: 'tao-studio-device-badge',
    },
    createElement(RN.Text, { style: badgeTextStyle }, 'Tao'),
  )
  if (!props.open || props.actions.length === 0) {
    return badge
  }
  const placement = fanOutPlacement({
    badgeBottom: position.bottom,
    itemCount: props.actions.length,
    maxBottom: bounds.maxBottom,
  })
  return createElement(
    React.Fragment,
    null,
    badge,
    ...props.actions.map((action, index) =>
      createElement(
        RN.Pressable,
        {
          accessibilityLabel: action.label,
          accessibilityRole: 'button',
          ...accessibilityStateProps({ disabled: action.disabled === true, selected: action.active === true }),
          disabled: action.disabled === true,
          key: action.id,
          onPress: action.onPress,
          style: {
            ...menuItemStyle,
            ...(action.active === true ? menuItemActiveStyle : {}),
            ...(action.disabled === true ? menuItemDisabledStyle : {}),
            bottom: placement.bottoms[index] ?? position.bottom,
            right: position.right,
          },
          testID: `tao-studio-device-menu-${action.id}`,
        },
        createElement(RN.Text, { style: menuItemTextStyle }, action.label),
      )
    ),
  )
}

const dragThresholdPx = 6
const badgeMarginPx = 8
/** The badge's own width is content-sized (padding around "Tao"); this is a generous estimate for clamping. */
const badgeWidthEstimatePx = 64

/** badgeDragBounds keeps the badge's drag range clear of the safe area and, when the screen size is known, the screen edge. */
export function badgeDragBounds(input: {
  insets: { bottom: number; left: number; right: number; top: number }
  screen?: { height: number; width: number }
}): { maxBottom: number; maxRight: number; minBottom: number; minRight: number } {
  const minBottom = badgeMarginPx + input.insets.bottom
  const minRight = badgeMarginPx + input.insets.right
  return {
    maxBottom: input.screen === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(minBottom, input.screen.height - badgeStyle.height - input.insets.top - badgeMarginPx),
    maxRight: input.screen === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(minRight, input.screen.width - badgeWidthEstimatePx - input.insets.left - badgeMarginPx),
    minBottom,
    minRight,
  }
}

const menuItemHeightPx = 40
const menuSpacingPx = 8

/**
 * Places the fan-out menu's items relative to the badge.
 *
 * The badge is draggable and lives in bottom-right coordinates, so the menu cannot assume a
 * direction: fanned upward from a badge already near the top, the items would run off screen, and
 * the menu is the only way to reach inspect, scenarios and Reconnect. Upward is preferred because
 * the badge normally sits at the bottom and a thumb reaching up does not cover the items it is
 * choosing between.
 */
function fanOutPlacement(input: {
  badgeBottom: number
  itemCount: number
  maxBottom: number
}): { bottoms: readonly number[]; direction: 'down' | 'up' } {
  const step = menuItemHeightPx + menuSpacingPx
  const upward = Array.from(
    { length: input.itemCount },
    (_unused, index) => input.badgeBottom + badgeStyle.height + menuSpacingPx + index * step,
  )
  const highestTop = (upward[upward.length - 1] ?? input.badgeBottom) + menuItemHeightPx
  // `maxBottom` is the highest the badge itself may sit, so the badge's own height is headroom the
  // menu may also use.
  if (input.itemCount === 0 || highestTop <= input.maxBottom + badgeStyle.height) {
    return { bottoms: upward, direction: 'up' }
  }
  const downward = Array.from(
    { length: input.itemCount },
    (_unused, index) => input.badgeBottom - (index + 1) * step,
  )
  return downward[downward.length - 1] !== undefined && downward[downward.length - 1]! >= 0
    ? { bottoms: downward, direction: 'down' }
    : { bottoms: upward, direction: 'up' }
}

/** clampBadgePosition keeps a dragged position inside the given bounds — the badge can be pushed to an edge, never past it. */
export function clampBadgePosition(
  position: { bottom: number; right: number },
  bounds: { maxBottom: number; maxRight: number; minBottom: number; minRight: number },
): { bottom: number; right: number } {
  return {
    bottom: Math.min(Math.max(position.bottom, bounds.minBottom), bounds.maxBottom),
    right: Math.min(Math.max(position.right, bounds.minRight), bounds.maxRight),
  }
}

function DeviceSheet(props: {
  client: StudioDeviceClient
  onClose: () => void
  state: TaoStudioDeviceClientState
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  const { client, state } = props
  const scenarios = state.manifest?.scenarios ?? []
  const assigned = scenarios.find(scenario => scenario.cellId === state.assignment?.identity.cellId)
  const statusLines = [
    `Device: ${state.deviceFingerprint ?? 'unknown'}`,
    `Transport: ${state.transport.toUpperCase()}${state.host === undefined ? '' : ` · ${state.host}`}`,
    `Studio: ${state.studioFingerprint ?? 'not verified'}`,
    `Project: ${state.welcome?.projectLabel ?? '—'} · ${state.welcome?.appName ?? '—'}`,
    `Compile revision: ${state.compile?.compileRevision ?? '—'} (${state.compile?.status ?? 'unknown'})`,
    `Applied revision: ${state.appliedRevision ?? '—'}`,
    viewportLine(assigned, screenSize(RN)),
    `Last error: ${state.lastError === undefined ? 'none' : `${state.lastError.code} — ${state.lastError.message}`}`,
  ]
  return createElement(
    RN.View,
    { style: sheetBackdropStyle, testID: 'tao-studio-device-sheet' },
    createElement(
      RN.Pressable,
      {
        accessibilityLabel: 'Close',
        onPress: props.onClose,
        style: sheetDismissStyle,
        testID: 'tao-studio-device-sheet-close',
      },
    ),
    createElement(
      RN.View,
      { style: [sheetPanelStyle, { paddingBottom: Math.max(sheetPanelStyle.paddingBottom, 16 + insets.bottom) }] },
      createElement(RN.Text, { style: sheetTitleStyle }, 'Scenarios'),
      createElement(
        RN.ScrollView,
        { style: sheetListStyle },
        scenarios.length === 0
          ? createElement(RN.Text, { style: sheetStatusStyle }, 'No scenarios yet.')
          : scenarios.map(scenario =>
            createElement(
              RN.Pressable,
              {
                accessibilityRole: 'button',
                key: scenario.cellId,
                onPress: () => {
                  client.selectCell(scenario.cellId)
                  props.onClose()
                },
                style: scenario.cellId === state.assignment?.identity.cellId ? scenarioSelectedStyle : scenarioRowStyle,
                testID: `tao-studio-device-scenario-${scenario.cellId}`,
              },
              createElement(RN.Text, { style: scenarioLabelStyle }, scenario.label),
              createElement(
                RN.Text,
                { style: scenarioDetailStyle },
                `${scenario.group} · ${scenario.viewport.width}×${scenario.viewport.height}`,
              ),
            )
          ),
      ),
      createElement(
        RN.View,
        { style: sheetStatusBlockStyle, testID: 'tao-studio-device-status' },
        ...statusLines.map((line, index) =>
          createElement(RN.Text, { key: index, selectable: true, style: sheetStatusStyle }, line)
        ),
      ),
      createElement(DeviceActions, { actions: ['reconnect', 'forget'], client }),
    ),
  )
}

const rootStyle = { flex: 1 } as const

/** A layer over the whole host: the inspect target and the sheet backdrop both cover the screen. */
const screenLayerStyle = { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 } as const

const overlayStyle = {
  alignItems: 'stretch',
  backgroundColor: '#0f172a',
  flex: 1,
  gap: 16,
  justifyContent: 'center',
  minHeight: '100%',
  padding: 28,
} as const

const overlayEyebrowStyle = {
  color: '#93c5fd',
  fontSize: 14,
  fontWeight: '700',
  letterSpacing: 2,
  textTransform: 'uppercase',
} as const

const overlayTitleStyle = { color: '#f8fafc', fontSize: 28, fontWeight: '800' } as const

const overlayMessageStyle = { color: '#cbd5e1', fontSize: 16, lineHeight: 22 } as const

const codeStyle = {
  color: '#f8fafc',
  fontSize: 56,
  fontVariant: ['tabular-nums'],
  fontWeight: '800',
  letterSpacing: 6,
  textAlign: 'center',
} as const

const actionsRowStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 } as const

const actionButtonStyle = {
  backgroundColor: '#2563eb',
  borderRadius: 8,
  minHeight: 44,
  justifyContent: 'center',
  paddingHorizontal: 18,
  paddingVertical: 10,
} as const

const forgetButtonStyle = { ...actionButtonStyle, backgroundColor: '#7f1d1d' } as const

const actionTextStyle = { color: '#f8fafc', fontSize: 16, fontWeight: '700' } as const

/** The two things an overlay offers; each names its own words, its colour, and the work it does. */
const deviceActionButtons: Readonly<
  Record<TaoStudioDeviceHostAction, { label: string; press: (client: StudioDeviceClient) => void; style: object }>
> = {
  forget: { label: 'Forget Studio', press: client => void client.forgetStudio(), style: forgetButtonStyle },
  reconnect: { label: 'Reconnect', press: client => client.reconnect(), style: actionButtonStyle },
}

const noticeLayerStyle = { left: 0, position: 'absolute', right: 0, top: 0, zIndex: 10001 } as const

const noticePanelStyle = { gap: 4, paddingBottom: 12, paddingHorizontal: 16, paddingTop: 12 } as const

const noticeEyebrowStyle = { fontSize: 11, fontWeight: '700', letterSpacing: 1 } as const

const noticeBodyStyle = { fontSize: 14, lineHeight: 19 } as const

/** A notice's tone chooses its palette; the panel, the eyebrow and the body are shaped alike. */
const noticeToneStyles = {
  failure: {
    body: { ...noticeBodyStyle, color: '#fef2f2' },
    eyebrow: { ...noticeEyebrowStyle, color: '#fecaca' },
    panel: { ...noticePanelStyle, backgroundColor: '#7f1d1d' },
  },
  info: {
    body: { ...noticeBodyStyle, color: '#e2e8f0' },
    eyebrow: { ...noticeEyebrowStyle, color: '#94a3b8' },
    panel: { ...noticePanelStyle, backgroundColor: '#1e293b' },
  },
} as const

const badgeStyle = {
  alignItems: 'center',
  backgroundColor: '#111827',
  borderRadius: 18,
  elevation: 10000,
  height: 36,
  justifyContent: 'center',
  paddingHorizontal: 12,
  position: 'absolute',
  zIndex: 10000,
} as const

const badgeTextStyle = { color: '#f9fafb', fontSize: 14, fontWeight: '800' } as const

const menuItemStyle = {
  alignItems: 'center',
  backgroundColor: '#1f2937',
  borderColor: '#374151',
  borderRadius: 12,
  borderWidth: 1,
  elevation: 10000,
  height: menuItemHeightPx,
  justifyContent: 'center',
  minWidth: 132,
  paddingHorizontal: 14,
  position: 'absolute',
  zIndex: 10000,
} as const

const menuItemActiveStyle = { backgroundColor: '#2563eb', borderColor: '#60a5fa' } as const

const menuItemDisabledStyle = { opacity: 0.45 } as const

const menuItemTextStyle = { color: '#f9fafb', fontSize: 13, fontWeight: '600' } as const

/**
 * The inspect layer sits above the app and takes every touch while inspect is on. That is the whole
 * point of a mode: a tap has to mean "tell me what this is" instead of reaching the app underneath,
 * and there is no gesture that reliably means one and not the other on a phone already using taps,
 * long-presses and drags for its own purposes.
 */
const inspectOverlayStyle = { ...screenLayerStyle, zIndex: 9000 } as const

/** Both inspect outlines draw the same box over a measured frame; the colour says whose it is. */
const inspectOutlineStyle = {
  borderRadius: 4,
  borderWidth: 2,
  pointerEvents: 'none',
  position: 'absolute',
  zIndex: 9500,
} as const

const inspectHighlightStyle = { ...inspectOutlineStyle, borderColor: '#2563eb' } as const

const inspectRemoteHighlightStyle = { ...inspectOutlineStyle, borderColor: '#f59e0b', borderStyle: 'dashed' } as const

const inspectLabelStyle = {
  alignSelf: 'flex-start',
  backgroundColor: '#2563eb',
  borderRadius: 4,
  color: '#f9fafb',
  fontSize: 11,
  fontWeight: '700',
  overflow: 'hidden',
  paddingHorizontal: 6,
  paddingVertical: 2,
} as const

const inspectHintStyle = {
  backgroundColor: 'rgba(17, 24, 39, 0.92)',
  borderRadius: 10,
  color: '#f9fafb',
  fontSize: 12,
  fontWeight: '600',
  left: 12,
  overflow: 'hidden',
  paddingHorizontal: 10,
  paddingVertical: 6,
  pointerEvents: 'none',
  position: 'absolute',
  right: 12,
  textAlign: 'center',
  zIndex: 9600,
} as const

const sheetBackdropStyle = { ...screenLayerStyle, elevation: 9999, justifyContent: 'flex-end', zIndex: 9999 } as const

const sheetDismissStyle = { backgroundColor: 'rgba(15, 23, 42, 0.45)', flex: 1 } as const

const sheetPanelStyle = {
  backgroundColor: '#111827',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  gap: 12,
  maxHeight: '75%',
  padding: 16,
  paddingBottom: 28,
} as const

const sheetTitleStyle = { color: '#f9fafb', fontSize: 18, fontWeight: '800' } as const

const sheetListStyle = { flexGrow: 0, maxHeight: 260 } as const

const scenarioRowStyle = { borderRadius: 8, gap: 2, paddingHorizontal: 12, paddingVertical: 10 } as const

const scenarioSelectedStyle = { ...scenarioRowStyle, backgroundColor: '#1f2937' } as const

const scenarioLabelStyle = { color: '#f9fafb', fontSize: 16, fontWeight: '600' } as const

const scenarioDetailStyle = { color: '#9ca3af', fontSize: 13 } as const

const sheetStatusBlockStyle = { borderTopColor: '#374151', borderTopWidth: 1, gap: 4, paddingTop: 12 } as const

const sheetStatusStyle = { color: '#d1d5db', fontFamily: 'monospace', fontSize: 12 } as const
