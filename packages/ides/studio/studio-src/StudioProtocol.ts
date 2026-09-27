import type { TaoSchemeCapability } from '@runtime/TR-scheme'
import type { TaoStudioLensCause, TaoStudioLensRenderSample } from '@runtime/TR-studio-lens'
import {
  parseTaoStudioFeedDrop,
  parseTaoStudioFeedDropAtPoint,
  type TaoStudioFeedDrop,
  TaoStudioProtocolVersions,
} from '@runtime/TR-studio-protocol'
import type { StudioDeviceStateEvent } from './device/StudioDeviceStatus'
import type {
  StudioCompileCompletion,
  StudioCompileSnapshot,
  StudioWatchResult,
} from './StudioCompileCoordinator'
import type { StudioPreviewManifestV2 } from './StudioPreviewManifest'
import type { StudioRoute } from './StudioRoutes'
import type { StudioServerInvalidation } from './StudioServerDatasource'
import type {
  studioSketchCatalogFormatVersion,
  StudioSketchCatalogResult,
  StudioSketchCatalogSnapshot,
} from './StudioSketchCatalog'
import type { StudioSketchSnapTree } from './StudioSketchSnap'

/**
 * The capability a browser cell reports: it follows the page's color scheme as it changes. Mirrors
 * `reactiveBrowserSchemeCapability` in packages/apps/runtime/TaoRuntime-src/TR-scheme.ts; a runtime value
 * import here would pull React Native into the packaged Studio service bundle.
 */
export const reactiveBrowserSchemeCapability = 'reactive-browser' satisfies TaoSchemeCapability

/*
 * StudioProtocol is the one wire contract between the Studio server, the browser client, the Tao-side
 * foreign actions, and the preview iframe. Every DTO and event either side sends is declared here
 * once, so a shape only exists in one place and a mismatch fails to typecheck rather than at
 * runtime. `StudioRoutes` owns the addressing — window paths, the route table, and the transport —
 * and is re-exported here so one import still reaches the whole contract.
 */

export const studioProtocolVersion = TaoStudioProtocolVersions.protocolVersion
export const studioProtocolChannel = TaoStudioProtocolVersions.channel
export const studioSourceActionVersion = TaoStudioProtocolVersions.sourceActionVersion

export {
  type StudioJsonPostInit,
  type StudioRoute,
  StudioRoutes,
  studioSessionEndpoints,
  StudioSessionPath,
  StudioTransport,
} from './StudioRoutes'

// ---- Session DTOs

export type StudioProjectFile = {
  diagnosticCount: number
  dirty: boolean
  kind: 'file'
  path: string
  sourceVersion: string
}

export type StudioProjectFileContent = StudioProjectFile & {
  content: string
}

export type StudioAppVariant = Readonly<{
  appName: string
  entryPath: string
}>

