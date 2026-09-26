import { Assert, Errors, Switch } from '@shared/core'
import type { EditorView } from 'codemirror'
import type { StudioDraftFile } from '../../StudioDraftSync'
import { StudioInspector, type StudioInspectorSelection } from '../../StudioInspector'
import {
  type StudioDebugCommandMessage,
  type StudioPreviewCanvasGestureMessage,
  type StudioPreviewCanvasPanKeyMessage,
  type StudioPreviewCanvasShortcutMessage,
  type StudioPreviewFeedDropMessage,
  type StudioPreviewIdentity,
  type StudioPreviewRuntimeUpdateMessage,
  StudioProtocol,
  studioProtocolChannel,
  studioProtocolVersion,
  type StudioRuntimeCaptureArtifact,
  type StudioSourceActionEnvelope,
  type StudioSourceActionIdentity,
  type StudioWindowMessage,
} from '../../StudioProtocol'
import {
  StudioApiClient,
  StudioApiError,
  type StudioCellRuntimeResponse,
  type StudioHandshake,
} from '../StudioApiClient'
import { StudioDialog } from '../StudioDialog'
import { absoluteSourcePath, StudioSourceNavigation } from '../StudioEditor'
import { revealCanvasNode } from './StudioCanvasViewport'
import { StudioDebugEvents } from './StudioDebugEvents'
import { invalidatePreviewJourneyRecording, StudioJourneyRecorder } from './StudioJourneyRecording'
import type { StudioInteractionMode, StudioPreviewConnection } from './StudioPreviewConnection'
import { StudioReviewDom } from './StudioReviewDom'
import { runtimeCaptureWithEnvironment } from './StudioRuntimeCapture'
import { openRuntimeFailureSource, showRuntimeFailure, type StudioOpenFile } from './StudioRuntimeFailurePanel'

/** The actions the app wires into the bridge so a preview message can reach the editor and inspector. */
type StudioPreviewMessageActions = {
  activate?: () => void
  applySourceAction: (envelope: StudioSourceActionEnvelope) => Promise<void>
  canvasGesture?: (gesture: StudioPreviewCanvasGestureMessage) => void
  canvasPanKey?: (message: StudioPreviewCanvasPanKeyMessage) => void
  canvasShortcut?: (message: StudioPreviewCanvasShortcutMessage) => void
  changed?: () => void
  feedDrop?: (message: StudioPreviewFeedDropMessage) => Promise<void>
  inspect: (selection: StudioInspectorSelection) => void
  reveal?: () => void
}

type StudioOpenFileRequest = (path: string) => Promise<StudioOpenFile | undefined>

type MessageOfType<Message, Type> = Message extends { type: infer MessageType }
  ? Type extends MessageType ? Message : never
  : never

/** The protocol member (or members) whose `type` admits one literal of the closed window-message union. */
type StudioWindowMessageOf<Type extends StudioWindowMessage['type']> = MessageOfType<StudioWindowMessage, Type>

/**
 * received narrows a parsed message to the member its `type` literal names. The dispatch below is
 * exhaustive over that literal, and Switch hands each handler the message's own `type`, so the
 * narrowing is a restatement of the dispatch rather than a new claim.
 */
function received<Type extends StudioWindowMessage['type']>(
  message: StudioWindowMessage,
  type: Type,
): StudioWindowMessageOf<Type> {
  Assert(message.type === type, 'Studio preview message dispatch handed a handler a different message type.')
  return message as StudioWindowMessageOf<Type>
}

/**
 * A retained preview keeps its realm across compiles, so it can report a layout or applied
 * revision after the next manifest replaces it. The server rejects that stale report with 409;
 * the current preview will send its own report.
 */
function ignoreSupersededPreviewReport(error: unknown): void {
  if (error instanceof StudioApiError && error.status === 409) {
    return
  }
  throw error
}

export function postInteractionMode(preview: StudioPreviewConnection, handshake: StudioHandshake): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  target.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...(preview.cellIdentity ?? handshake.identity),
      previewInstanceId: preview.previewInstanceId,
    },
    mode: preview.interactionMode,
    protocolVersion: studioProtocolVersion,
    type: 'set-interaction-mode',
  }, preview.origin)
}

