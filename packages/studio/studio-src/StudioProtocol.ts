import { TaoStudioProtocolVersions } from '@runtime/TR-studio-protocol'

export const studioProtocolVersion = TaoStudioProtocolVersions.protocolVersion
export const studioProtocolChannel = TaoStudioProtocolVersions.channel
export const studioSourceActionVersion = TaoStudioProtocolVersions.sourceActionVersion

export type StudioJsonObject = { readonly [key: string]: StudioJsonValue }

export type StudioJsonValue =
  | boolean
  | null
  | number
  | readonly StudioJsonValue[]
  | string
  | StudioJsonObject

/** StudioProjectIdentity keeps one server/session scoped to a specific Tao app in a project. */
export type StudioProjectIdentity = {
  appName: string
  project: string
}

/** StudioSourceIdentity identifies the exact source text a preview or source action observed. */
export type StudioSourceIdentity = {
  path: string
  sourceVersion: string
}

/** StudioSourceOccurrenceIdentity is the compiler-owned semantic precondition for one source occurrence. */
export type StudioSourceOccurrenceIdentity = {
  nodeKind: string
  renderOwner?: string
}

/** StudioPreviewIdentity distinguishes a replaced/reloaded preview from the prior iframe instance. */
export type StudioPreviewIdentity = StudioProjectIdentity & {
  cellId?: string
  cellRevision?: number
  compileRevision?: number
  manifestRevision?: string
  previewInstanceId: string
}

/** StudioPreviewSourceIdentity correlates a rendered node with the exact preview and source text that produced it. */
export type StudioPreviewSourceIdentity = StudioPreviewIdentity & StudioSourceIdentity & {
  occurrence?: StudioSourceOccurrenceIdentity
}

/** StudioSourceActionIdentity adds action-only scenario identity without making source ranges durable IDs. */
export type StudioSourceActionIdentity = StudioPreviewSourceIdentity & {
  scenarioId?: string
}

export type StudioSourceRange = {
  end: number
  start: number
}

/**
 * StudioCanonicalSourceAction is deliberately extensible while source-action kinds are re-landed.
 * Every action is JSON data with a discriminating kind; no executable or hidden visual state crosses the bus.
 */
export type StudioCanonicalSourceAction = StudioJsonObject & {
  kind: string
}

/** StudioSourceActionCheckpoint groups one direct-manipulation gesture into one undoable source operation. */
export type StudioSourceActionCheckpoint = {
  id: string
  phase: 'begin' | 'commit' | 'single' | 'update'
}

/** StudioSourceActionEnvelope is the one canonical, versioned request shape for semantic visual edits. */
export type StudioSourceActionEnvelope = {
  action: StudioCanonicalSourceAction
  channel: typeof studioProtocolChannel
  checkpoint: StudioSourceActionCheckpoint
  identity: StudioSourceActionIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  sourceActionVersion: typeof studioSourceActionVersion
  type: 'source-action'
}

/** StudioSourceActionUndoEnvelope restores the source snapshot captured at a committed checkpoint. */
export type StudioSourceActionUndoEnvelope = {
  channel: typeof studioProtocolChannel
  checkpointId: string
  identity: StudioSourceActionIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  sourceActionVersion: typeof studioSourceActionVersion
  type: 'source-action-undo'
}

export type StudioPreviewAppliedMessage = {
  appliedRevision: number
  channel: typeof studioProtocolChannel
  compileRevision: number
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-applied'
}

/** Parent-to-preview publication of the runtime state paired with one compiled generated module revision. */
export type StudioPreviewRuntimeUpdateMessage<Runtime = StudioJsonObject> = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  runtime: Runtime
  type: 'preview-runtime-update'
}

export type StudioPreviewSourceMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  range: StudioSourceRange
  type: 'preview-hover-source' | 'preview-select-source'
}

export type StudioHighlightSourceMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  range?: StudioSourceRange
  type: 'highlight-source'
}

export type StudioFixtureValue =
  | boolean
  | number
  | string
  | Readonly<{ kind: 'now' }>
  | Readonly<{ handle: string; kind: 'fixture-reference' }>