export type StudioDraftWriteRequest = {
  content: string
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioDraftWriteResult = {
  compile?: StudioCompileCompletion
  diagnostics: readonly string[]
  file: StudioProjectFileContent
  saved: boolean
}

export type StudioCreateFileRequest = {
  path: string
  writeId: string
}

export type StudioRenameFileRequest = {
  path: string
  sourceVersion: string
  targetPath: string
  writeId: string
}

export type StudioDeleteFileRequest = {
  path: string
  sourceVersion: string
  writeId: string
}

export type StudioMoveGeneratedSourceRequest = {
  path: string
  relocateScenarios?: boolean
  sourceVersion: string
  targetPackage: string
  writeId: string
}

export type StudioCreateFileResult = {
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  files: readonly StudioProjectFile[]
}

export type StudioRenameFileResult = StudioCreateFileResult & {
  previousPath: string
}

export type StudioDeleteFileResult = {
  compile: StudioCompileCompletion
  deleted: StudioProjectFile
  files: readonly StudioProjectFile[]
}

export type StudioMoveGeneratedSourceResult =
  | {
    conflicts: readonly string[]
    name: string
    status: 'confirmation-required'
    targetPackage: string
  }
  | {
    compile: StudioCompileCompletion
    file: StudioProjectFileContent
    files: readonly StudioProjectFile[]
    previousPath: string
    rewritten: readonly StudioProjectFileContent[]
    status: 'moved'
  }

export type StudioCheckpointSummary = {
  afterSourceVersion: string
  beforeSourceVersion: string
  id: string
  path: string
  status: 'committed' | 'open' | 'undone'
}

export type StudioInspectRenderRequest = {
  /** The selecting cell instance; with it the owner's root render is reported with its measured rectangle. */
  identity?: StudioSourceActionIdentity
  path: string
  renderId: string
  sourceVersion: string
}

export type StudioSourceActionResult = {
  checkpoint: {
    id: string
    status: 'committed' | 'open'
  }
  compile: StudioCompileCompletion
  content: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionProposal = {
  content: string
  diff: string
  edits: readonly {
    end: number
    replacement: string
    start: number
  }[]
  path: string
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
}

export type StudioSourceActionUndoResult = {
  checkpoint: {
    id: string
    status: 'undone'
  }
  compile: StudioCompileCompletion
  content: string
  path: string
  requestId: string
  sourceVersion: string
}

export type StudioSketchActionResult =
  & StudioSketchCatalogResult
  & Readonly<{
    compile?: StudioCompileCompletion
    generatedFile?: StudioProjectFileContent
  }>

export type StudioSketchSnapRequest = Readonly<{
  checkpointId: string
  confirmedProposalVersion?: string
  expectedCatalogRevision: number
  rectIds: readonly string[]
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchUnsnapRequest = Readonly<
  Omit<StudioSketchSnapRequest, 'confirmedProposalVersion'>
>

export type StudioSketchFlowAction =
  | Readonly<{ kind: 'toggle-direction'; rectId: string }>
  | Readonly<{ afterRectId: string; beforeRectId?: string; kind: 'insert-separator' }>
  | Readonly<{
    afterRectId: string
    beforeRectId: string
    kind: 'insert-spacer'
    ratio: readonly [number, number]
  }>

/** Browser-safe flow intent; render identities remain a server/catalog implementation detail. */
export type StudioSketchFlowActionRequest = Readonly<{
  action: StudioSketchFlowAction
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sketchId: string
  sourceVersion: string
}>

export type StudioSketchSnapProposalResult = Readonly<{
  content: string
  diff: string
  needsConfirmation: boolean
  path: string
  projectedRectIds: readonly string[]
  proposedSourceVersion: string
  requestId: string
  sourceVersion: string
  tree: StudioSketchSnapTree
}>

export type StudioSketchSnapApplyResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'committed' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  projectedRectIds: readonly string[]
  requestId: string
}>

export type StudioSketchSnapUndoRequest = Readonly<{
  checkpointId: string
  expectedCatalogRevision: number
  requestId: string
  sourceVersion: string
}>

export type StudioSketchSnapUndoResult = Readonly<{
  catalog: StudioSketchCatalogSnapshot
  checkpoint: { id: string; status: 'undone' }
  compile: StudioCompileCompletion
  file: StudioProjectFileContent
  requestId: string
}>

/** The first message on the session event socket, and the body of `GET /api/protocol`. */
export type StudioCanvasViewport = Readonly<{ x: number; y: number; z: number }>

export type StudioCanvasViewportSaveRequest = Readonly<{
  clientId: string
  sequence: number
  viewport: StudioCanvasViewport
}>

export type StudioSessionHandshake = {
  apps: readonly StudioAppVariant[]
  capabilities: {
    drafts: 'disk-synced-parsable'
    language: readonly string[]
    sourceActions: {
      canonicalEnvelope: true
      checkpoints: true
      proposals: true
      undo: true
      version: typeof studioSourceActionVersion
    }
    matrix: {
      concurrentCells: true
      scheme: 'reactive-browser-fixed-light-native'
      version: 2
    }
    sketches: {
      catalogVersion: typeof studioSketchCatalogFormatVersion
      freeGeometry: true
    }
  }
  channel: typeof studioProtocolChannel
  compile: StudioCompileSnapshot
  endpoints: readonly StudioRoute[]
  entryPath: string
  files: readonly StudioProjectFile[]
  identity: StudioProjectIdentity
  previewManifest?: StudioPreviewManifestV2
  sketchCatalog: StudioSketchCatalogSnapshot
  canvasViewport?: StudioCanvasViewport
  protocolVersion: typeof studioProtocolVersion
  type: 'handshake'
}

/** Events one project session publishes; the server relays each to that session's event sockets. */
export type StudioSessionEvent =
  | {
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    state: StudioCompileSnapshot
    type: 'compile-state'
  }
  | {
    channel: typeof studioProtocolChannel
    file: StudioProjectFile
    protocolVersion: typeof studioProtocolVersion
    type: 'file-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    files: readonly StudioProjectFile[]
    protocolVersion: typeof studioProtocolVersion
    type: 'files-changed'
  }
  | {
    acknowledgements: StudioWatchResult['acknowledgements']
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'studio-writes-acknowledged'
  }
  | {
    channel: typeof studioProtocolChannel
    manifest: StudioPreviewManifestV2
    protocolVersion: typeof studioProtocolVersion
    type: 'preview-manifest-changed'
  }
  | {
    channel: typeof studioProtocolChannel
    checkpoint: Pick<StudioCheckpointSummary, 'id' | 'status'>
    protocolVersion: typeof studioProtocolVersion
    type: 'checkpoint-changed'
  }
  | {
    catalog: StudioSketchCatalogSnapshot
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'sketch-catalog-changed'
  }
  /**
   * One cell was reconfigured — new arguments, environment, state layers, or a replayed capture.
   * Reconfiguring invalidates every live instance of that cell, so a canvas rendering it holds an
   * instance the session will refuse from that moment on. The browser learns this by driving the
   * reconfigure itself; anything else rendering the same cell has to be told.
   */
  | {
    cellId: string
    channel: typeof studioProtocolChannel
    protocolVersion: typeof studioProtocolVersion
    type: 'cell-reconfigured'
  }

/** The server-side datasource's query families went stale; Tao panels mirroring them refetch. */
export type StudioDataInvalidatedEvent = StudioServerInvalidation & { type: 'data-invalidated' }

/** Everything the session event socket sends after its handshake. */
export type StudioSessionSocketEvent = StudioDataInvalidatedEvent | StudioDeviceStateEvent | StudioSessionEvent

// ---- Preview protocol

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
type StudioSourceOccurrenceIdentity = {
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
  /** A shift-click adds the element to the selection instead of replacing it. */
  additive?: true
  channel: typeof studioProtocolChannel
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  range: StudioSourceRange
  type: 'preview-hover-source' | 'preview-select-source'
}

export type StudioFeedDropAtPointMessage = {
  channel: typeof studioProtocolChannel
  clientX: number
  clientY: number
  drop: TaoStudioFeedDrop
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'feed-drop-at-point'
}

export type StudioPreviewFeedDropMessage = {
  channel: typeof studioProtocolChannel
  drop: TaoStudioFeedDrop
  identity: StudioPreviewSourceIdentity
  protocolVersion: typeof studioProtocolVersion
  renderId: string
  studioRectId?: string
  type: 'preview-feed-drop'
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
  signedIn?: string
  accounts: readonly Readonly<{ fields: Readonly<Record<string, StudioFixtureValue>>; name: string }>[]
  creates: readonly Readonly<{
    account?: string
    entity: string
    fields: Readonly<Record<string, StudioFixtureValue>>
    name: string
  }>[]
}>

type StudioPreviewFixtureCapturedMessage = {
  channel: typeof studioProtocolChannel
  fixture: StudioFixturePlan
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-fixture-captured'
}

type StudioPreviewFixtureCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  errorName: StudioRuntimeCaptureErrorName
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

type StudioPreviewRuntimeCapturedMessage = {
  capture: StudioRuntimeCaptureArtifact
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-captured'
}

type StudioRuntimeCaptureErrorName =
  | 'HostEnvironmentError'
  | 'UnexpectedBehaviorError'
  | 'UserInputError'

type StudioPreviewRuntimeCaptureFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  errorName: StudioRuntimeCaptureErrorName
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  requestId: string
  type: 'preview-runtime-capture-failed'
}

type StudioPreviewLogMessage = {
  arguments: readonly StudioJsonValue[]
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  level: 'debug' | 'error' | 'info' | 'log' | 'warn'
  protocolVersion: typeof studioProtocolVersion
  timestamp: number
  type: 'preview-console'
}

export type StudioLensRenderSample = TaoStudioLensRenderSample & Readonly<{ sourceVersion: string }>

type StudioPreviewLensRenderMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  sample: StudioLensRenderSample
  type: 'preview-lens-render'
}

