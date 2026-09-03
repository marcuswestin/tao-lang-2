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
import { requireSafeAreaContext } from './TR-app-shell'
import { errorMessage } from './TR-errors'
import { NativeModules } from './TR-native-modules'
import { type ReactNativeRuntime, requireReactNativeRuntime } from './TR-react-native'
import {
  registerRuntimeCaptureDomain,
  type TaoRuntimeCaptureArtifact,
  type TaoRuntimeJson,
} from './TR-runtime-capture'
import {
  createStudioDeviceClient,
  type StudioDeviceClient,
  type TaoStudioDeviceAssignment,
  type TaoStudioDeviceBootstrap,
  type TaoStudioDeviceClientPhase,
  type TaoStudioDeviceClientState,
  type TaoStudioDeviceSocket,
  type TaoStudioDeviceStorage,
  type TaoStudioDeviceStoredRecord,
  type TaoStudioDeviceTransport,
} from './TR-studio-device-client'
import type { TaoStudioDeviceCellIdentity, TaoStudioDeviceDescription } from './TR-studio-device-protocol'
import { StudioDeviceTrust } from './TR-studio-device-trust'
import { StudioEnvironmentControls, type TaoStudioCellRuntime } from './TR-studio-environment'
import { StudioPreview } from './TR-studio-preview'

export type TaoStudioDeviceHostPublication = {
  appName: string
  compileRevision: number
  project: string
  sourceVersions: Readonly<Record<string, string>>
}

/** The cell runtime the generated adapter builds, plus the replay artifact the browser root also passes. */
export type TaoStudioDeviceCellRuntime = TaoStudioCellRuntime & { replay?: TaoRuntimeCaptureArtifact }

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

export type TaoStudioDeviceHostAction = 'forget' | 'reconnect'

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
  const gatewayPort = typeof input.gatewayPort === 'number' && Number.isSafeInteger(input.gatewayPort)
      && input.gatewayPort > 0 && input.gatewayPort <= 65_535
    ? input.gatewayPort
    : undefined
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
 * shouldRedialOnForeground decides whether the app returning to the foreground should shortcut the
 * client's own backoff with an immediate reconnect. Only a genuine background→active transition
 * while the client already gave up (`disconnected`) qualifies — a client mid-attempt or already
 * connected has nothing for this to fix, and redialing it would tear down a healthy session.
 */
export function shouldRedialOnForeground(
  previousAppState: string,
  nextAppState: string,
  phase: TaoStudioDeviceClientPhase,
): boolean {
  return previousAppState !== 'active' && nextAppState === 'active' && phase === 'disconnected'
}