/** Publishes whether the current Studio layout synchronously owns wheel gestures inside this iframe. */
export function postCanvasGestureOwnership(
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
  owned: boolean,
): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  target.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...(preview.cellIdentity ?? handshake.identity),
      previewInstanceId: preview.previewInstanceId,
    },
    owned,
    protocolVersion: studioProtocolVersion,
    type: 'set-canvas-gestures',
  }, preview.origin)
}

/**
 * postDebugCommand sends one debugger command to the preview holding the pause. The identity is the
 * cell's own, so a command released in one cell cannot resume a root stopped in another.
 */
export function postDebugCommand(
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
  command: StudioDebugCommandMessage['command'],
): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  const message: StudioDebugCommandMessage = {
    channel: studioProtocolChannel,
    command,
    identity: {
      ...(preview.cellIdentity ?? handshake.identity),
      previewInstanceId: preview.previewInstanceId,
    },
    protocolVersion: studioProtocolVersion,
    type: 'debug-command',
  }
  target.postMessage(message, preview.origin)
}

export function postPreviewRuntimeUpdate(
  preview: StudioPreviewConnection,
  runtime: StudioCellRuntimeResponse,
): void {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return
  }
  const message: StudioPreviewRuntimeUpdateMessage<StudioCellRuntimeResponse> = {
    channel: studioProtocolChannel,
    identity: { ...runtime.identity, previewInstanceId: preview.previewInstanceId },
    protocolVersion: studioProtocolVersion,
    runtime,
    type: 'preview-runtime-update',
  }
  target.postMessage(message, preview.origin)
}

export function configureInteractionMode(
  button: HTMLButtonElement,
  previews: readonly StudioPreviewConnection[],
  handshake: StudioHandshake,
): void {
  const render = (mode: StudioInteractionMode): void => {
    button.dataset['mode'] = mode
    button.textContent = mode === 'edit' ? 'Mode: Edit' : 'Mode: Run'
    button.title = mode === 'edit'
      ? 'Studio owns clicks and drags for selection and visual editing.'
      : 'The app receives clicks, presses, scrolling, and other interaction normally.'
  }
  const setMode = (mode: StudioInteractionMode): void => {
    render(mode)
    for (const preview of previews) {
      preview.interactionMode = mode
      postInteractionMode(preview, handshake)
    }
  }
  for (const preview of previews) {
    preview.setInteractionMode = setMode
    preview.iframe.addEventListener('load', () => {
      invalidatePreviewJourneyRecording(preview)
      postInteractionMode(preview, handshake)
    })
  }
  button.addEventListener('click', () => setMode(button.dataset['mode'] === 'edit' ? 'run' : 'edit'))
  setMode('edit')
}

function matchesExactPreviewCellIdentity(
  preview: StudioPreviewConnection,
  identity: StudioPreviewIdentity,
): boolean {
  const expected = preview.cellIdentity
  return expected !== undefined
    && identity.appName === expected.appName
    && identity.project === expected.project
    && identity.previewInstanceId === preview.previewInstanceId
    && identity.cellId === expected.cellId
    && identity.cellRevision === expected.cellRevision
    && identity.compileRevision === expected.compileRevision
    && identity.manifestRevision === expected.manifestRevision
}

