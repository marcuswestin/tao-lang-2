/**
 * The tao-studio-device-v1 wire contract shared by the Studio device gateway, the native device
 * host, and the workbench. It has no dependencies so the dependency-light runtime, Studio, and the
 * development tooling can all import it. `Docs/Roadmap/Tao Studio companion app/Slice 1 - Device
 * protocol and trust.md` owns the design; this module owns the exact shapes and their parsers.
 */

export const TaoStudioDeviceProtocol = {
  /** A handshake frame that is larger than this is malformed, not merely large. */
  helloLimitBytes: 8_192,
  /** Any sealed frame above this closes the connection. */
  frameLimitBytes: 262_144,
  handshakeTimeoutMs: 20_000,
  heartbeatMs: 15_000,
  name: 'tao-studio-device-v1',
  pairingWindowMs: 120_000,
  version: 1,
} as const

export type TaoStudioDeviceProtocolName = typeof TaoStudioDeviceProtocol.name

export type TaoStudioDeviceRejectCode =
  | 'bad-signature'
  | 'gateway-stopped'
  | 'malformed'
  | 'oversized'
  | 'pairing-closed'
  | 'pairing-declined'
  | 'replaced'
  | 'replayed-frame'
  | 'revoked'
  | 'studio-key-mismatch'
  | 'timeout'
  | 'unknown-message'
  | 'unknown-session'
  | 'unsupported-protocol'
  | 'untrusted-device'

export type TaoStudioDeviceCellCode = 'manifest-unavailable' | 'unknown-cell'

export type TaoStudioDeviceDescription = {
  appVersion?: string
  model: string
  name: string
  os: string
}

export type TaoStudioDeviceCellIdentity = {
  appName: string
  cellId: string
  cellRevision: number
  compileRevision: number
  manifestRevision: string
  previewInstanceId: string
}

export type TaoStudioDeviceScenario = {
  cellId: string
  cellRevision: number
  group: string
  label: string
  scenarioId: string
  viewport: { height: number; width: number }
}

export type TaoStudioDeviceManifest = {
  compileRevision: number
  manifestRevision: string
  scenarios: readonly TaoStudioDeviceScenario[]
}

export type TaoStudioDeviceCompileState = {
  appliedRevision: number
  compileRevision: number
  message: string
  status: 'compiled' | 'compiling' | 'error' | 'idle'
}

// Clear handshake frames.

export type TaoStudioDeviceHelloMessage = {
  device: TaoStudioDeviceDescription
  devicePublicKey: string
  ephemeralPublicKey: string
  metroPort?: number
  nonce: string
  pinnedStudioKey?: string
  protocol: TaoStudioDeviceProtocolName
  sessionId?: string
  type: 'device.hello'
}

export type TaoStudioDeviceStudioHelloMessage = {
  ephemeralPublicKey: string
  mode: 'pair' | 'reconnect'
  nonce: string
  protocol: TaoStudioDeviceProtocolName
  signature: string
  studioPublicKey: string
  type: 'studio.hello'
}

export type TaoStudioDeviceConfirmMessage = {
  signature: string
  type: 'device.confirm'
}

export type TaoStudioDeviceRejectedMessage = {
  code: TaoStudioDeviceRejectCode
  message: string
  type: 'studio.rejected'
}

export type TaoStudioDeviceSealedFrame = {
  box: string
  nonce: string
  seq: number
  type: 'sealed'
}

export type TaoStudioDeviceClearMessage =
  | TaoStudioDeviceConfirmMessage
  | TaoStudioDeviceHelloMessage
  | TaoStudioDeviceRejectedMessage
  | TaoStudioDeviceSealedFrame
  | TaoStudioDeviceStudioHelloMessage

// Sealed control messages, Studio to device.

export type TaoStudioDeviceStudioMessage =
  | { type: 'studio.pairingPending' }
  | {
    appName: string
    capabilities: readonly string[]
    compile: TaoStudioDeviceCompileState
    heartbeatMs: number
    manifest?: TaoStudioDeviceManifest
    projectLabel: string
    sessionId: string
    type: 'studio.welcome'
  }
  | { manifest: TaoStudioDeviceManifest; type: 'studio.manifest' }
  | (TaoStudioDeviceCompileState & { type: 'studio.compileState' })
  | { identity: TaoStudioDeviceCellIdentity; runtime: unknown; type: 'studio.cellAssigned' }
  | { cellId: string; code: TaoStudioDeviceCellCode; message: string; type: 'studio.cellUnavailable' }
  | { accepted: boolean; compileRevision: number; type: 'studio.appliedAck' }
  | { type: 'studio.reconnect' }
  | { reason: string; type: 'studio.revoked' }
  | { type: 'studio.pong' }
  | { code: string; message: string; type: 'studio.error' }