/** StudioDebugCommandMessage drives the preview's debugger: breakpoints, continue, and stepping. */
type StudioDebugStep = {
  action: string
  declaration?: string
  path: string
  statement?: string
}

export type StudioDebugCommandMessage = {
  actions?: readonly string[]
  channel: typeof studioProtocolChannel
  command: 'break' | 'configure' | 'continue' | 'step-over' | 'step-into' | 'step-out'
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  steps?: readonly StudioDebugStep[]
  type: 'debug-command'
}

/** StudioPreviewDebugMessage carries one debugger event: a journal entry, a pause, or a resume. */
type StudioPreviewDebugMessage = {
  channel: typeof studioProtocolChannel
  event: StudioJsonValue
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-debug'
}

type StudioPreviewSchemeMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  scheme: Readonly<{
    capability: 'fixed-light-native' | 'pinned-native' | 'reactive-catalyst' | typeof reactiveBrowserSchemeCapability
    requested: 'dark' | 'light' | 'system'
    resolved: 'dark' | 'light'
    source: 'native-fixed' | 'preference' | 'scenario' | 'system'
  }>
  type: 'preview-scheme-changed'
}

export type StudioPreviewLayoutMeasurement = {
  /** Geometry in the iframe viewport, which changes when an app scrolls. */
  viewportRect?: Readonly<{ height: number; width: number; x: number; y: number }>
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

/** Wheel gestures inside a cross-origin preview iframe are forwarded to the surrounding Design canvas. */
export type StudioPreviewCanvasGestureMessage = {
  channel: typeof studioProtocolChannel
  clientX: number
  clientY: number
  deltaX: number
  deltaY: number
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-canvas-gesture'
  zoom: boolean
}

/** Space held inside a preview gives the Design canvas ownership of the next drag. */
export type StudioPreviewCanvasPanKeyMessage = {
  channel: typeof studioProtocolChannel
  held: boolean
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-canvas-pan-key'
}

/**
 * Canvas commands: zoom, ⌘G making a view of the selection, ⌥⌘G grouping it in place, and ⌘Z walking
 * back the latest visual edit.
 */
export type StudioCanvasShortcutCommand = 'fit' | 'group' | 'make-view' | 'reset' | 'undo' | 'zoom-in' | 'zoom-out'

/** The canvas commands the viewport itself answers. */
export type StudioCanvasZoomCommand = Exclude<StudioCanvasShortcutCommand, 'group' | 'make-view' | 'undo'>

const canvasShortcutCommands: ReadonlySet<string> = new Set<StudioCanvasShortcutCommand>([
  'fit',
  'group',
  'make-view',
  'reset',
  'undo',
  'zoom-in',
  'zoom-out',
])

/** Canvas commands from an authenticated focused preview. */
export type StudioPreviewCanvasShortcutMessage = {
  channel: typeof studioProtocolChannel
  command: StudioCanvasShortcutCommand
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-canvas-shortcut'
}

/** Parent-owned mode state tells a preview synchronously whether its canvas gestures belong to Canvas. */
type StudioCanvasGestureOwnershipMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  owned: boolean
  protocolVersion: typeof studioProtocolVersion
  type: 'set-canvas-gestures'
}