export type StudioFixturePlan = Readonly<{
  accounts: readonly Readonly<{ fields: Readonly<Record<string, StudioFixtureValue>>; name: string }>[]
  creates: readonly Readonly<{
    entity: string
    fields: Readonly<Record<string, StudioFixtureValue>>
    name: string
  }>[]
}>

export type StudioPreviewFixtureCapturedMessage = {
  channel: typeof studioProtocolChannel
  fixture: StudioFixturePlan
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-fixture-captured'
}

export type StudioPreviewFixtureCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-fixture-capture-failed'
}

/** StudioRuntimeCaptureArtifact mirrors the runtime-owned, JSON-only capture transport. */
export type StudioRuntimeCaptureDomain = Readonly<{
  domain: string
  value: StudioJsonValue
  version: number
}>

export type StudioRuntimeFailureFrame = Readonly<{
  arguments?: StudioJsonValue
  boundary: 'app' | 'item' | 'screen'
  componentStack?: string
  declaration?: string
  source?: Readonly<{ end: number; path: string; start: number }>
}>

export type StudioRuntimeFailure = Readonly<{
  boundaryId: string
  error: Readonly<{ message: string; name: string; stack?: string }>
  frame: StudioRuntimeFailureFrame
  retryEligible: boolean
  stopper: boolean
  timestamp: number
}>

export type StudioRuntimeCaptureArtifact = Readonly<{
  capturedAt: number
  domains: readonly StudioRuntimeCaptureDomain[]
  failure?: StudioRuntimeFailure
  version: 1
}>

export type StudioPreviewRuntimeFailureMessage = {
  capture: StudioRuntimeCaptureArtifact
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-runtime-failure'
}

export type StudioPreviewRuntimeCapturedMessage = {
  capture: StudioRuntimeCaptureArtifact
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-captured'
}

export type StudioPreviewRuntimeCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-capture-failed'
}

export type StudioPreviewLogMessage = {
  arguments: readonly StudioJsonValue[]
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  level: 'debug' | 'error' | 'info' | 'log' | 'warn'
  protocolVersion: typeof studioProtocolVersion
  timestamp: number
  type: 'preview-console'
}

export type StudioPreviewSchemeMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  scheme: Readonly<{
    capability: 'fixed-light-native' | 'reactive-browser'
    requested: 'dark' | 'light' | 'system'
    resolved: 'dark' | 'light'
    source: 'native-fixed' | 'preference' | 'scenario' | 'system'
  }>
  type: 'preview-scheme-changed'
}

export type StudioPreviewLayoutMeasurement = {
  elementName: string
  rect: Readonly<{ height: number; width: number; x: number; y: number }>
  renderId: string
  studioRectId?: string
}

export type StudioPreviewLayoutMeasurementsMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  measurements: readonly StudioPreviewLayoutMeasurement[]
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-layout-measurements'
}

export type StudioWindowMessage =
  | StudioHighlightSourceMessage
  | StudioPreviewAppliedMessage
  | StudioPreviewFixtureCapturedMessage
  | StudioPreviewFixtureCaptureFailedMessage
  | StudioPreviewLogMessage
  | StudioPreviewLayoutMeasurementsMessage
  | StudioPreviewRuntimeCapturedMessage
  | StudioPreviewRuntimeCaptureFailedMessage
  | StudioPreviewRuntimeFailureMessage
  | StudioPreviewSchemeMessage
  | StudioPreviewSourceMessage
  | StudioSourceActionEnvelope
  | StudioSourceActionUndoEnvelope

export type StudioMessageEvent = {
  data: unknown
  origin: string
  source?: unknown
}

export type StudioMessageExpectation = StudioProjectIdentity & {
  origin: string
  previewInstanceId?: string
  source: unknown
}

/** StudioProtocol owns v1 DTO validation at every untrusted transport boundary. */
export const StudioProtocol = {
  messageOrigin,
  parseCanonicalSourceAction,
  parseMessage: parseMessageData,
  parseRuntimeCapture,
  parseSourceActionEnvelope,
  parseSourceActionUndoEnvelope,
  parseWindowMessage,
} as const