// Sealed control messages, device to Studio.

export type TaoStudioDeviceDeviceMessage =
  | { cellId: string; type: 'device.selectCell' }
  | {
    appliedRevision: number
    compileRevision: number
    identity: TaoStudioDeviceCellIdentity
    type: 'device.applied'
  }
  | { level: 'error' | 'info'; message: string; type: 'device.report' }
  | { type: 'device.ping' }

const rejectCodes: ReadonlySet<string> = new Set<TaoStudioDeviceRejectCode>([
  'bad-signature',
  'gateway-stopped',
  'malformed',
  'oversized',
  'pairing-closed',
  'pairing-declined',
  'replaced',
  'replayed-frame',
  'revoked',
  'studio-key-mismatch',
  'timeout',
  'unknown-message',
  'unknown-session',
  'unsupported-protocol',
  'untrusted-device',
])

const compileStatuses: ReadonlySet<string> = new Set(['compiled', 'compiling', 'error', 'idle'])

/** Parsers accept unknown JSON and return a typed message or `undefined`; they never throw. */
export const StudioDeviceProtocol = {
  /** Reads one clear frame. A sealed frame is returned as-is for the trust layer to open. */
  parseClearMessage(value: unknown): TaoStudioDeviceClearMessage | undefined {
    if (!isObject(value)) {
      return undefined
    }
    return dispatch(clearMessageParsers, value)
  },
  parseDeviceMessage(value: unknown): TaoStudioDeviceDeviceMessage | undefined {
    if (!isObject(value)) {
      return undefined
    }
    return dispatch(deviceMessageParsers, value)
  },
  parseStudioMessage(value: unknown): TaoStudioDeviceStudioMessage | undefined {
    if (!isObject(value)) {
      return undefined
    }
    return dispatch(studioMessageParsers, value)
  },
  /** Reads a text frame within the given byte limit. Oversized or invalid JSON yields `undefined`. */
  parseText(
    text: string,
    limitBytes: number,
  ): { kind: 'oversized' } | { kind: 'invalid' } | { kind: 'json'; value: unknown } {
    if (utf8ByteLength(text) > limitBytes) {
      return { kind: 'oversized' }
    }
    try {
      return { kind: 'json', value: JSON.parse(text) as unknown }
    } catch {
      return { kind: 'invalid' }
    }
  },
  utf8ByteLength,
} as const

type MessageParsers<MessageT> = Readonly<Record<string, (value: Record<string, unknown>) => MessageT | undefined>>

/** dispatch looks the frame's `type` up in a parser table; an unknown type is simply not a message. */
function dispatch<MessageT>(parsers: MessageParsers<MessageT>, value: Record<string, unknown>): MessageT | undefined {
  const type = value['type']
  const parse = typeof type === 'string' ? parsers[type] : undefined
  return parse === undefined ? undefined : parse(value)
}

const clearMessageParsers: MessageParsers<TaoStudioDeviceClearMessage> = {
  'device.confirm': value =>
    nonEmptyString(value['signature']) ? { signature: value['signature'], type: 'device.confirm' } : undefined,
  'device.hello': parseDeviceHello,
  'sealed': value =>
    nonEmptyString(value['box'])
      && nonEmptyString(value['nonce'])
      && positiveInteger(value['seq'])
      ? { box: value['box'], nonce: value['nonce'], seq: value['seq'], type: 'sealed' }
      : undefined,
  'studio.hello': parseStudioHello,
  'studio.rejected': value =>
    isRejectCode(value['code']) && typeof value['message'] === 'string'
      ? { code: value['code'], message: value['message'], type: 'studio.rejected' }
      : undefined,
}