type StudioRecordedJourneySelector = 'label' | 'placeholder' | 'tag' | 'text'

export type StudioRecordedJourneyStep =
  | Readonly<{
    kind: 'press' | 'submit'
    selector: StudioRecordedJourneySelector
    target: string
  }>
  | Readonly<{
    kind: 'enter'
    redacted: boolean
    selector: StudioRecordedJourneySelector
    target: string
    value: string
  }>
  | Readonly<{
    action: 'enter' | 'press' | 'submit'
    kind: 'unresolved'
    reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.'
  }>

/** Exact-cell command for starting or stopping a browser-local semantic journey recording. */
export type StudioJourneyRecordingControlMessage = {
  active: boolean
  captureSensitiveText?: boolean
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  type: 'set-journey-recording'
}

export type StudioPreviewJourneyStepRecordedMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  sequence: number
  step: StudioRecordedJourneyStep
  type: 'preview-journey-step-recorded'
}

export type StudioPreviewJourneyRecordingStateMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  recordingId: string
  sequence: number
  status: 'invalidated' | 'recording' | 'stopped'
  type: 'preview-journey-recording-state'
}

/** Runtime-owned completion signals keep visual review from capturing before a journey settles. */
type StudioPreviewJourneyReplaySettledMessage = {
  channel: typeof studioProtocolChannel
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-journey-replay-settled'
}

type StudioPreviewJourneyReplayFailedMessage = {
  channel: typeof studioProtocolChannel
  error: string
  identity: StudioPreviewIdentity
  protocolVersion: typeof studioProtocolVersion
  type: 'preview-journey-replay-failed'
}

export type StudioWindowMessage =
  | StudioHighlightSourceMessage
  | StudioCanvasGestureOwnershipMessage
  | StudioJourneyRecordingControlMessage
  | StudioPreviewAppliedMessage
  | StudioPreviewFixtureCapturedMessage
  | StudioPreviewFixtureCaptureFailedMessage
  | StudioPreviewLogMessage
  | StudioPreviewDebugMessage
  | StudioPreviewCanvasGestureMessage
  | StudioPreviewCanvasPanKeyMessage
  | StudioPreviewCanvasShortcutMessage
  | StudioFeedDropAtPointMessage
  | StudioPreviewFeedDropMessage
  | StudioDebugCommandMessage
  | StudioPreviewLayoutMeasurementsMessage
  | StudioPreviewLensRenderMessage
  | StudioPreviewJourneyRecordingStateMessage
  | StudioPreviewJourneyReplayFailedMessage
  | StudioPreviewJourneyReplaySettledMessage
  | StudioPreviewJourneyStepRecordedMessage
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
  parseSourceActionIdentity,
  parseSourceActionUndoEnvelope,
  parseWindowMessage,
} as const

/**
 * Every window message carries the same channel and protocol version. A parser validates and returns
 * only the fields its own message owns; `envelope` stamps the two the transport owns, so neither is
 * spelled again per message and neither can be forgotten.
 */
function envelope<FieldsT extends { type: StudioWindowMessage['type'] }>(
  fields: FieldsT,
): FieldsT & { channel: typeof studioProtocolChannel; protocolVersion: typeof studioProtocolVersion } {
  return { ...fields, channel: studioProtocolChannel, protocolVersion: studioProtocolVersion }
}

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

/**
 * One parser per window message, keyed by the message's own `type`. Adding a member to
 * `StudioWindowMessage` without a parser here fails to compile, so no message can reach a receiver
 * unvalidated.
 */
const windowMessageParsers: {
  [TypeT in StudioWindowMessage['type']]: (value: StudioJsonObject) => StudioWindowMessage | undefined
} = {
  'debug-command': parseDebugCommand,
  'feed-drop-at-point': parseFeedDropAtPoint,
  'highlight-source': parseHighlightSource,
  'preview-applied': parsePreviewApplied,
  'preview-canvas-gesture': parsePreviewCanvasGesture,
  'preview-canvas-pan-key': parsePreviewCanvasPanKey,
  'preview-canvas-shortcut': parsePreviewCanvasShortcut,
  'preview-console': parsePreviewLog,
  'preview-debug': parsePreviewDebug,
  'preview-feed-drop': parsePreviewFeedDrop,
  'preview-fixture-capture-failed': parsePreviewFixtureCaptureFailed,
  'preview-fixture-captured': parsePreviewFixtureCaptured,
  'preview-hover-source': parsePreviewSource,
  'preview-journey-recording-state': parsePreviewJourneyRecordingState,
  'preview-journey-replay-failed': parsePreviewJourneyReplayFailed,
  'preview-journey-replay-settled': parsePreviewJourneyReplaySettled,
  'preview-journey-step-recorded': parsePreviewJourneyStepRecorded,
  'preview-lens-render': parsePreviewLensRender,
  'preview-layout-measurements': parsePreviewLayoutMeasurements,
  'preview-runtime-capture-failed': parsePreviewRuntimeCaptureFailed,
  'preview-runtime-captured': parsePreviewRuntimeCaptured,
  'preview-runtime-failure': parsePreviewRuntimeFailure,
  'preview-scheme-changed': parsePreviewScheme,
  'preview-select-source': parsePreviewSource,
  'set-canvas-gestures': parseCanvasGestureOwnership,
  'set-journey-recording': parseJourneyRecordingControl,
  'source-action': parseSourceActionEnvelope,
  'source-action-undo': parseSourceActionUndoEnvelope,
}