/** messageOrigin returns the exact target/check origin to use with window.postMessage. */
function messageOrigin(url: string): string | undefined {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}

/**
 * parseWindowMessage validates the browser-provided origin, optional WindowProxy identity, protocol identity,
 * and the complete message payload. Callers must not inspect event.data before this boundary.
 */
function parseWindowMessage(
  event: StudioMessageEvent,
  expected: StudioMessageExpectation,
): StudioWindowMessage | undefined {
  if (event.origin !== expected.origin || event.source !== expected.source) {
    return undefined
  }
  const message = parseMessageData(event.data)
  if (message === undefined || !matchesProject(message.identity, expected)) {
    return undefined
  }
  if (
    expected.previewInstanceId !== undefined
    && message.identity.previewInstanceId !== expected.previewInstanceId
  ) {
    return undefined
  }
  return message
}

function parseMessageData(value: unknown): StudioWindowMessage | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || value['protocolVersion'] !== studioProtocolVersion
  ) {
    return undefined
  }
  if (value['type'] === 'preview-applied') {
    return parsePreviewApplied(value)
  }
  if (value['type'] === 'preview-hover-source' || value['type'] === 'preview-select-source') {
    return parsePreviewSource(value)
  }
  if (value['type'] === 'highlight-source') {
    return parseHighlightSource(value)
  }
  if (value['type'] === 'preview-fixture-captured') {
    return parsePreviewFixtureCaptured(value)
  }
  if (value['type'] === 'preview-fixture-capture-failed') {
    return parsePreviewFixtureCaptureFailed(value)
  }
  if (value['type'] === 'preview-runtime-failure') {
    return parsePreviewRuntimeFailure(value)
  }
  if (value['type'] === 'preview-runtime-captured') {
    return parsePreviewRuntimeCaptured(value)
  }
  if (value['type'] === 'preview-runtime-capture-failed') {
    return parsePreviewRuntimeCaptureFailed(value)
  }
  if (value['type'] === 'preview-console') {
    return parsePreviewLog(value)
  }
  if (value['type'] === 'preview-scheme-changed') {
    return parsePreviewScheme(value)
  }
  if (value['type'] === 'preview-layout-measurements') {
    return parsePreviewLayoutMeasurements(value)
  }
  if (value['type'] === 'source-action') {
    return parseSourceActionEnvelope(value)
  }
  if (value['type'] === 'source-action-undo') {
    return parseSourceActionUndoEnvelope(value)
  }
  return undefined
}

function parsePreviewLayoutMeasurements(
  value: StudioJsonObject,
): StudioPreviewLayoutMeasurementsMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const rawMeasurements = value['measurements']
  if (identity === undefined || !Array.isArray(rawMeasurements)) {
    return undefined
  }
  const measurements: StudioPreviewLayoutMeasurement[] = []
  const renderIds = new Set<string>()
  for (const raw of rawMeasurements) {
    if (!isObject(raw) || !nonEmptyString(raw['renderId']) || !nonEmptyString(raw['elementName'])) {
      return undefined
    }
    if (raw['studioRectId'] !== undefined && !nonEmptyString(raw['studioRectId'])) {
      return undefined
    }
    const rect = raw['rect']
    if (!isObject(rect)) {
      return undefined
    }
    const coordinates = ['height', 'width', 'x', 'y'] as const
    if (
      coordinates.some(coordinate =>
        typeof rect[coordinate] !== 'number' || !Number.isFinite(rect[coordinate]) || rect[coordinate] < 0
      ) || renderIds.has(raw['renderId'])
    ) {
      return undefined
    }
    renderIds.add(raw['renderId'])
    const height = rect['height'] as number
    const width = rect['width'] as number
    const x = rect['x'] as number
    const y = rect['y'] as number
    measurements.push({
      elementName: raw['elementName'],
      rect: { height, width, x, y },
      renderId: raw['renderId'],
      ...(raw['studioRectId'] === undefined ? {} : { studioRectId: raw['studioRectId'] }),
    })
  }
  return {
    channel: studioProtocolChannel,
    identity,
    measurements,
    protocolVersion: studioProtocolVersion,
    type: 'preview-layout-measurements',
  }
}