const deviceMessageParsers: MessageParsers<TaoStudioDeviceDeviceMessage> = {
  'device.applied': value => {
    const identity = parseCellIdentity(value['identity'])
    return identity !== undefined
        && nonNegativeInteger(value['compileRevision'])
        && nonNegativeInteger(value['appliedRevision'])
      ? {
        appliedRevision: value['appliedRevision'],
        compileRevision: value['compileRevision'],
        identity,
        type: 'device.applied',
      }
      : undefined
  },
  'device.ping': () => ({ type: 'device.ping' }),
  'device.report': value =>
    (value['level'] === 'error' || value['level'] === 'info') && typeof value['message'] === 'string'
      ? { level: value['level'], message: value['message'], type: 'device.report' }
      : undefined,
  'device.selectCell': value =>
    nonEmptyString(value['cellId']) ? { cellId: value['cellId'], type: 'device.selectCell' } : undefined,
}

const studioMessageParsers: MessageParsers<TaoStudioDeviceStudioMessage> = {
  'studio.appliedAck': value =>
    typeof value['accepted'] === 'boolean' && nonNegativeInteger(value['compileRevision'])
      ? { accepted: value['accepted'], compileRevision: value['compileRevision'], type: 'studio.appliedAck' }
      : undefined,
  'studio.cellAssigned': value => {
    const identity = parseCellIdentity(value['identity'])
    return identity === undefined || !('runtime' in value)
      ? undefined
      : { identity, runtime: value['runtime'], type: 'studio.cellAssigned' }
  },
  'studio.cellUnavailable': value =>
    nonEmptyString(value['cellId'])
      && (value['code'] === 'manifest-unavailable' || value['code'] === 'unknown-cell')
      && typeof value['message'] === 'string'
      ? { cellId: value['cellId'], code: value['code'], message: value['message'], type: 'studio.cellUnavailable' }
      : undefined,
  'studio.compileState': value => {
    const compile = parseCompileState(value)
    return compile === undefined ? undefined : { ...compile, type: 'studio.compileState' }
  },
  'studio.error': value =>
    nonEmptyString(value['code']) && typeof value['message'] === 'string'
      ? { code: value['code'], message: value['message'], type: 'studio.error' }
      : undefined,
  'studio.manifest': value => {
    const manifest = parseManifest(value['manifest'])
    return manifest === undefined ? undefined : { manifest, type: 'studio.manifest' }
  },
  'studio.pairingPending': () => ({ type: 'studio.pairingPending' }),
  'studio.pong': () => ({ type: 'studio.pong' }),
  'studio.reconnect': () => ({ type: 'studio.reconnect' }),
  'studio.revoked': value =>
    typeof value['reason'] === 'string' ? { reason: value['reason'], type: 'studio.revoked' } : undefined,
  'studio.welcome': value => {
    const compile = parseCompileState(value['compile'])
    const manifest = value['manifest'] === undefined ? undefined : parseManifest(value['manifest'])
    if (
      compile === undefined
      || (value['manifest'] !== undefined && manifest === undefined)
      || !nonEmptyString(value['sessionId'])
      || !nonEmptyString(value['appName'])
      || typeof value['projectLabel'] !== 'string'
      || !positiveInteger(value['heartbeatMs'])
      || !Array.isArray(value['capabilities'])
      || !value['capabilities'].every(nonEmptyString)
    ) {
      return undefined
    }
    return {
      appName: value['appName'],
      capabilities: value['capabilities'],
      compile,
      heartbeatMs: value['heartbeatMs'],
      ...(manifest === undefined ? {} : { manifest }),
      projectLabel: value['projectLabel'],
      sessionId: value['sessionId'],
      type: 'studio.welcome',
    }
  },
}

function parseDeviceHello(value: Record<string, unknown>): TaoStudioDeviceHelloMessage | undefined {
  const device = value['device']
  if (
    value['protocol'] !== TaoStudioDeviceProtocol.name
    || !isObject(device)
    || !nonEmptyString(device['name'])
    || typeof device['model'] !== 'string'
    || typeof device['os'] !== 'string'
    || (device['appVersion'] !== undefined && typeof device['appVersion'] !== 'string')
    || !nonEmptyString(value['devicePublicKey'])
    || !nonEmptyString(value['ephemeralPublicKey'])
    || !nonEmptyString(value['nonce'])
    || (value['metroPort'] !== undefined && !validPort(value['metroPort']))
    || (value['sessionId'] !== undefined && !nonEmptyString(value['sessionId']))
    || (value['pinnedStudioKey'] !== undefined && !nonEmptyString(value['pinnedStudioKey']))
  ) {
    return undefined
  }
  return {
    device: {
      ...(device['appVersion'] === undefined ? {} : { appVersion: device['appVersion'] as string }),
      model: device['model'],
      name: device['name'],
      os: device['os'],
    },
    devicePublicKey: value['devicePublicKey'],
    ephemeralPublicKey: value['ephemeralPublicKey'],
    ...(value['metroPort'] === undefined ? {} : { metroPort: value['metroPort'] as number }),
    nonce: value['nonce'],
    ...(value['pinnedStudioKey'] === undefined ? {} : { pinnedStudioKey: value['pinnedStudioKey'] as string }),
    protocol: TaoStudioDeviceProtocol.name,
    ...(value['sessionId'] === undefined ? {} : { sessionId: value['sessionId'] as string }),
    type: 'device.hello',
  }
}