function parseMessageData(value: unknown): StudioWindowMessage | undefined {
  if (
    !isObject(value)
    || value['channel'] !== studioProtocolChannel
    || value['protocolVersion'] !== studioProtocolVersion
  ) {
    return undefined
  }
  const type = value['type']
  // Own keys only: the type comes from another window, and `constructor` must not resolve to `Object`.
  if (typeof type !== 'string' || !Object.hasOwn(windowMessageParsers, type)) {
    return undefined
  }
  const parse = windowMessageParsers[type as StudioWindowMessage['type']] as (
    candidate: StudioJsonObject,
  ) => StudioWindowMessage | undefined
  return parse(value)
}

function parseJourneyRecordingControl(value: StudioJsonObject): StudioJourneyRecordingControlMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (
    identity === undefined
    || identity.cellId === undefined
    || typeof value['active'] !== 'boolean'
    || !boundedText(value['recordingId'], 256)
    || (value['captureSensitiveText'] !== undefined && typeof value['captureSensitiveText'] !== 'boolean')
  ) {
    return undefined
  }
  return envelope({
    active: value['active'],
    ...(value['captureSensitiveText'] === undefined
      ? {}
      : { captureSensitiveText: value['captureSensitiveText'] as boolean }),
    identity,
    recordingId: value['recordingId'],
    type: 'set-journey-recording',
  })
}

function parsePreviewJourneyStepRecorded(
  value: StudioJsonObject,
): StudioPreviewJourneyStepRecordedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const sequence = nonNegativeInteger(value['sequence'])
  const step = parseRecordedJourneyStep(value['step'])
  if (
    identity === undefined || identity.cellId === undefined || sequence === undefined || sequence === 0
    || step === undefined
    || !boundedText(value['recordingId'], 256)
  ) {
    return undefined
  }
  return envelope({
    identity,
    recordingId: value['recordingId'],
    sequence,
    step,
    type: 'preview-journey-step-recorded',
  })
}

function parsePreviewJourneyRecordingState(
  value: StudioJsonObject,
): StudioPreviewJourneyRecordingStateMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const sequence = nonNegativeInteger(value['sequence'])
  const status = journeyRecordingStatus(value['status'])
  if (
    identity === undefined
    || identity.cellId === undefined
    || sequence === undefined
    || status === undefined
    || !boundedText(value['recordingId'], 256)
  ) {
    return undefined
  }
  return envelope({
    identity,
    recordingId: value['recordingId'],
    sequence,
    status,
    type: 'preview-journey-recording-state',
  })
}

function journeyRecordingStatus(
  value: unknown,
): StudioPreviewJourneyRecordingStateMessage['status'] | undefined {
  return value === 'invalidated' || value === 'recording' || value === 'stopped' ? value : undefined
}

function parsePreviewJourneyReplaySettled(
  value: StudioJsonObject,
): StudioPreviewJourneyReplaySettledMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity?.cellId === undefined
    ? undefined
    : envelope({
      identity,
      type: 'preview-journey-replay-settled',
    })
}

function parsePreviewJourneyReplayFailed(
  value: StudioJsonObject,
): StudioPreviewJourneyReplayFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity?.cellId === undefined || !boundedText(value['error'], 4_096)
    ? undefined
    : envelope({
      error: value['error'],
      identity,
      type: 'preview-journey-replay-failed',
    })
}

function parseRecordedJourneyStep(value: unknown): StudioRecordedJourneyStep | undefined {
  if (!isObject(value)) {
    return undefined
  }
  if (value['kind'] === 'unresolved') {
    const action = value['action']
    const reason = value['reason']
    return (action === 'enter' || action === 'press' || action === 'submit')
        && reason === 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.'
        && Object.keys(value).length === 3
      ? { action, kind: 'unresolved', reason }
      : undefined
  }
  if (!boundedText(value['target'], 1_024)) {
    return undefined
  }
  const selector = value['selector']
  if (selector !== 'label' && selector !== 'placeholder' && selector !== 'tag' && selector !== 'text') {
    return undefined
  }
  if (value['kind'] === 'press' || value['kind'] === 'submit') {
    return Object.keys(value).length === 3
      ? { kind: value['kind'], selector, target: value['target'] }
      : undefined
  }
  return value['kind'] === 'enter'
      && typeof value['value'] === 'string'
      && value['value'].length <= 16_384
      && typeof value['redacted'] === 'boolean'
      && Object.keys(value).length === 5
    ? { kind: 'enter', redacted: value['redacted'], selector, target: value['target'], value: value['value'] }
    : undefined
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
        typeof rect[coordinate] !== 'number' || !Number.isFinite(rect[coordinate])
        || ((coordinate === 'height' || coordinate === 'width') && rect[coordinate] < 0)
      ) || renderIds.has(raw['renderId'])
    ) {
      return undefined
    }
    const viewportRect = raw['viewportRect']
    if (
      viewportRect !== undefined
      && (!isObject(viewportRect)
        || coordinates.some(coordinate =>
          typeof viewportRect[coordinate] !== 'number' || !Number.isFinite(viewportRect[coordinate])
          || ((coordinate === 'width' || coordinate === 'height') && viewportRect[coordinate] < 0)
        ))
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
      ...(viewportRect === undefined
        ? {}
        : { viewportRect: viewportRect as NonNullable<StudioPreviewLayoutMeasurement['viewportRect']> }),
      renderId: raw['renderId'],
      ...(raw['studioRectId'] === undefined ? {} : { studioRectId: raw['studioRectId'] }),
    })
  }
  return envelope({
    identity,
    measurements,
    type: 'preview-layout-measurements',
  })
}