export async function handlePreviewMessage(
  event: MessageEvent,
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
  openFile: StudioOpenFileRequest,
  actions: StudioPreviewMessageActions,
): Promise<void> {
  const message = StudioProtocol.parseWindowMessage(event, {
    ...handshake.identity,
    origin: preview.origin,
    previewInstanceId: preview.previewInstanceId,
    source: preview.iframe.contentWindow,
  })
  if (message === undefined) {
    return
  }
  // Messages Studio sends to the preview, and hover, come back through the same parser; nothing listens for them here.
  const ignored = (): void => {}
  await Switch.property<StudioWindowMessage, 'type', Promise<void> | void>(message, 'type', {
    'debug-command': ignored,
    'highlight-source': ignored,
    'preview-applied': type => receivePreviewApplied(preview, received(message, type), handshake),
    'preview-console': type => receiveConsole(preview, received(message, type), actions),
    'preview-canvas-gesture': type => actions.canvasGesture?.(received(message, type)),
    'preview-canvas-pan-key': type => actions.canvasPanKey?.(received(message, type)),
    'preview-canvas-shortcut': type => actions.canvasShortcut?.(received(message, type)),
    'preview-debug': type => receiveDebug(preview, received(message, type), actions),
    'preview-fixture-capture-failed': type => receiveFixtureCapture(preview, received(message, type), actions),
    'preview-fixture-captured': type => receiveFixtureCapture(preview, received(message, type), actions),
    'preview-feed-drop': async type => {
      const drop = received(message, type)
      Assert.input(
        matchesExactPreviewCellIdentity(preview, drop.identity),
        'The Feed drop belongs to an outdated preview. Wait for the current preview and try again.',
      )
      Assert.input(preview.interactionMode === 'edit', 'Switch to Edit mode before dropping a Feed field.')
      Assert.input(actions.feedDrop !== undefined, 'Feed drops are not connected to this preview.')
      await actions.feedDrop(drop)
    },
    'preview-hover-source': ignored,
    'preview-journey-recording-state': type => receiveJourneyRecording(preview, received(message, type), actions),
    'preview-journey-replay-failed': type => receiveJourneyReplay(preview, received(message, type)),
    'preview-journey-replay-settled': type => receiveJourneyReplay(preview, received(message, type)),
    'preview-journey-step-recorded': type => receiveJourneyRecording(preview, received(message, type), actions),
    'preview-lens-render': type => receiveLensRender(preview, received(message, type), actions),
    'preview-layout-measurements': async type => {
      const measurement = received(message, type)
      if (preview.cellIdentity === undefined || matchesExactPreviewCellIdentity(preview, measurement.identity)) {
        preview.layoutMeasurements = measurement
      }
      await StudioApiClient.previewLayoutMeasurements(measurement).catch(ignoreSupersededPreviewReport)
    },
    'preview-runtime-capture-failed': type => receiveRuntimeCapture(preview, received(message, type)),
    'preview-runtime-captured': type => receiveRuntimeCapture(preview, received(message, type)),
    'preview-runtime-failure': type =>
      receiveRuntimeFailure(preview, received(message, type), handshake, openFile, actions),
    'preview-scheme-changed': type => receiveSchemeChange(preview, received(message, type), actions),
    'preview-select-source': type =>
      receiveSelectSource(preview, received(message, type), handshake, openFile, actions),
    'set-canvas-gestures': ignored,
    'set-journey-recording': ignored,
    'source-action': type => receiveSourceAction(preview, received(message, type), actions),
    'source-action-undo': ignored,
  })
}

function receiveConsole(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-console'>,
  actions: StudioPreviewMessageActions,
): void {
  preview.runtimeLogs = [...(preview.runtimeLogs ?? []), {
    arguments: message.arguments,
    level: message.level,
    timestamp: message.timestamp,
  }].slice(-500)
  actions.changed?.()
}

function receiveDebug(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-debug'>,
  actions: StudioPreviewMessageActions,
): void {
  preview.debug = StudioDebugEvents.receive(preview.debug ?? StudioDebugEvents.empty(), message.event)
  actions.changed?.()
}

function receiveLensRender(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-lens-render'>,
  actions: StudioPreviewMessageActions,
): void {
  if (preview.cellIdentity !== undefined && !matchesExactPreviewCellIdentity(preview, message.identity)) {
    return
  }
  preview.lensSamples = [...(preview.lensSamples ?? []), message.sample].slice(-1_000)
  if (preview.lensNotifyQueued) {
    return
  }
  preview.lensNotifyQueued = true
  queueMicrotask(() => {
    preview.lensNotifyQueued = false
    actions.changed?.()
  })
}

function receiveJourneyRecording(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-journey-recording-state' | 'preview-journey-step-recorded'>,
  actions: StudioPreviewMessageActions,
): void {
  const draft = preview.journeyRecording
  if (draft === undefined || draft.id !== message.recordingId) {
    return
  }
  if (!matchesExactPreviewCellIdentity(preview, message.identity)) {
    invalidatePreviewJourneyRecording(preview)
    actions.changed?.()
    return
  }
  preview.journeyRecording = StudioJourneyRecorder.receive(draft, message)
  if (
    preview.journeyRecording.status !== 'starting'
    && preview.journeyRecordingTimeout !== undefined
  ) {
    clearTimeout(preview.journeyRecordingTimeout)
    preview.journeyRecordingTimeout = undefined
  }
  actions.changed?.()
}