/** deviceHostPresentation decides what one client snapshot puts on the screen. */
export function deviceHostPresentation(
  state: TaoStudioDeviceClientState,
  publication: Pick<TaoStudioDeviceHostPublication, 'compileRevision'>,
): TaoStudioDeviceHostPresentation {
  const host = state.host === undefined ? 'Tao Studio' : `Tao Studio at ${state.host}`
  if (state.phase === 'idle') {
    return {
      actions: ['reconnect'],
      kind: 'overlay',
      message: 'The device host is not connected to Tao Studio.',
      reason: 'idle',
      title: 'Not connected',
    }
  }
  if (state.phase === 'connecting') {
    return { actions: [], kind: 'overlay', message: `Reaching ${host}…`, reason: 'connecting', title: 'Connecting' }
  }
  if (state.phase === 'handshaking') {
    return {
      actions: [],
      kind: 'overlay',
      message: `Verifying ${host}${state.studioFingerprint === undefined ? '' : ` (${state.studioFingerprint})`}…`,
      reason: 'handshaking',
      title: 'Verifying Tao Studio',
    }
  }
  if (state.phase === 'pairing') {
    return {
      actions: [],
      ...(state.code === undefined ? {} : { code: state.code }),
      kind: 'overlay',
      message: 'Compare this code with Tao Studio, then confirm there.',
      reason: 'pairing',
      title: 'Pair with Tao Studio',
    }
  }
  if (state.phase === 'disconnected') {
    if (state.lastError?.code === 'studio-key-mismatch') {
      return {
        actions: ['forget', 'reconnect'],
        kind: 'overlay',
        message: state.lastError.message,
        reason: 'key-mismatch',
        title: 'Tao Studio changed its identity',
      }
    }
    if (state.lastError?.code === 'pairing-closed' && state.retryAt !== undefined) {
      return {
        actions: ['reconnect'],
        kind: 'overlay',
        message: `${state.lastError.message} This phone keeps asking until you do.`,
        reason: 'pairing-closed',
        title: 'Waiting for pairing',
      }
    }
    const retry = state.retryAt === undefined ? '' : ' Retrying automatically.'
    return {
      actions: ['reconnect'],
      kind: 'overlay',
      message: `${state.lastError?.message ?? 'The connection ended.'}${retry}`,
      reason: 'disconnected',
      title: `Disconnected${state.lastError === undefined ? '' : ` (${state.lastError.code})`}`,
    }
  }
  if (state.cellUnavailable !== undefined) {
    return {
      actions: [],
      kind: 'overlay',
      message: state.cellUnavailable.message,
      reason: 'cell-unavailable',
      title: `Scenario unavailable (${state.cellUnavailable.code})`,
    }
  }
  if (state.assignment === undefined) {
    return {
      actions: [],
      kind: 'overlay',
      message: 'Connected. Waiting for Tao Studio to assign a scenario.',
      reason: 'waiting-for-cell',
      title: 'Waiting for a scenario',
    }
  }
  const assigned = state.assignment.identity.compileRevision
  if (assigned !== publication.compileRevision) {
    return {
      actions: [],
      kind: 'overlay',
      message: `Stale bundle: device has revision ${publication.compileRevision}, `
        + `Studio assigned ${assigned} — waiting for Fast Refresh.`,
      reason: 'stale-bundle',
      title: 'Waiting for Fast Refresh',
    }
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
  return {
    client: createStudioDeviceClient({
      bootstrap: resolution.bootstrap,
      storage: secureStoreStorage(secureStore),
      transport: webSocketTransport(WebSocketImplementation),
    }),
    kind: 'ready',
  }
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

/** parseStoredRecord accepts only a complete record; anything else is treated as no record at all. */
export function parseStoredRecord(raw: string): TaoStudioDeviceStoredRecord | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const identity = record['identity']
  if (typeof identity !== 'object' || identity === null) {
    return undefined
  }
  const { publicKey, secretKey } = identity as Record<string, unknown>
  const pinnedStudioKey = record['pinnedStudioKey']
  if (
    typeof publicKey !== 'string'
    || typeof secretKey !== 'string'
    || !StudioDeviceTrust.validPublicKey(publicKey)
    || (pinnedStudioKey !== undefined && typeof pinnedStudioKey !== 'string')
  ) {
    return undefined
  }
  return {
    identity: { publicKey, secretKey },
    ...(pinnedStudioKey === undefined ? {} : { pinnedStudioKey }),
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
  if (client === undefined || resolution.kind === 'missing') {
    return React.createElement(
      RN.View,
      { style: overlayStyle, testID: 'tao-studio-device-overlay' },
      React.createElement(
        RN.Text,
        { style: overlayTitleStyle, testID: 'tao-studio-device-overlay-title' },
        'Tao Studio device host cannot start',
      ),
      React.createElement(
        RN.Text,
        { selectable: true, style: overlayMessageStyle, testID: 'tao-studio-device-overlay-message' },
        (resolution.kind === 'missing' ? resolution.missing : []).map(item => `• ${item}`).join('\n'),
      ),
    )
  }
  return React.createElement(ConnectedDeviceHost, { ...props, client })
}

function ConnectedDeviceHost(props: StudioDeviceHostProps & { client: StudioDeviceClient }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const { client } = props
  const state = React.useSyncExternalStore(client.subscribe, client.state, client.state)
  const presentation = deviceHostPresentation(state, props.publication)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const identityKey = presentation.kind === 'cell' ? cellIdentityKey(presentation.assignment.identity) : undefined
  const identity = presentation.kind === 'cell' ? presentation.assignment.identity : undefined
  const appliedKey = React.useRef<string | undefined>(undefined)
  const compileRevision = props.publication.compileRevision
  // Runs after the cell subtree mounted, once per identity: the acknowledgement names what is on screen.
  React.useEffect(() => {
    if (identityKey === undefined || identity === undefined || appliedKey.current === identityKey) {
      return
    }
    appliedKey.current = identityKey
    client.applied(identity, compileRevision)
  }, [client, compileRevision, identity, identityKey])

  // A dropped socket already retries on its own backoff (capped at 15s); this only shortens that
  // wait when the app resumes from the background and finds itself still disconnected. It must not
  // fire when the client is merely mid-attempt (connecting, handshaking, pairing) or already
  // connected — reconnect() would tear down and redial a healthy session for no reason.
  React.useEffect(() => {
    const AppState = RN.AppState
    if (AppState === undefined) {
      return undefined
    }
    let previousAppState = AppState.currentState
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (shouldRedialOnForeground(previousAppState, nextAppState, client.state().phase)) {
        client.reconnect()
      }
      previousAppState = nextAppState
    })
    return () => subscription.remove()
  }, [RN.AppState, client])

  const content = presentation.kind === 'cell'
    ? React.createElement(StudioDeviceCell, {
      App: props.App,
      assignment: presentation.assignment,
      cellRuntime: props.cellRuntime,
      key: identityKey,
      manifest: props.manifest,
    })
    : React.createElement(DeviceOverlay, { client, presentation })
  return React.createElement(
    RN.View,
    { style: rootStyle, testID: 'tao-studio-device-host' },
    content,
    presentation.kind === 'cell'
      ? React.createElement(DeviceBadge, { onPress: () => setSheetOpen(open => !open) })
      : null,
    sheetOpen
      ? React.createElement(DeviceSheet, { client, onClose: () => setSheetOpen(false), state })
      : null,
  )
}