function parsePreviewCanvasGesture(value: StudioJsonObject): StudioPreviewCanvasGestureMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const numbers = ['clientX', 'clientY', 'deltaX', 'deltaY'] as const
  if (
    identity === undefined
    || numbers.some(name => typeof value[name] !== 'number' || !Number.isFinite(value[name]))
    || typeof value['zoom'] !== 'boolean'
  ) {
    return undefined
  }
  return envelope({
    clientX: value['clientX'] as number,
    clientY: value['clientY'] as number,
    deltaX: value['deltaX'] as number,
    deltaY: value['deltaY'] as number,
    identity,
    type: 'preview-canvas-gesture',
    zoom: value['zoom'],
  })
}

function parsePreviewCanvasPanKey(value: StudioJsonObject): StudioPreviewCanvasPanKeyMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity === undefined || typeof value['held'] !== 'boolean'
    ? undefined
    : envelope({ held: value['held'], identity, type: 'preview-canvas-pan-key' })
}

function parsePreviewCanvasShortcut(value: StudioJsonObject): StudioPreviewCanvasShortcutMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const command = value['command']
  return identity === undefined || typeof command !== 'string' || !canvasShortcutCommands.has(command)
    ? undefined
    : envelope({
      command: command as StudioPreviewCanvasShortcutMessage['command'],
      identity,
      type: 'preview-canvas-shortcut',
    })
}

function parseCanvasGestureOwnership(value: StudioJsonObject): StudioCanvasGestureOwnershipMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  return identity === undefined || typeof value['owned'] !== 'boolean'
    ? undefined
    : envelope({
      identity,
      owned: value['owned'],
      type: 'set-canvas-gestures',
    })
}

function parsePreviewScheme(value: StudioJsonObject): StudioPreviewSchemeMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const scheme = value['scheme']
  if (
    identity === undefined
    || !isObject(scheme)
    || !['fixed-light-native', 'pinned-native', 'reactive-catalyst', reactiveBrowserSchemeCapability].includes(
      String(scheme['capability']),
    )
    || !['dark', 'light', 'system'].includes(String(scheme['requested']))
    || !['dark', 'light'].includes(String(scheme['resolved']))
    || !['native-fixed', 'preference', 'scenario', 'system'].includes(String(scheme['source']))
    || (scheme['source'] === 'system' && scheme['requested'] !== 'system')
    || (scheme['source'] === 'preference' && scheme['requested'] === 'system')
    || (scheme['source'] === 'scenario' && scheme['requested'] === 'system')
    || (scheme['source'] === 'native-fixed' && scheme['capability'] !== 'fixed-light-native')
    || (scheme['capability'] === 'fixed-light-native'
      && (scheme['resolved'] !== 'light' || scheme['source'] !== 'native-fixed'))
    || (scheme['capability'] === 'pinned-native'
      && (scheme['source'] !== 'scenario' || scheme['resolved'] !== scheme['requested']))
  ) {
    return undefined
  }
  return envelope({
    identity,
    scheme: {
      capability: scheme['capability'] as StudioPreviewSchemeMessage['scheme']['capability'],
      requested: scheme['requested'] as StudioPreviewSchemeMessage['scheme']['requested'],
      resolved: scheme['resolved'] as StudioPreviewSchemeMessage['scheme']['resolved'],
      source: scheme['source'] as StudioPreviewSchemeMessage['scheme']['source'],
    },
    type: 'preview-scheme-changed',
  })
}

function parsePreviewRuntimeCaptured(value: StudioJsonObject): StudioPreviewRuntimeCapturedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || !nonEmptyString(value['requestId'])) {
    return undefined
  }
  return envelope({
    capture,
    identity,
    requestId: value['requestId'],
    type: 'preview-runtime-captured',
  })
}

function parsePreviewRuntimeCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewRuntimeCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (
    identity === undefined
    || !nonEmptyString(value['requestId'])
    || !nonEmptyString(value['error'])
    || !runtimeCaptureErrorName(value['errorName'])
  ) {
    return undefined
  }
  return envelope({
    error: value['error'],
    errorName: value['errorName'],
    identity,
    requestId: value['requestId'],
    type: 'preview-runtime-capture-failed',
  })
}