function parsePreviewScheme(value: StudioJsonObject): StudioPreviewSchemeMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const scheme = value['scheme']
  if (
    identity === undefined
    || !isObject(scheme)
    || !['fixed-light-native', 'reactive-browser'].includes(String(scheme['capability']))
    || !['dark', 'light', 'system'].includes(String(scheme['requested']))
    || !['dark', 'light'].includes(String(scheme['resolved']))
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(String(scheme['source']))
    || (scheme['source'] === 'system' && scheme['requested'] !== 'system')
    || (scheme['source'] === 'preference' && scheme['requested'] === 'system')
    || (scheme['source'] === 'scenario' && scheme['requested'] === 'system')
    || (scheme['source'] === 'native-fixed' && scheme['capability'] !== 'fixed-light-native')
    || (scheme['capability'] === 'fixed-light-native'
      && (scheme['resolved'] !== 'light' || scheme['source'] !== 'native-fixed'))
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    scheme: {
      capability: scheme['capability'] as StudioPreviewSchemeMessage['scheme']['capability'],
      requested: scheme['requested'] as StudioPreviewSchemeMessage['scheme']['requested'],
      resolved: scheme['resolved'] as StudioPreviewSchemeMessage['scheme']['resolved'],
      source: scheme['source'] as StudioPreviewSchemeMessage['scheme']['source'],
    },
    type: 'preview-scheme-changed',
  }
}

function parsePreviewRuntimeCaptured(value: StudioJsonObject): StudioPreviewRuntimeCapturedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || !nonEmptyString(value['requestId'])) {
    return undefined
  }
  return {
    capture,
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-runtime-captured',
  }
}

function parsePreviewRuntimeCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewRuntimeCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (identity === undefined || !nonEmptyString(value['requestId']) || !nonEmptyString(value['error'])) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    error: value['error'],
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-runtime-capture-failed',
  }
}

function parsePreviewLog(value: StudioJsonObject): StudioPreviewLogMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const timestamp = nonNegativeInteger(value['timestamp'])
  const arguments_ = value['arguments']
  if (
    identity === undefined
    || timestamp === undefined
    || !['debug', 'error', 'info', 'log', 'warn'].includes(String(value['level']))
    || !Array.isArray(arguments_)
    || !arguments_.every(isJsonValue)
  ) {
    return undefined
  }
  return {
    arguments: arguments_,
    channel: studioProtocolChannel,
    identity,
    level: value['level'] as StudioPreviewLogMessage['level'],
    protocolVersion: studioProtocolVersion,
    timestamp,
    type: 'preview-console',
  }
}

function parsePreviewRuntimeFailure(value: StudioJsonObject): StudioPreviewRuntimeFailureMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || capture.failure === undefined) {
    return undefined
  }
  return {
    capture,
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-runtime-failure',
  }
}

function parseRuntimeCapture(value: unknown): StudioRuntimeCaptureArtifact | undefined {
  const capturedAt = isObject(value) ? nonNegativeInteger(value['capturedAt']) : undefined
  if (
    !isObject(value)
    || value['version'] !== 1
    || capturedAt === undefined
    || !Array.isArray(value['domains'])
  ) {
    return undefined
  }
  const domains = value['domains'].map(parseRuntimeCaptureDomain)
  if (!domains.every(isDefined)) {
    return undefined
  }
  const domainNames = domains.map(domain => domain.domain)
  if (new Set(domainNames).size !== domainNames.length) {
    return undefined
  }
  const rawFailure = value['failure']
  const failure = rawFailure === undefined ? undefined : parseRuntimeFailure(rawFailure)
  if (rawFailure !== undefined && failure === undefined) {
    return undefined
  }
  return {
    capturedAt,
    domains,
    ...(failure === undefined ? {} : { failure }),
    version: 1,
  }
}