function parseStudioHello(value: Record<string, unknown>): TaoStudioDeviceStudioHelloMessage | undefined {
  if (
    value['protocol'] !== TaoStudioDeviceProtocol.name
    || (value['mode'] !== 'pair' && value['mode'] !== 'reconnect')
    || !nonEmptyString(value['studioPublicKey'])
    || !nonEmptyString(value['ephemeralPublicKey'])
    || !nonEmptyString(value['nonce'])
    || !nonEmptyString(value['signature'])
  ) {
    return undefined
  }
  return {
    ephemeralPublicKey: value['ephemeralPublicKey'],
    mode: value['mode'],
    nonce: value['nonce'],
    protocol: TaoStudioDeviceProtocol.name,
    signature: value['signature'],
    studioPublicKey: value['studioPublicKey'],
    type: 'studio.hello',
  }
}

function parseCellIdentity(value: unknown): TaoStudioDeviceCellIdentity | undefined {
  if (
    !isObject(value)
    || !nonEmptyString(value['appName'])
    || !nonEmptyString(value['cellId'])
    || !nonNegativeInteger(value['cellRevision'])
    || !nonNegativeInteger(value['compileRevision'])
    || !nonEmptyString(value['manifestRevision'])
    || !nonEmptyString(value['previewInstanceId'])
  ) {
    return undefined
  }
  return {
    appName: value['appName'],
    cellId: value['cellId'],
    cellRevision: value['cellRevision'],
    compileRevision: value['compileRevision'],
    manifestRevision: value['manifestRevision'],
    previewInstanceId: value['previewInstanceId'],
  }
}

function parseCompileState(value: unknown): TaoStudioDeviceCompileState | undefined {
  if (
    !isObject(value)
    || !nonNegativeInteger(value['compileRevision'])
    || !nonNegativeInteger(value['appliedRevision'])
    || typeof value['message'] !== 'string'
    || typeof value['status'] !== 'string'
    || !compileStatuses.has(value['status'])
  ) {
    return undefined
  }
  return {
    appliedRevision: value['appliedRevision'],
    compileRevision: value['compileRevision'],
    message: value['message'],
    status: value['status'] as TaoStudioDeviceCompileState['status'],
  }
}

function parseManifest(value: unknown): TaoStudioDeviceManifest | undefined {
  if (
    !isObject(value)
    || !nonNegativeInteger(value['compileRevision'])
    || !nonEmptyString(value['manifestRevision'])
    || !Array.isArray(value['scenarios'])
  ) {
    return undefined
  }
  const scenarios: TaoStudioDeviceScenario[] = []
  for (const scenario of value['scenarios']) {
    const viewport = isObject(scenario) ? scenario['viewport'] : undefined
    if (
      !isObject(scenario)
      || !nonEmptyString(scenario['cellId'])
      || !nonNegativeInteger(scenario['cellRevision'])
      || typeof scenario['group'] !== 'string'
      || typeof scenario['label'] !== 'string'
      || !nonEmptyString(scenario['scenarioId'])
      || !isObject(viewport)
      || !positiveInteger(viewport['width'])
      || !positiveInteger(viewport['height'])
    ) {
      return undefined
    }
    scenarios.push({
      cellId: scenario['cellId'],
      cellRevision: scenario['cellRevision'],
      group: scenario['group'],
      label: scenario['label'],
      scenarioId: scenario['scenarioId'],
      viewport: { height: viewport['height'], width: viewport['width'] },
    })
  }
  return { compileRevision: value['compileRevision'], manifestRevision: value['manifestRevision'], scenarios }
}

function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

function isRejectCode(value: unknown): value is TaoStudioDeviceRejectCode {
  return typeof value === 'string' && rejectCodes.has(value)
}

function validPort(value: unknown): value is number {
  return positiveInteger(value) && value <= 65_535
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