function receiveJourneyReplay(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-journey-replay-failed' | 'preview-journey-replay-settled'>,
): void {
  if (!matchesExactPreviewCellIdentity(preview, message.identity)) {
    return
  }
  preview.journeyReplayStatus = message.type === 'preview-journey-replay-settled' ? 'settled' : 'failed'
  if (preview.frame !== undefined) {
    if (message.type === 'preview-journey-replay-settled') {
      StudioReviewDom.status(preview.frame, 'ready')
    } else {
      StudioReviewDom.status(preview.frame, 'failed', message.error)
    }
  }
}

function receiveSchemeChange(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-scheme-changed'>,
  actions: StudioPreviewMessageActions,
): void {
  if (preview.cell !== undefined) {
    preview.cell = {
      ...preview.cell,
      environment: { ...preview.cell.environment, scheme: message.scheme },
    }
    actions.changed?.()
  }
}

function receiveRuntimeCapture(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-runtime-capture-failed' | 'preview-runtime-captured'>,
): void {
  const request = preview.runtimeCaptureRequest
  if (request === undefined || request.requestId !== message.requestId) {
    return
  }
  clearTimeout(request.timeout)
  preview.runtimeCaptureRequest = undefined
  if (message.type === 'preview-runtime-capture-failed') {
    request.reject(studioPreviewCaptureError(message.errorName, message.error))
  } else {
    request.resolve(message.capture)
  }
}

/** Rebuilds the runtime's three-category Tao error after it crosses the preview window protocol. */
export function studioPreviewCaptureError(
  name: 'HostEnvironmentError' | 'UnexpectedBehaviorError' | 'UserInputError',
  message: string,
): Error {
  if (name === 'HostEnvironmentError') {
    return new Errors.HostEnvironmentError(message)
  }
  if (name === 'UserInputError') {
    return new Errors.UserInputError(message)
  }
  return new Errors.UnexpectedBehaviorError(message)
}

async function receivePreviewApplied(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-applied'>,
  handshake: StudioHandshake,
): Promise<void> {
  postInteractionMode(preview, handshake)
  const identity = preview.cellIdentity
  const currentCell = identity === undefined || (
    message.identity.cellId === identity.cellId
    && message.identity.cellRevision === identity.cellRevision
    && message.identity.compileRevision === identity.compileRevision
    && message.identity.manifestRevision === identity.manifestRevision
  )
  if (!currentCell) {
    return
  }
  if (identity !== undefined) {
    preview.appliedRevision = Math.max(preview.appliedRevision ?? 0, message.appliedRevision)
  }
  if (preview.frame !== undefined && StudioReviewDom.appliedReady(preview.journeyReplayStatus)) {
    StudioReviewDom.status(preview.frame, 'ready')
  }
  // A frame can acknowledge its previous revision while Studio publishes the next manifest.
  // The server correctly rejects that stale report; it does not indicate a broken preview.
  await StudioApiClient.previewApplied(message).catch(ignoreSupersededPreviewReport)
}

async function receiveSourceAction(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'source-action'>,
  actions: StudioPreviewMessageActions,
): Promise<void> {
  actions.activate?.()
  await actions.applySourceAction({
    ...message,
    identity: {
      ...message.identity,
      ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
    },
  })
}

function receiveRuntimeFailure(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-runtime-failure'>,
  handshake: StudioHandshake,
  openFile: StudioOpenFileRequest,
  actions: StudioPreviewMessageActions,
): void {
  actions.activate?.()
  const capture = runtimeCaptureWithEnvironment(
    message.capture,
    preview.cell?.environment,
  )
  preview.runtimeFailure = capture
  if (preview.frame !== undefined) {
    StudioReviewDom.status(preview.frame, 'failed', capture.failure?.error.message ?? 'Runtime failure')
  }
  revealCanvasNode(preview.frame)
  showRuntimeFailure(preview, capture, () => openRuntimeFailureSource(capture, handshake, openFile))
  preview.changed?.()
}