function parseRuntimeCaptureDomain(value: unknown): StudioRuntimeCaptureDomain | undefined {
  if (!isObject(value) || !nonEmptyString(value['domain']) || !positiveInteger(value['version'])) {
    return undefined
  }
  const domainValue = value['value']
  return isJsonValue(domainValue)
    ? { domain: value['domain'], value: domainValue, version: value['version'] }
    : undefined
}

function parseRuntimeFailure(value: unknown): StudioRuntimeFailure | undefined {
  const timestamp = isObject(value) ? nonNegativeInteger(value['timestamp']) : undefined
  if (
    !isObject(value)
    || !nonEmptyString(value['boundaryId'])
    || typeof value['retryEligible'] !== 'boolean'
    || typeof value['stopper'] !== 'boolean'
    || timestamp === undefined
    || !isObject(value['error'])
    || !nonEmptyString(value['error']['name'])
    || !nonEmptyString(value['error']['message'])
    || !optionalString(value['error']['stack'])
  ) {
    return undefined
  }
  const frame = parseRuntimeFailureFrame(value['frame'])
  if (frame === undefined) {
    return undefined
  }
  return {
    boundaryId: value['boundaryId'],
    error: {
      message: value['error']['message'],
      name: value['error']['name'],
      ...(value['error']['stack'] === undefined ? {} : { stack: value['error']['stack'] }),
    },
    frame,
    retryEligible: value['retryEligible'],
    stopper: value['stopper'],
    timestamp,
  }
}

function parseRuntimeFailureFrame(value: unknown): StudioRuntimeFailureFrame | undefined {
  if (!isObject(value) || !['app', 'item', 'screen'].includes(String(value['boundary']))) {
    return undefined
  }
  if (!optionalString(value['componentStack']) || !optionalString(value['declaration'])) {
    return undefined
  }
  const arguments_ = value['arguments']
  if (arguments_ !== undefined && !isJsonValue(arguments_)) {
    return undefined
  }
  const rawSource = value['source']
  const source = rawSource === undefined ? undefined : parseRuntimeFailureSource(rawSource)
  if (rawSource !== undefined && source === undefined) {
    return undefined
  }
  return {
    ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    boundary: value['boundary'] as StudioRuntimeFailureFrame['boundary'],
    ...(value['componentStack'] === undefined ? {} : { componentStack: value['componentStack'] }),
    ...(value['declaration'] === undefined ? {} : { declaration: value['declaration'] }),
    ...(source === undefined ? {} : { source }),
  }
}

function parseRuntimeFailureSource(value: unknown): { end: number; path: string; start: number } | undefined {
  if (!isObject(value) || !nonEmptyString(value['path'])) {
    return undefined
  }
  const range = parseSourceRange(value)
  return range === undefined ? undefined : { ...range, path: value['path'] }
}

function parsePreviewFixtureCaptured(value: StudioJsonObject): StudioPreviewFixtureCapturedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const fixture = parseFixturePlan(value['fixture'])
  if (identity === undefined || fixture === undefined || !nonEmptyString(value['requestId'])) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    fixture,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-fixture-captured',
  }
}

function parsePreviewFixtureCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewFixtureCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (identity === undefined || !nonEmptyString(value['requestId']) || !nonEmptyString(value['error'])) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    error: value['error'],
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    type: 'preview-fixture-capture-failed',
  }
}

function parseFixturePlan(value: unknown): StudioFixturePlan | undefined {
  if (!isObject(value) || !Array.isArray(value['accounts']) || !Array.isArray(value['creates'])) {
    return undefined
  }
  const accounts = value['accounts'].map(parseFixtureAccount)
  const creates = value['creates'].map(parseFixtureCreate)
  return accounts.every(isDefined) && creates.every(isDefined)
    ? { accounts, creates }
    : undefined
}