function StudioDeviceCell(props: {
  App: React.ComponentType
  assignment: TaoStudioDeviceAssignment
  cellRuntime: StudioDeviceHostProps['cellRuntime']
  manifest: unknown
}): React.JSX.Element {
  return React.createElement(
    StudioPreview.ErrorBoundary,
    null,
    React.createElement(StudioDeviceCellContent, props),
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
  return React.createElement(
    StudioPreview.ReplayHost,
    cell.replay === undefined ? {} : { replay: cell.replay },
    React.createElement(StudioEnvironmentControls.Host, {
      cell,
      children: React.createElement(
        DeviceCellFrame,
        { bareView: cell.scenario.kind === 'view', testID: 'tao-studio-device-cell' },
        React.createElement(props.App),
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
 * screen edges it depends on.
 */
function DeviceCellFrame(props: { bareView: boolean; children?: React.ReactNode; testID: string }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  if (!props.bareView) {
    return React.createElement(RN.View, { style: rootStyle, testID: props.testID }, props.children)
  }
  const SafeAreaContext = requireSafeAreaContext()
  return React.createElement(
    SafeAreaContext.SafeAreaProvider,
    null,
    React.createElement(BareViewCellFrame, { children: props.children, testID: props.testID }),
  )
}

function BareViewCellFrame(props: { children?: React.ReactNode; testID: string }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const insets = requireSafeAreaContext().useSafeAreaInsets()
  return React.createElement(
    RN.View,
    {
      style: [
        rootStyle,
        {
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
          paddingTop: insets.top,
        },
      ],
      testID: props.testID,
    },
    props.children,
  )
}

function DeviceOverlay(props: {
  client: StudioDeviceClient
  presentation: Extract<TaoStudioDeviceHostPresentation, { kind: 'overlay' }>
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const { presentation } = props
  return React.createElement(
    RN.View,
    { accessibilityRole: 'alert', style: overlayStyle, testID: 'tao-studio-device-overlay' },
    React.createElement(RN.Text, { style: overlayEyebrowStyle }, 'Tao Studio'),
    React.createElement(
      RN.Text,
      { style: overlayTitleStyle, testID: 'tao-studio-device-overlay-title' },
      presentation.title,
    ),
    presentation.code === undefined
      ? null
      : React.createElement(
        RN.Text,
        { selectable: true, style: codeStyle, testID: 'tao-studio-device-code' },
        presentation.code,
      ),
    React.createElement(
      RN.Text,
      { selectable: true, style: overlayMessageStyle, testID: 'tao-studio-device-overlay-message' },
      presentation.message,
    ),
    React.createElement(DeviceActions, { actions: presentation.actions, client: props.client }),
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
  return React.createElement(
    RN.View,
    { style: actionsRowStyle },
    ...props.actions.map(action =>
      React.createElement(
        RN.Pressable,
        {
          accessibilityRole: 'button',
          key: action,
          onPress: () => {
            if (action === 'forget') {
              void props.client.forgetStudio()
            } else {
              props.client.reconnect()
            }
          },
          style: action === 'forget' ? forgetButtonStyle : actionButtonStyle,
          testID: `tao-studio-device-${action}`,
        },
        React.createElement(RN.Text, { style: actionTextStyle }, action === 'forget' ? 'Forget Studio' : 'Reconnect'),
      )
    ),
  )
}

/** DeviceBadge is the floating "Tao" affordance over a rendered cell; a drag moves it, a tap opens the sheet. */
function DeviceBadge(props: { onPress: () => void }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const [position, setPosition] = React.useState({ bottom: 24, right: 16 })
  const dragStart = React.useRef<{ bottom: number; pageX: number; pageY: number; right: number } | undefined>(undefined)
  return React.createElement(
    RN.Pressable,
    {
      accessibilityLabel: 'Tao Studio device menu',
      accessibilityRole: 'button',
      onPress: props.onPress,
      onTouchMove: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
        const start = dragStart.current
        if (start === undefined) {
          return
        }
        setPosition({
          bottom: Math.max(8, start.bottom - (event.nativeEvent.pageY - start.pageY)),
          right: Math.max(8, start.right - (event.nativeEvent.pageX - start.pageX)),
        })
      },
      onTouchStart: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
        dragStart.current = {
          bottom: position.bottom,
          pageX: event.nativeEvent.pageX,
          pageY: event.nativeEvent.pageY,
          right: position.right,
        }
      },
      style: { ...badgeStyle, bottom: position.bottom, right: position.right },
      testID: 'tao-studio-device-badge',
    },
    React.createElement(RN.Text, { style: badgeTextStyle }, 'Tao'),
  )
}

function DeviceSheet(props: {
  client: StudioDeviceClient
  onClose: () => void
  state: TaoStudioDeviceClientState
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const { client, state } = props
  const scenarios = state.manifest?.scenarios ?? []
  const statusLines = [
    `Device: ${state.deviceFingerprint ?? 'unknown'}`,
    `Transport: ${state.transport.toUpperCase()}${state.host === undefined ? '' : ` · ${state.host}`}`,
    `Studio: ${state.studioFingerprint ?? 'not verified'}`,
    `Project: ${state.welcome?.projectLabel ?? '—'} · ${state.welcome?.appName ?? '—'}`,
    `Compile revision: ${state.compile?.compileRevision ?? '—'} (${state.compile?.status ?? 'unknown'})`,
    `Applied revision: ${state.appliedRevision ?? '—'}`,
    `Last error: ${state.lastError === undefined ? 'none' : `${state.lastError.code} — ${state.lastError.message}`}`,
  ]
  return React.createElement(
    RN.View,
    { style: sheetBackdropStyle, testID: 'tao-studio-device-sheet' },
    React.createElement(
      RN.Pressable,
      {
        accessibilityLabel: 'Close',
        onPress: props.onClose,
        style: sheetDismissStyle,
        testID: 'tao-studio-device-sheet-close',
      },
    ),
    React.createElement(
      RN.View,
      { style: sheetPanelStyle },
      React.createElement(RN.Text, { style: sheetTitleStyle }, 'Scenarios'),
      React.createElement(
        RN.ScrollView,
        { style: sheetListStyle },
        scenarios.length === 0
          ? React.createElement(RN.Text, { style: sheetStatusStyle }, 'No scenarios yet.')
          : scenarios.map(scenario =>
            React.createElement(
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
              React.createElement(RN.Text, { style: scenarioLabelStyle }, scenario.label),
              React.createElement(
                RN.Text,
                { style: scenarioDetailStyle },
                `${scenario.group} · ${scenario.viewport.width}×${scenario.viewport.height}`,
              ),
            )
          ),
      ),
      React.createElement(
        RN.View,
        { style: sheetStatusBlockStyle, testID: 'tao-studio-device-status' },
        ...statusLines.map((line, index) =>
          React.createElement(RN.Text, { key: index, selectable: true, style: sheetStatusStyle }, line)
        ),
      ),
      React.createElement(DeviceActions, { actions: ['reconnect', 'forget'], client }),
    ),
  )
}

const rootStyle = { flex: 1 } as const

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

const overlayTitleStyle = {
  color: '#f8fafc',
  fontSize: 28,
  fontWeight: '800',
} as const

const overlayMessageStyle = {
  color: '#cbd5e1',
  fontSize: 16,
  lineHeight: 22,
} as const

const codeStyle = {
  color: '#f8fafc',
  fontSize: 56,
  fontVariant: ['tabular-nums'],
  fontWeight: '800',
  letterSpacing: 6,
  textAlign: 'center',
} as const

const actionsRowStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 8,
} as const

const actionButtonStyle = {
  backgroundColor: '#2563eb',
  borderRadius: 8,
  minHeight: 44,
  justifyContent: 'center',
  paddingHorizontal: 18,
  paddingVertical: 10,
} as const

const forgetButtonStyle = {
  ...actionButtonStyle,
  backgroundColor: '#7f1d1d',
} as const

const actionTextStyle = {
  color: '#f8fafc',
  fontSize: 16,
  fontWeight: '700',
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

const badgeTextStyle = {
  color: '#f9fafb',
  fontSize: 14,
  fontWeight: '800',
} as const

const sheetBackdropStyle = {
  bottom: 0,
  elevation: 9999,
  justifyContent: 'flex-end',
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
  zIndex: 9999,
} as const

const sheetDismissStyle = {
  backgroundColor: 'rgba(15, 23, 42, 0.45)',
  flex: 1,
} as const

const sheetPanelStyle = {
  backgroundColor: '#111827',
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  gap: 12,
  maxHeight: '75%',
  padding: 16,
  paddingBottom: 28,
} as const

const sheetTitleStyle = {
  color: '#f9fafb',
  fontSize: 18,
  fontWeight: '800',
} as const

const sheetListStyle = {
  flexGrow: 0,
  maxHeight: 260,
} as const

const scenarioRowStyle = {
  borderRadius: 8,
  gap: 2,
  paddingHorizontal: 12,
  paddingVertical: 10,
} as const

const scenarioSelectedStyle = {
  ...scenarioRowStyle,
  backgroundColor: '#1f2937',
} as const

const scenarioLabelStyle = {
  color: '#f9fafb',
  fontSize: 16,
  fontWeight: '600',
} as const

const scenarioDetailStyle = {
  color: '#9ca3af',
  fontSize: 13,
} as const

const sheetStatusBlockStyle = {
  borderTopColor: '#374151',
  borderTopWidth: 1,
  gap: 4,
  paddingTop: 12,
} as const

const sheetStatusStyle = {
  color: '#d1d5db',
  fontFamily: 'monospace',
  fontSize: 12,
} as const