function runtimeCaptureErrorName(value: unknown): value is StudioRuntimeCaptureErrorName {
  return value === 'HostEnvironmentError' || value === 'UnexpectedBehaviorError' || value === 'UserInputError'
}

const debugCommands = ['break', 'configure', 'continue', 'step-over', 'step-into', 'step-out'] as const

function parseDebugCommand(value: StudioJsonObject): StudioDebugCommandMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const command = debugCommands.find(candidate => candidate === value['command'])
  if (identity === undefined || command === undefined) {
    return undefined
  }
  const steps = value['steps']
  const actions = value['actions']
  if (
    (steps !== undefined && (!Array.isArray(steps) || !steps.every(isDebugStep)))
    || (actions !== undefined && (!Array.isArray(actions) || !actions.every(entry => typeof entry === 'string')))
  ) {
    return undefined
  }
  return envelope({
    ...(actions === undefined ? {} : { actions: actions as readonly string[] }),
    command,
    identity,
    ...(steps === undefined ? {} : { steps: steps as readonly StudioDebugStep[] }),
    type: 'debug-command',
  })
}

function isDebugStep(value: unknown): value is StudioDebugStep {
  if (!isObject(value) || typeof value['action'] !== 'string' || typeof value['path'] !== 'string') {
    return false
  }
  const declaration = value['declaration']
  const statement = value['statement']
  return (declaration === undefined && statement === undefined)
    || (typeof declaration === 'string' && typeof statement === 'string')
}

function parsePreviewDebug(value: StudioJsonObject): StudioPreviewDebugMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const event = value['event']
  if (identity === undefined || !isJsonValue(event)) {
    return undefined
  }
  return envelope({
    event,
    identity,
    type: 'preview-debug',
  })
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
  return envelope({
    arguments: arguments_,
    identity,
    level: value['level'] as StudioPreviewLogMessage['level'],
    timestamp,
    type: 'preview-console',
  })
}

function parsePreviewLensRender(value: StudioJsonObject): StudioPreviewLensRenderMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const raw = value['sample']
  if (identity === undefined || !isObject(raw) || !isObject(raw['identity'])) {
    return undefined
  }
  const source = raw['identity']
  const start = nonNegativeInteger(source['start'])
  const end = nonNegativeInteger(source['end'])
  const timestamp = nonNegativeInteger(raw['timestamp'])
  const causes = raw['causes']
  if (
    start === undefined || end === undefined || start > end || timestamp === undefined
    || source['kind'] !== 'render'
    || !boundedText(source['sourcePath'], 4_096)
    || !optionalBoundedText(source['elementName'], 256)
    || !optionalBoundedText(source['ownerName'], 256)
    || !optionalBoundedText(source['studioRectId'], 256)
    || !boundedText(raw['sourceVersion'], 256)
    || !boundedText(raw['instanceId'], 256)
    || (raw['phase'] !== 'mount' && raw['phase'] !== 'update')
    || !boundedDuration(raw['actualDurationMs'])
    || !Array.isArray(causes) || causes.length > 8
  ) {
    return undefined
  }
  const parsedCauses = causes.map(parseLensCause)
  if (parsedCauses.some(cause => cause === undefined)) {
    return undefined
  }
  const resolvedStyle = parseLensResolvedStyle(raw['resolvedStyle'])
  if (raw['resolvedStyle'] !== undefined && resolvedStyle === undefined) {
    return undefined
  }
  return envelope({
    identity,
    sample: {
      actualDurationMs: raw['actualDurationMs'],
      causes: parsedCauses as TaoStudioLensCause[],
      identity: {
        ...(source['elementName'] === undefined ? {} : { elementName: source['elementName'] as string }),
        end,
        kind: 'render' as const,
        ...(source['ownerName'] === undefined ? {} : { ownerName: source['ownerName'] as string }),
        sourcePath: source['sourcePath'],
        start,
        ...(source['studioRectId'] === undefined ? {} : { studioRectId: source['studioRectId'] as string }),
      },
      instanceId: raw['instanceId'],
      phase: raw['phase'] as 'mount' | 'update',
      ...(resolvedStyle === undefined ? {} : { resolvedStyle }),
      sourceVersion: raw['sourceVersion'],
      timestamp,
    },
    type: 'preview-lens-render',
  })
}

const lensStyleProperties = new Set([
  'background-color',
  'border-radius',
  'color',
  'display',
  'flex-direction',
  'font-size',
  'font-weight',
  'gap',
  'line-height',
  'opacity',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
])

function parseLensResolvedStyle(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isObject(value)) {
    return undefined
  }
  const entries = Object.entries(value)
  if (
    entries.length > lensStyleProperties.size
    || entries.some(([key, item]) =>
      !lensStyleProperties.has(key) || typeof item !== 'string' || item.length === 0 || item.length > 128
    )
  ) {
    return undefined
  }
  return Object.fromEntries(entries) as Readonly<Record<string, string>>
}