function parseFixtureAccount(value: unknown): StudioFixturePlan['accounts'][number] | undefined {
  if (!isObject(value) || !nonEmptyString(value['name'])) {
    return undefined
  }
  const fields = parseFixtureFields(value['fields'])
  return fields === undefined ? undefined : { fields, name: value['name'] }
}

function parseFixtureCreate(value: unknown): StudioFixturePlan['creates'][number] | undefined {
  if (!isObject(value) || !nonEmptyString(value['entity']) || !nonEmptyString(value['name'])) {
    return undefined
  }
  const fields = parseFixtureFields(value['fields'])
  return fields === undefined ? undefined : { entity: value['entity'], fields, name: value['name'] }
}

function parseFixtureFields(value: unknown): Readonly<Record<string, StudioFixtureValue>> | undefined {
  if (!isObject(value) || !Object.values(value).every(isFixtureValue)) {
    return undefined
  }
  return value as Readonly<Record<string, StudioFixtureValue>>
}

function isFixtureValue(value: unknown): value is StudioFixtureValue {
  return typeof value === 'boolean'
    || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)
    || isObject(value) && value['kind'] === 'now' && Object.keys(value).length === 1
    || isObject(value)
      && value['kind'] === 'fixture-reference'
      && nonEmptyString(value['handle'])
      && Object.keys(value).length === 2
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function parsePreviewApplied(value: StudioJsonObject): StudioPreviewAppliedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const compileRevision = nonNegativeInteger(value['compileRevision'])
  const appliedRevision = nonNegativeInteger(value['appliedRevision'])
  if (identity === undefined || compileRevision === undefined || appliedRevision === undefined) {
    return undefined
  }
  if (appliedRevision !== compileRevision) {
    return undefined
  }
  return {
    appliedRevision,
    channel: studioProtocolChannel,
    compileRevision,
    identity,
    protocolVersion: studioProtocolVersion,
    type: 'preview-applied',
  }
}

function parsePreviewSource(value: StudioJsonObject): StudioPreviewSourceMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const range = parseSourceRange(value['range'])
  const type = value['type']
  if (
    identity === undefined
    || range === undefined
    || (type !== 'preview-hover-source' && type !== 'preview-select-source')
  ) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    range,
    type,
  }
}

function parseHighlightSource(value: StudioJsonObject): StudioHighlightSourceMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const rawRange = value['range']
  const range = rawRange === undefined ? undefined : parseSourceRange(rawRange)
  if (identity === undefined || (rawRange !== undefined && range === undefined)) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    identity,
    protocolVersion: studioProtocolVersion,
    range,
    type: 'highlight-source',
  }
}

function parseSourceActionEnvelope(value: unknown): StudioSourceActionEnvelope | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || value['protocolVersion'] !== studioProtocolVersion
    || value['sourceActionVersion'] !== studioSourceActionVersion
    || value['type'] !== 'source-action'
    || !nonEmptyString(value['requestId'])
  ) {
    return undefined
  }
  const identity = parseSourceActionIdentity(value['identity'])
  const action = parseCanonicalSourceAction(value['action'])
  const checkpoint = parseSourceActionCheckpoint(value['checkpoint'])
  if (identity === undefined || action === undefined || checkpoint === undefined) {
    return undefined
  }
  return {
    action,
    channel: studioProtocolChannel,
    checkpoint,
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }
}

function parseSourceActionUndoEnvelope(value: unknown): StudioSourceActionUndoEnvelope | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || !nonEmptyString(value['checkpointId'])
    || value['protocolVersion'] !== studioProtocolVersion
    || !nonEmptyString(value['requestId'])
    || value['sourceActionVersion'] !== studioSourceActionVersion
    || value['type'] !== 'source-action-undo'
  ) {
    return undefined
  }
  const identity = parseSourceActionIdentity(value['identity'])
  if (identity === undefined) {
    return undefined
  }
  return {
    channel: studioProtocolChannel,
    checkpointId: value['checkpointId'],
    identity,
    protocolVersion: studioProtocolVersion,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action-undo',
  }
}