async function receiveFixtureCapture(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-fixture-capture-failed' | 'preview-fixture-captured'>,
  actions: StudioPreviewMessageActions,
): Promise<void> {
  const capture = preview.capture
  if (capture === undefined || capture.requestId !== message.requestId) {
    return
  }
  clearTimeout(capture.timeout)
  preview.capture = undefined
  if (message.type === 'preview-fixture-capture-failed') {
    capture.reject(studioPreviewCaptureError(message.errorName, message.error))
    return
  }
  const envelope = StudioInspector.singleAction({
    action: {
      fixtureName: capture.fixtureName,
      kind: 'insert-captured-fixture',
      plan: message.fixture,
    },
    checkpointId: `captured-fixture:${capture.requestId}`,
    identity: capture.identity,
    requestId: capture.requestId,
  })
  let proposal: Awaited<ReturnType<typeof StudioApiClient.sourceActionProposal>>
  try {
    proposal = await StudioApiClient.sourceActionProposal(envelope)
  } catch (error) {
    capture.reject(Errors.asError(error))
    return
  }
  const confirmed = await StudioDialog.confirm({
    confirmLabel: 'Save fixture',
    diff: proposal.diff,
    title: 'Save this captured Tao fixture?',
  })
  if (!confirmed) {
    capture.resolve('cancelled')
    return
  }
  try {
    await actions.applySourceAction(envelope)
    capture.resolve('saved')
  } catch (error) {
    capture.reject(Errors.asError(error))
  }
}

async function receiveSelectSource(
  preview: StudioPreviewConnection,
  message: StudioWindowMessageOf<'preview-select-source'>,
  handshake: StudioHandshake,
  openFile: StudioOpenFileRequest,
  actions: StudioPreviewMessageActions,
): Promise<void> {
  actions.activate?.()
  const opened = await StudioSourceNavigation.openAndSelect({
    identity: message.identity,
    openFile,
    project: handshake.identity.project,
    range: message.range,
  })
  if (opened === undefined) {
    return
  }
  actions.reveal?.()
  actions.inspect(StudioInspector.selection({
    ...message,
    identity: {
      ...message.identity,
      ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
    },
  }))
}

export function requestRuntimeCapture(
  preview: StudioPreviewConnection,
  handshake: StudioHandshake,
): Promise<StudioRuntimeCaptureArtifact> {
  const target = preview.iframe.contentWindow
  if (target === null) {
    return Promise.reject(new Errors.HostEnvironmentError('The active preview is not connected.'))
  }
  preview.runtimeCaptureRequest?.reject(
    new Errors.UnexpectedBehaviorError('A newer live-data refresh replaced this request.'),
  )
  if (preview.runtimeCaptureRequest !== undefined) {
    clearTimeout(preview.runtimeCaptureRequest.timeout)
  }
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (preview.runtimeCaptureRequest?.requestId === requestId) {
        preview.runtimeCaptureRequest = undefined
        reject(new Errors.HostEnvironmentError('The active preview did not return live app data.'))
      }
    }, 5_000)
    preview.runtimeCaptureRequest = { reject, requestId, resolve, timeout }
    target.postMessage({
      channel: studioProtocolChannel,
      identity: {
        ...(preview.cellIdentity ?? handshake.identity),
        previewInstanceId: preview.previewInstanceId,
      },
      protocolVersion: studioProtocolVersion,
      requestId,
      type: 'capture-runtime',
    }, preview.origin)
  })
}

export function currentSourceIdentity(
  handshake: StudioHandshake,
  preview: StudioPreviewConnection | undefined,
  file: StudioDraftFile | undefined,
): StudioSourceActionIdentity | undefined {
  return preview === undefined
      || file === undefined
      || preview.cellIdentity !== undefined && preview.cell === undefined
    ? undefined
    : {
      ...handshake.identity,
      ...(preview.cellIdentity ?? {}),
      path: absoluteSourcePath(handshake.identity.project, file.path),
      previewInstanceId: preview.previewInstanceId,
      ...(preview.cell === undefined ? {} : { scenarioId: preview.cell.scenarioId }),
      sourceVersion: file.sourceVersion,
    }
}

export function postEditorSelection(
  preview: StudioPreviewConnection | undefined,
  handshake: StudioHandshake,
  activeFile: StudioDraftFile | undefined,
  editor: EditorView,
): void {
  if (
    preview === undefined
    || activeFile === undefined
    || activeFile.content !== editor.state.doc.toString()
    || preview.iframe.contentWindow === null
  ) {
    return
  }
  const selection = editor.state.selection.main
  preview.iframe.contentWindow.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...handshake.identity,
      path: absoluteSourcePath(handshake.identity.project, activeFile.path),
      previewInstanceId: preview.previewInstanceId,
      sourceVersion: activeFile.sourceVersion,
    },
    protocolVersion: studioProtocolVersion,
    range: { end: selection.to, start: selection.from },
    type: 'highlight-source',
  }, preview.origin)
}