function parseLensCause(value: unknown): TaoStudioLensCause | undefined {
  if (!isObject(value)) {
    return undefined
  }
  if (value['kind'] === 'state') {
    return { kind: 'state' }
  }
  if (
    value['kind'] !== 'data'
    || !boundedText(value['schema'], 256)
    || !boundedText(value['entity'], 256)
    || (value['providerWaitMs'] !== undefined && !boundedDuration(value['providerWaitMs']))
  ) {
    return undefined
  }
  return {
    entity: value['entity'],
    kind: 'data',
    ...(value['providerWaitMs'] === undefined ? {} : { providerWaitMs: value['providerWaitMs'] as number }),
    schema: value['schema'],
  }
}

function boundedDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 300_000
}

function optionalBoundedText(value: unknown, maximumLength: number): value is string | undefined {
  return value === undefined || boundedText(value, maximumLength)
}

function parsePreviewRuntimeFailure(value: StudioJsonObject): StudioPreviewRuntimeFailureMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const capture = parseRuntimeCapture(value['capture'])
  if (identity === undefined || capture === undefined || capture.failure === undefined) {
    return undefined
  }
  return envelope({
    capture,
    identity,
    type: 'preview-runtime-failure',
  })
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
  return envelope({
    fixture,
    identity,
    requestId: value['requestId'],
    type: 'preview-fixture-captured',
  })
}

function parsePreviewFixtureCaptureFailed(
  value: StudioJsonObject,
): StudioPreviewFixtureCaptureFailedMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  if (identity === undefined || !nonEmptyString(value['requestId']) || !nonEmptyString(value['error'])) {
    return undefined
  }
  return envelope({
    error: value['error'],
    // A preview running older code sends no category. Defaulting keeps its failure readable instead
    // of rejecting the whole message, and matches how such a failure was reported before.
    errorName: runtimeCaptureErrorName(value['errorName']) ? value['errorName'] : 'HostEnvironmentError',
    identity,
    requestId: value['requestId'],
    type: 'preview-fixture-capture-failed',
  })
}

function parseFixturePlan(value: unknown): StudioFixturePlan | undefined {
  if (!isObject(value) || !Array.isArray(value['accounts']) || !Array.isArray(value['creates'])) {
    return undefined
  }
  const accounts = value['accounts'].map(parseFixtureAccount)
  const creates = value['creates'].map(parseFixtureCreate)
  if (value['signedIn'] !== undefined && !nonEmptyString(value['signedIn'])) {
    return undefined
  }
  return accounts.every(isDefined) && creates.every(isDefined)
    ? { accounts, creates, ...(value['signedIn'] === undefined ? {} : { signedIn: value['signedIn'] as string }) }
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
  if (value['account'] !== undefined && !nonEmptyString(value['account'])) {
    return undefined
  }
  return fields === undefined ? undefined : {
    entity: value['entity'],
    fields,
    name: value['name'],
    ...(value['account'] === undefined ? {} : { account: value['account'] as string }),
  }
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
  return envelope({
    appliedRevision,
    compileRevision,
    identity,
    type: 'preview-applied',
  })
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
  return envelope({
    ...(value['additive'] === true && type === 'preview-select-source' ? { additive: true as const } : {}),
    identity,
    range,
    type,
  })
}

function parseFeedDropAtPoint(value: StudioJsonObject): StudioFeedDropAtPointMessage | undefined {
  const identity = parsePreviewIdentity(value['identity'])
  const point = parseTaoStudioFeedDropAtPoint(value)
  return identity === undefined || point === undefined
    ? undefined
    : envelope({ ...point, identity, type: 'feed-drop-at-point' })
}

function parsePreviewFeedDrop(value: StudioJsonObject): StudioPreviewFeedDropMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const drop = parseTaoStudioFeedDrop(value['drop'])
  const renderId = value['renderId']
  const studioRectId = value['studioRectId']
  if (
    identity === undefined || drop === undefined || !nonEmptyString(renderId)
    || (studioRectId !== undefined && !nonEmptyString(studioRectId))
  ) {
    return undefined
  }
  const range = renderId.slice(identity.path.length + 1).split(':')
  if (
    !renderId.startsWith(`${identity.path}:`) || range.length !== 2
    || !range.every(part => /^\d+$/.test(part))
    || !Number.isSafeInteger(Number(range[0])) || !Number.isSafeInteger(Number(range[1]))
    || Number(range[0]) > Number(range[1])
  ) {
    return undefined
  }
  return envelope({
    drop,
    identity,
    renderId,
    ...(studioRectId === undefined ? {} : { studioRectId }),
    type: 'preview-feed-drop',
  })
}

function parseHighlightSource(value: StudioJsonObject): StudioHighlightSourceMessage | undefined {
  const identity = parsePreviewSourceIdentity(value['identity'])
  const rawRange = value['range']
  const range = rawRange === undefined ? undefined : parseSourceRange(rawRange)
  if (identity === undefined || (rawRange !== undefined && range === undefined)) {
    return undefined
  }
  return envelope({
    identity,
    range,
    type: 'highlight-source',
  })
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
  return envelope({
    action,
    checkpoint,
    identity,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  })
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
  return envelope({
    checkpointId: value['checkpointId'],
    identity,
    requestId: value['requestId'],
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action-undo',
  })
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

function boundedText(value: unknown, maximumLength: number): value is string {
  return nonEmptyString(value) && value.length <= maximumLength
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