function parseSourceActionCheckpoint(value: unknown): StudioSourceActionCheckpoint | undefined {
  if (!isObject(value) || !nonEmptyString(value['id'])) {
    return undefined
  }
  const phase = value['phase']
  return phase === 'begin' || phase === 'commit' || phase === 'single' || phase === 'update'
    ? { id: value['id'], phase }
    : undefined
}

function parseCanonicalSourceAction(value: unknown): StudioCanonicalSourceAction | undefined {
  return isObject(value) && nonEmptyString(value['kind']) && isJsonValue(value)
    ? value as StudioCanonicalSourceAction
    : undefined
}

function parsePreviewIdentity(value: unknown): StudioPreviewIdentity | undefined {
  if (
    !isObject(value)
    || !nonEmptyString(value['project'])
    || !nonEmptyString(value['appName'])
    || !nonEmptyString(value['previewInstanceId'])
  ) {
    return undefined
  }
  const rawCellIdentity = [
    value['cellId'],
    value['cellRevision'],
    value['compileRevision'],
    value['manifestRevision'],
  ]
  const hasCellIdentity = rawCellIdentity.some(field => field !== undefined)
  const cellRevision = nonNegativeInteger(value['cellRevision'])
  const compileRevision = nonNegativeInteger(value['compileRevision'])
  if (
    hasCellIdentity
    && (
      !nonEmptyString(value['cellId'])
      || cellRevision === undefined
      || compileRevision === undefined
      || !nonEmptyString(value['manifestRevision'])
    )
  ) {
    return undefined
  }
  return {
    appName: value['appName'],
    ...(hasCellIdentity
      ? {
        cellId: value['cellId'] as string,
        cellRevision: cellRevision!,
        compileRevision: compileRevision!,
        manifestRevision: value['manifestRevision'] as string,
      }
      : {}),
    previewInstanceId: value['previewInstanceId'],
    project: value['project'],
  }
}

function parsePreviewSourceIdentity(value: unknown): StudioPreviewSourceIdentity | undefined {
  const preview = parsePreviewIdentity(value)
  const rawOccurrence = isObject(value) ? value['occurrence'] : undefined
  const occurrence = rawOccurrence === undefined ? undefined : parseSourceOccurrenceIdentity(rawOccurrence)
  if (
    preview === undefined
    || !isObject(value)
    || !nonEmptyString(value['path'])
    || !nonEmptyString(value['sourceVersion'])
    || (rawOccurrence !== undefined && occurrence === undefined)
  ) {
    return undefined
  }
  return {
    ...preview,
    ...(occurrence === undefined ? {} : { occurrence }),
    path: value['path'],
    sourceVersion: value['sourceVersion'],
  }
}

function parseSourceActionIdentity(value: unknown): StudioSourceActionIdentity | undefined {
  const source = parsePreviewSourceIdentity(value)
  if (source === undefined || !isObject(value)) {
    return undefined
  }
  const scenarioId = value['scenarioId']
  return scenarioId === undefined
    ? source
    : nonEmptyString(scenarioId)
    ? { ...source, scenarioId }
    : undefined
}

function parseSourceOccurrenceIdentity(value: unknown): StudioSourceOccurrenceIdentity | undefined {
  if (!isObject(value) || !nonEmptyString(value['nodeKind'])) {
    return undefined
  }
  const renderOwner = value['renderOwner']
  return renderOwner === undefined
    ? { nodeKind: value['nodeKind'] }
    : nonEmptyString(renderOwner)
    ? { nodeKind: value['nodeKind'], renderOwner }
    : undefined
}

function parseSourceRange(value: unknown): StudioSourceRange | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const start = nonNegativeInteger(value['start'])
  const end = nonNegativeInteger(value['end'])
  return start !== undefined && end !== undefined && start <= end ? { end, start } : undefined
}

function matchesProject(identity: StudioPreviewIdentity, expected: StudioProjectIdentity): boolean {
  return identity.project === expected.project && identity.appName === expected.appName
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isObject(value: unknown): value is StudioJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown): value is StudioJsonValue {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  return isObject(value) && Object.values(value).every(isJsonValue)
}
