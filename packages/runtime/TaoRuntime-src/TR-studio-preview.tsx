import React from 'react'
import { RuntimeAssert } from './TR-assert'
import { captureArguments, onRuntimeFailure } from './TR-error-containment'
import { requireReactNativeRuntime } from './TR-react-native'
import { captureRuntime, restoreRuntimeCapture, type TaoRuntimeCaptureArtifact } from './TR-runtime-capture'
import type { TaoSchemeSnapshot } from './TR-scheme'
import { StudioEnvironmentControls, type TaoStudioFixturePlan } from './TR-studio-environment'
import {
  createTaoJourneyReplayGate,
  replayTaoJourney,
  type TaoJourneyAdapter,
  type TaoJourneyEvent,
  type TaoJourneySelector,
  type TaoJourneyStep,
  taoJourneyTargetTimeoutMs,
  waitForTaoJourneyTarget,
} from './TR-studio-journey'
import { TaoStudioProtocolVersions } from './TR-studio-protocol'
import type { TaoStudioIdentity } from './TR-TaoProps'
import { Clock } from './TR-units'

const studioProtocolChannel = TaoStudioProtocolVersions.channel
const studioProtocolVersion = TaoStudioProtocolVersions.protocolVersion
const studioSourceActionVersion = TaoStudioProtocolVersions.sourceActionVersion
const studioRenderSelector = '[data-tao-studio]'

/** StudioPreviewConfig is the explicit trusted context for one generated preview instance. */
export type StudioPreviewConfig = {
  appName: string
  cellId?: string
  cellRevision?: number
  compileRevision: number
  manifestRevision?: string
  parentOrigin: string
  previewInstanceId: string
  project: string
  sourceVersions: Readonly<Record<string, string>>
}

type StudioPreviewBridgeProps = {
  children?: React.ReactNode
  config: StudioPreviewConfig
}

type StudioPreviewErrorBoundaryProps = {
  children?: React.ReactNode
  /** Called once, synchronously during commit — before any sibling's `useEffect` — so a caller
   * deciding whether to acknowledge the cell that just mounted can see the failure first. */
  onError?: (error: unknown) => void
}

type StudioPreviewErrorBoundaryState = {
  error?: unknown
}

type StudioSourceRange = {
  end: number
  start: number
}

type StudioPreviewMessageEvent = {
  data: unknown
  origin: string
  source?: unknown
}

type StudioPreviewPointerEvent = {
  clientX?: number
  clientY?: number
  isComposing?: boolean
  key?: string
  preventDefault?(): void
  repeat?: boolean
  stopImmediatePropagation?(): void
  stopPropagation?(): void
  target?: unknown
  taoStudioJourney?: boolean
}

export type StudioPreviewRect = {
  height: number
  left: number
  top: number
  width: number
}

export type StudioPreviewElement = {
  closest?(selector: string): StudioPreviewElement | null
  contains?(element: StudioPreviewElement): boolean
  getAttribute(name: string): string | null
  getBoundingClientRect(): StudioPreviewRect
  dispatchEvent?(event: unknown): boolean
  focus?(): void
  parentElement?: StudioPreviewElement | null
  tagName?: string
  textContent?: string | null
  value?: string
}

type StudioPreviewOverlay = StudioPreviewElement & {
  remove(): void
  setAttribute(name: string, value: string): void
  style: Record<string, string>
}

export type StudioPreviewHost = {
  console?: Partial<Record<StudioPreviewLogLevel, (...arguments_: unknown[]) => void>>
  document: {
    addEventListener(
      type:
        | 'blur'
        | 'click'
        | 'input'
        | 'keydown'
        | 'mousedown'
        | 'mouseleave'
        | 'mousemove'
        | 'mouseover'
        | 'mouseout'
        | 'mouseup',
      listener: (event: StudioPreviewPointerEvent) => void,
      capture?: boolean,
    ): void
    body?: {
      appendChild(element: StudioPreviewOverlay): void
      getBoundingClientRect?(): StudioPreviewRect
    }
    createElement(name: 'div'): StudioPreviewOverlay
    querySelectorAll(selector: string): ArrayLike<StudioPreviewElement>
    removeEventListener(
      type:
        | 'blur'
        | 'click'
        | 'input'
        | 'keydown'
        | 'mousedown'
        | 'mouseleave'
        | 'mousemove'
        | 'mouseover'
        | 'mouseout'
        | 'mouseup',
      listener: (event: StudioPreviewPointerEvent) => void,
      capture?: boolean,
    ): void
  }
  parent: {
    postMessage(message: unknown, targetOrigin: string): void
  }
  window: {
    addEventListener(
      type: 'blur' | 'message' | 'resize' | 'scroll',
      listener: (event: StudioPreviewMessageEvent) => void,
    ): void
    removeEventListener(
      type: 'blur' | 'message' | 'resize' | 'scroll',
      listener: (event: StudioPreviewMessageEvent) => void,
    ): void
  }
}

type StudioPreviewLogLevel = 'debug' | 'error' | 'info' | 'log' | 'warn'

type StudioRenderTarget = {
  element: StudioPreviewElement
  identity: TaoStudioIdentity
}

export type StudioPreviewLayoutMeasurement = {
  elementName: string
  rect: { height: number; width: number; x: number; y: number }
  renderId: string
  studioRectId?: string
}

type StudioRenderGap = {
  after?: StudioRenderTarget
  before?: StudioRenderTarget
  distance: number
  horizontal: boolean
}

type StudioDrag = {
  gap?: StudioRenderGap
  moved: boolean
  startX: number
  startY: number
  target: StudioRenderTarget
}

type StudioRecordedJourneyTarget = Readonly<{
  selector: TaoJourneySelector
  target: string
}>

type StudioJourneyRecording = {
  captureSensitiveText: boolean
  id: string
  pending?: Readonly<{
    element: StudioPreviewElement
    sensitive: boolean
    target?: StudioRecordedJourneyTarget
    value: string
  }>
  sequence: number
}

let nextStudioSourceActionId = 1

/** StudioPreviewErrorBoundary keeps a failed preview cell visible and diagnostic. */
class StudioPreviewErrorBoundary extends React.Component<
  StudioPreviewErrorBoundaryProps,
  StudioPreviewErrorBoundaryState
> {
  override state: StudioPreviewErrorBoundaryState = {}

  static getDerivedStateFromError(error: unknown): StudioPreviewErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error)
  }

  override render(): React.ReactNode {
    return this.state.error === undefined
      ? this.props.children
      : React.createElement(StudioPreviewFailure, { error: this.state.error })
  }
}

/** StudioPreviewFailure renders bootstrap and render failures inside the device canvas. */
function StudioPreviewFailure({ error }: { error: unknown }): React.ReactElement {
  return previewMessage('Tao Studio preview error', previewErrorMessage(error), '#fff1ef', '#8f2418')
}

/** StudioPreviewPending avoids a blank device canvas while cell bootstrap is in flight. */
function StudioPreviewPending(): React.ReactElement {
  return previewMessage('Loading scenario…', 'Preparing the isolated Studio cell.', '#f7f8f5', '#3e4840')
}

function previewMessage(title: string, message: string, backgroundColor: string, color: string): React.ReactElement {
  const RN = requireReactNativeRuntime()
  return React.createElement(
    RN.View,
    {
      accessibilityRole: 'alert',
      style: { backgroundColor, flex: 1, gap: 8, minHeight: '100%', padding: 20 },
    },
    React.createElement(RN.Text, { style: { color, fontSize: 18, fontWeight: '700' } }, title),
    React.createElement(
      RN.Text,
      { selectable: true, style: { color, fontFamily: 'monospace', fontSize: 13 } },
      message,
    ),
  )
}

function previewErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name
  }
  return typeof error === 'string' ? error : String(error)
}

/** StudioPreview exposes the opt-in generated preview bridge. */
export const StudioPreview = {
  ErrorBoundary: StudioPreviewErrorBoundary,
  Failure: StudioPreviewFailure,
  Pending: StudioPreviewPending,
  PreviewBridge,
  ReplayHost,
} as const

/**
 * ReplayHost restores every registered semantic domain before mounting the generated app.
 *
 * It identifies the artifact by content rather than by object identity. The generated preview roots
 * rebuild their cell runtime — and with it the replay artifact — on every render, so keying the
 * restore on identity restarted it every render; restarting sets state, which renders again, and
 * the cell spins until React gives up with "Maximum update depth exceeded". Every cell carrying a
 * replay was affected, on the device and in the browser canvas alike.
 *
 * The content key is only computed when the artifact's identity changes, so a caller that keeps it
 * stable pays nothing for this.
 */
function ReplayHost(props: { children?: React.ReactNode; replay?: TaoRuntimeCaptureArtifact }): React.ReactElement {
  const [ready, setReady] = React.useState(() => props.replay === undefined)
  const [error, setError] = React.useState<unknown>()
  const replay = props.replay
  const replayKey = React.useMemo(() => replay === undefined ? undefined : JSON.stringify(replay), [replay])
  // The effect restores whichever artifact is current when it runs; the key decides only *when* to
  // run, so this ref keeps the two from disagreeing about which artifact that is.
  const pending = React.useRef(replay)
  pending.current = replay
  React.useEffect(() => {
    let active = true
    const artifact = pending.current
    if (artifact === undefined) {
      setReady(true)
      return () => {
        active = false
      }
    }
    setReady(false)
    void restoreRuntimeCapture(artifact).then(
      () => {
        if (active) {
          setReady(true)
        }
      },
      replayError => {
        if (active) {
          setError(replayError)
        }
      },
    )
    return () => {
      active = false
    }
  }, [replayKey])
  if (error !== undefined) {
    return React.createElement(StudioPreviewFailure, { error })
  }
  return ready ? React.createElement(React.Fragment, null, props.children) : React.createElement(StudioPreviewPending)
}

/** PreviewBridge activates Studio messaging only when a generated preview supplies trusted configuration. */
function PreviewBridge(props: StudioPreviewBridgeProps): React.ReactElement {
  const captureFixture = StudioEnvironmentControls.useCapture()
  const scheme = StudioEnvironmentControls.useScheme()
  const scenario = StudioEnvironmentControls.useScenario()
  const journeyRevision = [
    props.config.compileRevision,
    props.config.cellRevision ?? 'app',
    props.config.manifestRevision ?? 'app',
    props.config.previewInstanceId,
  ].join(':')
  const journeyReplayGate = React.useRef(createTaoJourneyReplayGate())
  const [journeyError, setJourneyError] = React.useState<unknown>()
  React.useEffect(() => mountStudioPreviewBridge(props.config, undefined, captureFixture), [
    captureFixture,
    props.config,
  ])
  React.useEffect(() => publishStudioScheme(props.config, scheme), [props.config, scheme])
  React.useEffect(() => {
    const steps = scenario?.steps
    if (steps === undefined || steps.length === 0 || !journeyReplayGate.current.beginReplay(journeyRevision)) {
      return
    }
    let active = true
    const abort = new AbortController()
    setJourneyError(undefined)
    void replayStudioJourney(steps, undefined, { signal: abort.signal }).then(
      () => {
        journeyReplayGate.current.completeReplay(journeyRevision)
        if (active) {
          publishStudioJourneyReplayResult(props.config, 'settled')
        }
      },
      error => {
        journeyReplayGate.current.failReplay(journeyRevision)
        if (active) {
          publishStudioJourneyReplayResult(props.config, 'failed', error)
          setJourneyError(error)
        }
      },
    )
    return () => {
      // A remount or scenario change supersedes this replay: stop it before the successor starts
      // dispatching into the same realm, and never publish its outcome.
      active = false
      abort.abort()
    }
  }, [journeyRevision, scenario])
  if (journeyError !== undefined) {
    return React.createElement(StudioPreviewFailure, { error: journeyError })
  }
  return React.createElement(React.Fragment, null, props.children)
}

/** replayStudioJourney drives a scenario prefix in the live browser preview through DOM events. */
export async function replayStudioJourney(
  steps: readonly TaoJourneyStep[],
  suppliedHost?: StudioPreviewHost,
  options: Readonly<{ signal?: AbortSignal; targetTimeoutMs?: number }> = {},
): Promise<void> {
  const host = suppliedHost ?? browserPreviewHost()
  if (host === undefined || steps.length === 0) {
    return
  }
  const checkAborted = (): void => {
    RuntimeAssert.input(
      options.signal?.aborted !== true,
      'The Tao Studio journey replay was superseded before it finished.',
    )
  }
  // The clock is held, not taken over: the cell's own toasts, tickers, and pending fills keep their
  // schedule and resume on real timers when the replay releases it.
  const release = journeyUsesClock(steps) ? Clock.hold() : undefined
  try {
    await Promise.resolve()
    checkAborted()
    const adapter: TaoJourneyAdapter<StudioPreviewElement> = {
      advance(milliseconds) {
        checkAborted()
        Clock.advance(milliseconds)
      },
      dispatch(target, event, value) {
        checkAborted()
        dispatchJourneyEvent(target, event, value)
      },
      async find(selector, target, scope) {
        checkAborted()
        return await findJourneyTarget(host, selector, target, scope, options.targetTimeoutMs)
      },
      async select(tag, index, scope) {
        checkAborted()
        let matchCount = 0
        const selected = await waitForTaoJourneyTarget(() => {
          const matches = findJourneyTargets(host, 'tag', tag, scope)
          matchCount = matches.length
          return matches[index - 1]
        }, options.targetTimeoutMs ?? taoJourneyTargetTimeoutMs)
        RuntimeAssert.input(
          selected !== undefined,
          `Tao Studio journey expected row ${index} for tag '#${tag}', found ${matchCount} after waiting ${
            options.targetTimeoutMs ?? taoJourneyTargetTimeoutMs
          }ms.`,
          { index, matches: matchCount, tag },
        )
        return selected
      },
      async settle() {
        // Discrete events commit synchronously, but a virtual-clock callback or a hover update is
        // flushed by React's scheduler on a macrotask, so settling yields one of those as well.
        await Promise.resolve()
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      },
    }
    await replayTaoJourney(steps, adapter)
  } finally {
    release?.()
  }
}

async function findJourneyTarget(
  host: StudioPreviewHost,
  selector: TaoJourneySelector,
  target: string,
  scope?: StudioPreviewElement,
  timeoutMs = taoJourneyTargetTimeoutMs,
): Promise<StudioPreviewElement> {
  const match = await waitForTaoJourneyTarget(() => {
    const matches = findJourneyTargets(host, selector, target, scope)
    RuntimeAssert.input(
      matches.length <= 1,
      `Tao Studio journey expected exactly one ${selector} target '${target}', found ${matches.length}.`,
      { selector, target },
    )
    return matches[0]
  }, timeoutMs)
  RuntimeAssert.input(
    match !== undefined,
    `Tao Studio journey expected exactly one ${selector} target '${target}', found 0 after waiting ${timeoutMs}ms.`,
    { selector, target },
  )
  return match
}

function findJourneyTargets(
  host: StudioPreviewHost,
  selector: TaoJourneySelector,
  target: string,
  scope?: StudioPreviewElement,
): StudioPreviewElement[] {
  const candidates = Array.from<StudioPreviewElement>(host.document.querySelectorAll('*')).filter(element => {
    if (scope !== undefined && element !== scope && !elementIsWithin(element, scope)) {
      return false
    }
    if (selector === 'tag') {
      return element.getAttribute('data-testid') === target
    }
    if (selector === 'label') {
      return element.getAttribute('aria-label') === target
    }
    if (selector === 'placeholder') {
      return element.getAttribute('placeholder') === target
    }
    return element.textContent?.trim() === target
  })
  const matches = selector === 'text'
    ? candidates.filter(candidate =>
      !candidates.some(other => other !== candidate && elementIsWithin(other, candidate))
    )
    : candidates
  return matches
}

function journeyUsesClock(steps: readonly TaoJourneyStep[]): boolean {
  return steps.some(step => step.kind === 'advance' || step.kind === 'select' && journeyUsesClock(step.steps))
}

function elementIsWithin(element: StudioPreviewElement, possibleAncestor: StudioPreviewElement): boolean {
  let parent = element.parentElement
  while (parent !== undefined && parent !== null) {
    if (parent === possibleAncestor) {
      return true
    }
    parent = parent.parentElement
  }
  return false
}

function dispatchJourneyEvent(target: StudioPreviewElement, event: TaoJourneyEvent, value?: string): void {
  if (event === 'focus' && target.focus !== undefined) {
    target.focus()
    return
  }
  RuntimeAssert.input(target.dispatchEvent !== undefined, 'A Tao Studio journey target must accept browser events.')
  const browser = globalThis as unknown as {
    Event?: new(type: string, init?: unknown) => object
    KeyboardEvent?: new(type: string, init?: unknown) => object
    MouseEvent?: new(type: string, init?: unknown) => object
    PointerEvent?: new(type: string, init?: unknown) => object
  }
  if (event === 'enter') {
    RuntimeAssert.input(value !== undefined, 'A Tao Studio enter journey step must carry text.')
    setJourneyInputValue(target, value)
    dispatchBrowserEvent(target, 'input', browser.Event, { bubbles: true, cancelable: true })
    return
  }
  if (event === 'submit') {
    dispatchBrowserEvent(target, 'keydown', browser.KeyboardEvent ?? browser.Event, {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
    })
    return
  }
  if (event === 'hover') {
    const PointerConstructor = browser.PointerEvent ?? browser.MouseEvent ?? browser.Event
    const pointer = browser.PointerEvent === undefined ? 'mouse' : 'pointer'
    dispatchBrowserEvent(target, `${pointer}over`, PointerConstructor, {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    })
    // A text selector resolves to the innermost matching node, which for a pressable is its nested
    // label, while react-native-web listens for `enter` on the pressable itself. A real pointer
    // entering the label enters every ancestor too, so the synthetic event bubbles to reach them.
    dispatchBrowserEvent(target, `${pointer}enter`, PointerConstructor, {
      bubbles: true,
      cancelable: true,
      pointerType: 'mouse',
    })
    return
  }
  const type = event === 'pressDown'
    ? 'mousedown'
    : event === 'pressUp'
    ? 'mouseup'
    : 'click'
  dispatchBrowserEvent(target, type, browser.MouseEvent ?? browser.Event, {
    bubbles: true,
    button: 0,
    buttons: event === 'pressDown' ? 1 : 0,
    cancelable: true,
  })
}

function dispatchBrowserEvent(
  target: StudioPreviewElement,
  type: string,
  Constructor: (new(type: string, init?: unknown) => object) | undefined,
  init: Record<string, unknown>,
): void {
  const browserEvent = Constructor === undefined
    ? { type }
    : new Constructor(type, init)
  Object.defineProperty(browserEvent, 'taoStudioJourney', { value: true })
  target.dispatchEvent?.(browserEvent)
}

function setJourneyInputValue(target: StudioPreviewElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target) as object, 'value')
  if (descriptor?.set !== undefined) {
    descriptor.set.call(target, value)
  } else {
    target.value = value
  }
}

/** Publishes an exact-cell result only after the runtime journey replay promise resolves or rejects. */
export function publishStudioJourneyReplayResult(
  config: StudioPreviewConfig,
  result: 'failed' | 'settled',
  error?: unknown,
  suppliedHost?: StudioPreviewHost,
): void {
  const host = suppliedHost ?? browserPreviewHost()
  if (
    host === undefined
    || !validPreviewConfig(config)
    || config.cellId === undefined
    || config.cellRevision === undefined
    || config.manifestRevision === undefined
  ) {
    return
  }
  host.parent.postMessage({
    channel: studioProtocolChannel,
    ...(result === 'failed' ? { error: previewErrorMessage(error) } : {}),
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    type: result === 'failed' ? 'preview-journey-replay-failed' : 'preview-journey-replay-settled',
  }, config.parentOrigin)
}

/** Publishes the runtime-resolved cell Scheme without coupling Studio to CSS or host inference. */
export function publishStudioScheme(
  config: StudioPreviewConfig,
  scheme: TaoSchemeSnapshot,
  suppliedHost?: StudioPreviewHost,
): void {
  const host = suppliedHost ?? browserPreviewHost()
  if (host === undefined || !validPreviewConfig(config)) {
    return
  }
  host.parent.postMessage({
    channel: studioProtocolChannel,
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    scheme,
    type: 'preview-scheme-changed',
  }, config.parentOrigin)
}

/** mountStudioPreviewBridge mounts one imperative browser bridge and returns its complete cleanup. */
export function mountStudioPreviewBridge(
  config: StudioPreviewConfig,
  suppliedHost?: StudioPreviewHost,
  captureFixture?: () => Promise<TaoStudioFixturePlan>,
): () => void {
  const host = suppliedHost ?? browserPreviewHost()
  if (host === undefined || !validPreviewConfig(config)) {
    return () => {}
  }

  let hoverTarget: StudioRenderTarget | undefined
  let selectedTarget: StudioRenderTarget | undefined
  let sourceTarget: StudioRenderTarget | undefined
  let overlay: StudioPreviewOverlay | undefined
  let dragOverlay: StudioPreviewOverlay | undefined
  let dropOverlay: StudioPreviewOverlay | undefined
  let drag: StudioDrag | undefined
  let suppressNextClick = false
  let postedHoverKey: string | undefined
  let interactionMode: 'edit' | 'run' = 'edit'
  let recording: StudioJourneyRecording | undefined
  let measurementQueued = false
  let stopped = false

  const postLayoutMeasurements = () => {
    measurementQueued = false
    if (stopped || host.document.body?.getBoundingClientRect === undefined) {
      return
    }
    host.parent.postMessage({
      channel: studioProtocolChannel,
      identity: previewIdentity(config),
      measurements: collectStudioPreviewLayoutMeasurements(
        host.document.querySelectorAll(studioRenderSelector),
        host.document.body.getBoundingClientRect(),
      ),
      protocolVersion: studioProtocolVersion,
      type: 'preview-layout-measurements',
    }, config.parentOrigin)
  }
  const scheduleLayoutMeasurements = () => {
    if (measurementQueued) {
      return
    }
    measurementQueued = true
    queueMicrotask(postLayoutMeasurements)
  }

  const disarmDrag = () => {
    drag = undefined
    dragOverlay?.remove()
    dropOverlay?.remove()
    dragOverlay = undefined
    dropOverlay = undefined
  }

  const postRecordingState = (
    activeRecording: StudioJourneyRecording,
    status: 'recording' | 'stopped' | 'invalidated',
  ) => {
    host.parent.postMessage({
      channel: studioProtocolChannel,
      identity: previewIdentity(config),
      protocolVersion: studioProtocolVersion,
      recordingId: activeRecording.id,
      sequence: activeRecording.sequence,
      status,
      type: 'preview-journey-recording-state',
    }, config.parentOrigin)
  }
  const postRecordedStep = (
    activeRecording: StudioJourneyRecording,
    step: Readonly<Record<string, unknown>>,
  ) => {
    activeRecording.sequence += 1
    host.parent.postMessage({
      channel: studioProtocolChannel,
      identity: previewIdentity(config),
      protocolVersion: studioProtocolVersion,
      recordingId: activeRecording.id,
      sequence: activeRecording.sequence,
      step,
      type: 'preview-journey-step-recorded',
    }, config.parentOrigin)
  }
  const flushRecordedInput = (element?: StudioPreviewElement) => {
    const activeRecording = recording
    const pending = activeRecording?.pending
    if (
      activeRecording === undefined || pending === undefined || (element !== undefined && pending.element !== element)
    ) {
      return
    }
    activeRecording.pending = undefined
    postRecordedStep(
      activeRecording,
      pending.target === undefined
        ? unresolvedRecordedStep('enter')
        : {
          kind: 'enter',
          redacted: pending.sensitive && !activeRecording.captureSensitiveText,
          ...pending.target,
          value: pending.sensitive && !activeRecording.captureSensitiveText ? '' : pending.value,
        },
    )
  }
  const startOrStopRecording = (event: StudioPreviewMessageEvent): boolean => {
    const control = recordingControlFromMessage(event, config, host.parent)
    if (control === undefined) {
      return false
    }
    if (control.active) {
      if (recording !== undefined) {
        flushRecordedInput()
        postRecordingState(recording, 'invalidated')
      }
      recording = {
        captureSensitiveText: control.captureSensitiveText,
        id: control.recordingId,
        sequence: 0,
      }
      interactionMode = 'run'
      hoverTarget = undefined
      selectedTarget = undefined
      sourceTarget = undefined
      disarmDrag()
      overlay?.remove()
      overlay = undefined
      postRecordingState(recording, 'recording')
    } else if (recording?.id === control.recordingId) {
      const stoppedRecording = recording
      flushRecordedInput()
      recording = undefined
      postRecordingState(stoppedRecording, 'stopped')
    }
    return true
  }
  const onRecordedInput = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true || recording === undefined) {
      return
    }
    const element = previewElementFromEvent(event)
    if (element === undefined || typeof element.value !== 'string') {
      return
    }
    const target = recordedJourneyTarget(host, element)
    if (recording.pending?.element !== element) {
      flushRecordedInput()
    }
    recording.pending = {
      element,
      sensitive: isSensitiveJourneyInput(element),
      target,
      value: element.value,
    }
  }
  const onRecordedBlur = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney !== true) {
      flushRecordedInput(previewElementFromEvent(event))
    }
  }
  const onRecordedKeyDown = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true || recording === undefined) {
      return
    }
    const element = previewElementFromEvent(event)
    if (element === undefined || !isJourneySubmitKey(event, element)) {
      return
    }
    flushRecordedInput(element)
    const target = recordedJourneyTarget(host, element)
    postRecordedStep(recording, target === undefined ? unresolvedRecordedStep('submit') : { kind: 'submit', ...target })
  }
  const onRecordedClick = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true || recording === undefined) {
      return
    }
    flushRecordedInput()
    const element = previewElementFromEvent(event)
    const target = element === undefined ? undefined : recordedJourneyTarget(host, element)
    postRecordedStep(recording, target === undefined ? unresolvedRecordedStep('press') : { kind: 'press', ...target })
  }

  const redrawOverlay = () => {
    const target = sourceTarget ?? hoverTarget ?? selectedTarget
    if (target === undefined) {
      if (overlay !== undefined) {
        overlay.style['display'] = 'none'
      }
      return
    }
    overlay ??= createOverlay(host)
    const rect = target.element.getBoundingClientRect()
    overlay.setAttribute(
      'data-tao-studio-overlay',
      sourceTarget !== undefined ? 'source' : hoverTarget !== undefined ? 'hover' : 'selection',
    )
    Object.assign(overlay.style, {
      display: 'block',
      height: `${Math.max(0, rect.height)}px`,
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${Math.max(0, rect.width)}px`,
    })
  }
  const onResize = () => {
    redrawOverlay()
    scheduleLayoutMeasurements()
  }

  const onClick = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true) {
      return
    }
    if (interactionMode === 'run') {
      return
    }
    blockAppPointerEvent(event)
    if (suppressNextClick) {
      suppressNextClick = false
      return
    }
    const target = renderTargetFromEvent(event)
    if (target === undefined) {
      return
    }
    hoverTarget = undefined
    sourceTarget = undefined
    selectedTarget = target
    redrawOverlay()
    postSourceMessage(host, config, 'preview-select-source', target.identity)
  }
  const onMouseDown = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true) {
      return
    }
    if (interactionMode === 'run') {
      return
    }
    blockAppPointerEvent(event)
    const target = renderTargetFromEvent(event)
    if (target === undefined || event.clientX === undefined || event.clientY === undefined) {
      return
    }
    drag = {
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      target,
    }
  }
  const onMouseMove = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true) {
      return
    }
    if (
      interactionMode === 'run'
      || drag === undefined
      || event.clientX === undefined
      || event.clientY === undefined
    ) {
      return
    }
    blockAppPointerEvent(event)
    const moved = drag.moved
      || Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) >= 6
    if (!moved) {
      return
    }
    const gap = bestRenderGap(host, event.clientX, event.clientY, drag.target)
    drag = { ...drag, gap, moved: true }
    dragOverlay ??= createDragOverlay(host, 'drag')
    positionOverlay(dragOverlay, drag.target.element.getBoundingClientRect())
    if (gap === undefined) {
      if (dropOverlay !== undefined) {
        dropOverlay.style['display'] = 'none'
      }
    } else {
      dropOverlay ??= createDragOverlay(host, 'drop')
      positionDropOverlay(dropOverlay, gap)
    }
  }
  const onMouseUp = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true) {
      return
    }
    if (interactionMode === 'run') {
      return
    }
    blockAppPointerEvent(event)
    const completed = drag
    disarmDrag()
    if (completed?.moved !== true) {
      return
    }
    suppressNextClick = true
    if (completed.gap !== undefined) {
      postMoveRenderAction(host, config, completed.target.identity, completed.gap)
    }
  }
  const onMouseOver = (event: StudioPreviewPointerEvent) => {
    if (event.taoStudioJourney === true) {
      return
    }
    if (interactionMode === 'run') {
      return
    }
    const target = renderTargetFromEvent(event)
    const key = target === undefined ? undefined : renderIdentityKey(target.identity)
    hoverTarget = target
    redrawOverlay()
    if (target !== undefined && key !== postedHoverKey) {
      postedHoverKey = key
      postSourceMessage(host, config, 'preview-hover-source', target.identity)
    }
  }
  const onMouseOut = () => {
    if (interactionMode === 'run') {
      return
    }
    hoverTarget = undefined
    postedHoverKey = undefined
    redrawOverlay()
  }
  const onMessage = (event: StudioPreviewMessageEvent) => {
    if (startOrStopRecording(event)) {
      return
    }
    const requestedMode = interactionModeFromMessage(event, config, host.parent)
    if (requestedMode !== undefined) {
      interactionMode = requestedMode
      if (interactionMode === 'run') {
        hoverTarget = undefined
        selectedTarget = undefined
        sourceTarget = undefined
        disarmDrag()
        overlay?.remove()
        overlay = undefined
      }
      return
    }
    const captureRequestId = captureRequestFromMessage(event, config, host.parent)
    if (captureRequestId !== undefined && captureFixture !== undefined) {
      void captureFixture().then(
        fixture => postCapturedFixture(host, config, captureRequestId, fixture),
        error => postCaptureFailure(host, config, captureRequestId, error),
      )
      return
    }
    const runtimeCaptureRequestId = runtimeCaptureRequestFromMessage(event, config, host.parent)
    if (runtimeCaptureRequestId !== undefined) {
      void captureRuntime().then(
        capture => postRuntimeCapture(host, config, runtimeCaptureRequestId, capture),
        error => postRuntimeCaptureFailure(host, config, runtimeCaptureRequestId, error),
      )
      return
    }
    const selection = highlightSelectionFromMessage(event, config, host.parent)
    if (selection === undefined) {
      return
    }
    sourceTarget = selection.range === undefined
      ? undefined
      : sourceHighlightTarget(host, selection.path, selection.range)
    redrawOverlay()
  }

  host.document.addEventListener('click', onClick, true)
  host.document.addEventListener('click', onRecordedClick, true)
  host.document.addEventListener('input', onRecordedInput, true)
  host.document.addEventListener('blur', onRecordedBlur, true)
  host.document.addEventListener('keydown', onRecordedKeyDown, true)
  host.document.addEventListener('mousedown', onMouseDown, true)
  host.document.addEventListener('mouseleave', disarmDrag)
  host.document.addEventListener('mousemove', onMouseMove, true)
  host.document.addEventListener('mouseover', onMouseOver)
  host.document.addEventListener('mouseout', onMouseOut)
  host.document.addEventListener('mouseup', onMouseUp, true)
  host.window.addEventListener('blur', disarmDrag)
  host.window.addEventListener('message', onMessage)
  host.window.addEventListener('resize', onResize)
  host.window.addEventListener('scroll', redrawOverlay)
  postAppliedRevision(host, config)
  scheduleLayoutMeasurements()
  const stopFailures = onRuntimeFailure(capture => {
    host.parent.postMessage({
      capture,
      channel: studioProtocolChannel,
      identity: previewIdentity(config),
      protocolVersion: studioProtocolVersion,
      type: 'preview-runtime-failure',
    }, config.parentOrigin)
  })
  const restoreConsole = forwardPreviewConsole(host, config)

  return () => {
    stopped = true
    if (recording !== undefined) {
      const invalidatedRecording = recording
      flushRecordedInput()
      recording = undefined
      postRecordingState(invalidatedRecording, 'invalidated')
    }
    restoreConsole()
    stopFailures()
    host.document.removeEventListener('click', onClick, true)
    host.document.removeEventListener('click', onRecordedClick, true)
    host.document.removeEventListener('input', onRecordedInput, true)
    host.document.removeEventListener('blur', onRecordedBlur, true)
    host.document.removeEventListener('keydown', onRecordedKeyDown, true)
    host.document.removeEventListener('mousedown', onMouseDown, true)
    host.document.removeEventListener('mouseleave', disarmDrag)
    host.document.removeEventListener('mousemove', onMouseMove, true)
    host.document.removeEventListener('mouseover', onMouseOver)
    host.document.removeEventListener('mouseout', onMouseOut)
    host.document.removeEventListener('mouseup', onMouseUp, true)
    host.window.removeEventListener('blur', disarmDrag)
    host.window.removeEventListener('message', onMessage)
    host.window.removeEventListener('resize', onResize)
    host.window.removeEventListener('scroll', redrawOverlay)
    overlay?.remove()
    disarmDrag()
  }
}

/** collectStudioPreviewLayoutMeasurements reads mounted render geometry relative to the cell content root. */
export function collectStudioPreviewLayoutMeasurements(
  elements: ArrayLike<StudioPreviewElement>,
  rootRect: StudioPreviewRect,
): readonly StudioPreviewLayoutMeasurement[] {
  const measurements: StudioPreviewLayoutMeasurement[] = []
  const renderIds = new Set<string>()
  for (const element of Array.from(elements)) {
    const target = renderTargetFromElement(element)
    if (target === undefined || target.identity.elementName === undefined) {
      continue
    }
    const rect = element.getBoundingClientRect()
    const measurement = {
      height: rect.height,
      width: rect.width,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
    }
    const id = renderId(target.identity)
    if (
      renderIds.has(id)
      || Object.values(measurement).some(value => !Number.isFinite(value) || value < 0)
    ) {
      continue
    }
    renderIds.add(id)
    measurements.push({
      elementName: target.identity.elementName,
      rect: measurement,
      renderId: id,
      ...(target.identity.studioRectId === undefined ? {} : { studioRectId: target.identity.studioRectId }),
    })
  }
  return measurements
}

function forwardPreviewConsole(host: StudioPreviewHost, config: StudioPreviewConfig): () => void {
  if (host.console === undefined) {
    return () => {}
  }
  const restorers: Array<() => void> = []
  for (const level of ['debug', 'error', 'info', 'log', 'warn'] as const) {
    const original = host.console[level]
    if (original === undefined) {
      continue
    }
    const forwarded = (...arguments_: unknown[]): void => {
      original(...arguments_)
      const captured = captureArguments(arguments_)
      host.parent.postMessage({
        arguments: Array.isArray(captured) ? captured : [captured],
        channel: studioProtocolChannel,
        identity: previewIdentity(config),
        level,
        protocolVersion: studioProtocolVersion,
        timestamp: Date.now(),
        type: 'preview-console',
      }, config.parentOrigin)
    }
    host.console[level] = forwarded
    restorers.push(() => {
      if (host.console?.[level] === forwarded) {
        host.console[level] = original
      }
    })
  }
  return () => {
    for (const restore of restorers) {
      restore()
    }
  }
}

function blockAppPointerEvent(event: StudioPreviewPointerEvent): void {
  event.preventDefault?.()
  event.stopImmediatePropagation?.()
  event.stopPropagation?.()
}

function interactionModeFromMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): 'edit' | 'run' | undefined {
  if (event.origin !== config.parentOrigin || event.source !== parent || !isObject(event.data)) {
    return undefined
  }
  const message = event.data
  const identity = message['identity']
  const mode = message['mode']
  return message['channel'] === studioProtocolChannel
      && message['protocolVersion'] === studioProtocolVersion
      && message['type'] === 'set-interaction-mode'
      && (mode === 'edit' || mode === 'run')
      && isObject(identity)
      && identity['appName'] === config.appName
      && identity['project'] === config.project
      && identity['previewInstanceId'] === config.previewInstanceId
    ? mode
    : undefined
}

function recordingControlFromMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): Readonly<{ active: boolean; captureSensitiveText: boolean; recordingId: string }> | undefined {
  if (
    event.origin !== config.parentOrigin
    || event.source !== parent
    || config.cellId === undefined
    || config.cellRevision === undefined
    || config.manifestRevision === undefined
    || !isObject(event.data)
  ) {
    return undefined
  }
  const message = event.data
  const identity = message['identity']
  if (
    message['channel'] !== studioProtocolChannel
    || message['protocolVersion'] !== studioProtocolVersion
    || message['type'] !== 'set-journey-recording'
    || typeof message['active'] !== 'boolean'
    || typeof message['recordingId'] !== 'string'
    || message['recordingId'].trim() === ''
    || (message['captureSensitiveText'] !== undefined && typeof message['captureSensitiveText'] !== 'boolean')
    || !isObject(identity)
    || identity['appName'] !== config.appName
    || identity['project'] !== config.project
    || identity['previewInstanceId'] !== config.previewInstanceId
    || identity['cellId'] !== config.cellId
    || identity['cellRevision'] !== config.cellRevision
    || identity['compileRevision'] !== config.compileRevision
    || identity['manifestRevision'] !== config.manifestRevision
  ) {
    return undefined
  }
  return {
    active: message['active'],
    captureSensitiveText: message['captureSensitiveText'] === true,
    recordingId: message['recordingId'],
  }
}

function previewElementFromEvent(event: StudioPreviewPointerEvent): StudioPreviewElement | undefined {
  const target = event.target
  return isObject(target)
      && typeof target['getAttribute'] === 'function'
      && typeof target['getBoundingClientRect'] === 'function'
    ? target as unknown as StudioPreviewElement
    : undefined
}

function isJourneySubmitKey(event: StudioPreviewPointerEvent, element: StudioPreviewElement): boolean {
  if (event.key !== 'Enter' || event.isComposing === true || event.repeat === true) {
    return false
  }
  const tagName = element.tagName?.toLowerCase()
  const role = element.getAttribute('role')?.toLowerCase()
  if (
    tagName === 'button'
    || role === 'button'
    || tagName === 'textarea'
    || element.getAttribute('aria-multiline') === 'true'
    || element.getAttribute('contenteditable') === 'true'
  ) {
    return false
  }
  if (tagName === 'input') {
    const type = element.getAttribute('type')?.toLowerCase() ?? 'text'
    return !['button', 'checkbox', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type)
  }
  return role === 'textbox'
}

/** recordedJourneyTarget chooses only selectors the Tao journey runtime can resolve uniquely later. */
function recordedJourneyTarget(
  host: StudioPreviewHost,
  startingElement: StudioPreviewElement,
): StudioRecordedJourneyTarget | undefined {
  let element: StudioPreviewElement | null | undefined = startingElement
  while (element !== undefined && element !== null) {
    const candidates: StudioRecordedJourneyTarget[] = []
    const tag = element.getAttribute('data-testid')?.trim()
    if (tag !== undefined && /^[A-Za-z0-9_]+$/.test(tag)) {
      candidates.push({ selector: 'tag', target: tag })
    }
    const label = element.getAttribute('aria-label')?.trim()
    if (label !== undefined && label !== '') {
      candidates.push({ selector: 'label', target: label })
    }
    const placeholder = element.getAttribute('placeholder')?.trim()
    if (placeholder !== undefined && placeholder !== '') {
      candidates.push({ selector: 'placeholder', target: placeholder })
    }
    const text = element.textContent?.trim()
    if (text !== undefined && text !== '') {
      candidates.push({ selector: 'text', target: text })
    }
    const unique = candidates.find(candidate =>
      findJourneyTargets(host, candidate.selector, candidate.target).length === 1
    )
    if (unique !== undefined) {
      return unique
    }
    element = element.parentElement
  }
  return undefined
}

function isSensitiveJourneyInput(element: StudioPreviewElement): boolean {
  if (element.getAttribute('data-tao-sensitive') === 'true' || element.getAttribute('type') === 'password') {
    return true
  }
  const autocomplete = element.getAttribute('autocomplete')?.toLowerCase().split(/\s+/) ?? []
  return autocomplete.some(token =>
    token === 'current-password'
    || token === 'new-password'
    || token === 'one-time-code'
    || token.startsWith('cc-')
  )
}

function unresolvedRecordedStep(action: 'enter' | 'press' | 'submit'): Readonly<Record<string, unknown>> {
  return {
    action,
    kind: 'unresolved',
    reason: 'No unique Tao tag, accessibility label, placeholder, or visible text identifies this target.',
  }
}

function captureRequestFromMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): string | undefined {
  if (event.origin !== config.parentOrigin || event.source !== parent || !isObject(event.data)) {
    return undefined
  }
  const message = event.data
  const identity = message['identity']
  return message['channel'] === studioProtocolChannel
      && message['protocolVersion'] === studioProtocolVersion
      && message['type'] === 'capture-fixture'
      && nonEmptyValue(message['requestId'])
      && isObject(identity)
      && identity['appName'] === config.appName
      && identity['project'] === config.project
      && identity['previewInstanceId'] === config.previewInstanceId
    ? message['requestId']
    : undefined
}

function runtimeCaptureRequestFromMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): string | undefined {
  if (event.origin !== config.parentOrigin || event.source !== parent || !isObject(event.data)) {
    return undefined
  }
  const message = event.data
  const identity = message['identity']
  return message['channel'] === studioProtocolChannel
      && message['protocolVersion'] === studioProtocolVersion
      && message['type'] === 'capture-runtime'
      && nonEmptyValue(message['requestId'])
      && isObject(identity)
      && identity['appName'] === config.appName
      && identity['project'] === config.project
      && identity['previewInstanceId'] === config.previewInstanceId
    ? message['requestId']
    : undefined
}

function postRuntimeCapture(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  requestId: string,
  capture: TaoRuntimeCaptureArtifact,
): void {
  host.parent.postMessage({
    capture,
    channel: studioProtocolChannel,
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    requestId,
    type: 'preview-runtime-captured',
  }, config.parentOrigin)
}

function postRuntimeCaptureFailure(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  requestId: string,
  error: unknown,
): void {
  host.parent.postMessage({
    channel: studioProtocolChannel,
    error: error instanceof Error ? error.message : String(error),
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    requestId,
    type: 'preview-runtime-capture-failed',
  }, config.parentOrigin)
}

function postCapturedFixture(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  requestId: string,
  fixture: TaoStudioFixturePlan,
): void {
  host.parent.postMessage({
    channel: studioProtocolChannel,
    fixture,
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    requestId,
    type: 'preview-fixture-captured',
  }, config.parentOrigin)
}

function postCaptureFailure(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  requestId: string,
  error: unknown,
): void {
  host.parent.postMessage({
    channel: studioProtocolChannel,
    error: error instanceof Error ? error.message : String(error),
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    requestId,
    type: 'preview-fixture-capture-failed',
  }, config.parentOrigin)
}

function browserPreviewHost(): StudioPreviewHost | undefined {
  const value = globalThis as unknown as Partial<StudioPreviewHost> & { parent?: StudioPreviewHost['parent'] }
  if (value.document === undefined || value.parent === undefined || value.parent === (globalThis as unknown)) {
    return undefined
  }
  return {
    console: value.console,
    document: value.document,
    parent: value.parent,
    window: value as StudioPreviewHost['window'],
  }
}

function validPreviewConfig(config: StudioPreviewConfig): boolean {
  return nonEmpty(config.appName)
    && nonEmpty(config.previewInstanceId)
    && nonEmpty(config.project)
    && Number.isSafeInteger(config.compileRevision)
    && config.compileRevision >= 0
    && exactWebOrigin(config.parentOrigin)
    && Object.entries(config.sourceVersions).every(([path, version]) => nonEmpty(path) && nonEmpty(version))
    && validCellIdentity(config)
}

function validCellIdentity(config: StudioPreviewConfig): boolean {
  const values = [config.cellId, config.cellRevision, config.manifestRevision]
  if (values.every(value => value === undefined)) {
    return true
  }
  return nonEmptyValue(config.cellId)
    && Number.isSafeInteger(config.cellRevision)
    && (config.cellRevision ?? -1) >= 0
    && nonEmptyValue(config.manifestRevision)
}

function exactWebOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
  } catch {
    return false
  }
}

function postAppliedRevision(host: StudioPreviewHost, config: StudioPreviewConfig): void {
  host.parent.postMessage({
    appliedRevision: config.compileRevision,
    channel: studioProtocolChannel,
    compileRevision: config.compileRevision,
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    type: 'preview-applied',
  }, config.parentOrigin)
}

function postSourceMessage(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  type: 'preview-hover-source' | 'preview-select-source',
  occurrence: TaoStudioIdentity,
): void {
  const sourceVersion = sourceVersionFor(config, occurrence.sourcePath)
  if (sourceVersion === undefined) {
    return
  }
  host.parent.postMessage({
    channel: studioProtocolChannel,
    identity: {
      ...previewIdentity(config),
      occurrence: sourceActionOccurrence(occurrence),
      path: occurrence.sourcePath,
      sourceVersion,
    },
    protocolVersion: studioProtocolVersion,
    range: { end: occurrence.end, start: occurrence.start },
    type,
  }, config.parentOrigin)
}

function postMoveRenderAction(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  dragged: TaoStudioIdentity,
  gap: StudioRenderGap,
): void {
  const sourceVersion = sourceVersionFor(config, dragged.sourcePath)
  const anchors = [gap.after, gap.before].filter((anchor): anchor is StudioRenderTarget => anchor !== undefined)
  if (
    sourceVersion === undefined
    || anchors.length === 0
    || anchors.some(anchor => normalizePath(anchor.identity.sourcePath) !== normalizePath(dragged.sourcePath))
  ) {
    return
  }
  const requestId = `preview-${config.previewInstanceId}-${nextStudioSourceActionId++}`
  host.parent.postMessage({
    action: {
      ...(gap.after === undefined ? {} : { afterId: renderId(gap.after.identity) }),
      ...(gap.before === undefined ? {} : { beforeId: renderId(gap.before.identity) }),
      draggedId: renderId(dragged),
      kind: 'move-render',
    },
    channel: studioProtocolChannel,
    checkpoint: { id: requestId, phase: 'single' },
    identity: {
      ...previewIdentity(config),
      occurrence: sourceActionOccurrence(dragged),
      path: dragged.sourcePath,
      sourceVersion,
    },
    protocolVersion: studioProtocolVersion,
    requestId,
    sourceActionVersion: studioSourceActionVersion,
    type: 'source-action',
  }, config.parentOrigin)
}

function sourceActionOccurrence(identity: TaoStudioIdentity): {
  nodeKind: TaoStudioIdentity['kind']
  renderOwner?: string
} {
  return {
    nodeKind: identity.kind,
    ...(identity.ownerName ? { renderOwner: identity.ownerName } : {}),
  }
}

function previewIdentity(config: StudioPreviewConfig): {
  appName: string
  cellId?: string
  cellRevision?: number
  compileRevision?: number
  manifestRevision?: string
  previewInstanceId: string
  project: string
} {
  return {
    appName: config.appName,
    ...(config.cellId === undefined
      ? {}
      : {
        cellId: config.cellId,
        cellRevision: config.cellRevision,
        compileRevision: config.compileRevision,
        manifestRevision: config.manifestRevision,
      }),
    previewInstanceId: config.previewInstanceId,
    project: config.project,
  }
}

function highlightSelectionFromMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): { path: string; range: StudioSourceRange | undefined } | undefined {
  if (event.origin !== config.parentOrigin || event.source !== parent || !isObject(event.data)) {
    return undefined
  }
  const message = event.data
  if (
    message['channel'] !== studioProtocolChannel
    || message['protocolVersion'] !== studioProtocolVersion
    || message['type'] !== 'highlight-source'
    || !isObject(message['identity'])
  ) {
    return undefined
  }
  const identity = message['identity']
  if (
    identity['appName'] !== config.appName
    || identity['previewInstanceId'] !== config.previewInstanceId
    || identity['project'] !== config.project
    || !nonEmptyValue(identity['path'])
    || !nonEmptyValue(identity['sourceVersion'])
    || sourceVersionFor(config, identity['path']) !== identity['sourceVersion']
  ) {
    return undefined
  }
  const range = message['range'] === undefined ? undefined : sourceRange(message['range'])
  return message['range'] !== undefined && range === undefined ? undefined : { path: identity['path'], range }
}

function sourceHighlightTarget(
  host: StudioPreviewHost,
  sourcePath: string,
  range: StudioSourceRange,
): StudioRenderTarget | undefined {
  return Array.from(host.document.querySelectorAll(studioRenderSelector))
    .map(renderTargetFromElement)
    .filter((target): target is StudioRenderTarget => target !== undefined)
    .filter(target => sourceRangeMatches(sourcePath, range, target.identity))
    .sort((left, right) => sourceSpan(left.identity) - sourceSpan(right.identity))[0]
}

function renderTargetFromEvent(event: StudioPreviewPointerEvent): StudioRenderTarget | undefined {
  const element = isStudioElement(event.target) ? event.target : undefined
  return renderTargetFromElement(element?.closest?.(studioRenderSelector) ?? element)
}

function renderTargetFromElement(element: StudioPreviewElement | null | undefined): StudioRenderTarget | undefined {
  if (element === undefined || element === null) {
    return undefined
  }
  const raw = element.getAttribute('data-tao-studio')
  if (raw === null) {
    return undefined
  }
  try {
    const identity = JSON.parse(raw) as unknown
    return isStudioIdentity(identity) ? { element, identity } : undefined
  } catch {
    return undefined
  }
}

function isStudioIdentity(value: unknown): value is TaoStudioIdentity {
  return isObject(value)
    && value['kind'] === 'render'
    && nonEmptyValue(value['sourcePath'])
    && nonNegativeInteger(value['start']) !== undefined
    && nonNegativeInteger(value['end']) !== undefined
    && (value['start'] as number) <= (value['end'] as number)
    && (value['ownerName'] === undefined || nonEmptyValue(value['ownerName']))
    && (value['elementName'] === undefined || nonEmptyValue(value['elementName']))
    && (value['studioRectId'] === undefined || nonEmptyValue(value['studioRectId']))
}

function sourceRange(value: unknown): StudioSourceRange | undefined {
  if (!isObject(value)) {
    return undefined
  }
  const start = nonNegativeInteger(value['start'])
  const end = nonNegativeInteger(value['end'])
  return start !== undefined && end !== undefined && start <= end ? { end, start } : undefined
}

function sourceRangeMatches(sourcePath: string, range: StudioSourceRange, identity: TaoStudioIdentity): boolean {
  if (normalizePath(sourcePath) !== normalizePath(identity.sourcePath)) {
    return false
  }
  if (range.start === range.end) {
    return identity.start <= range.start && range.start <= identity.end
  }
  return range.start < identity.end && range.end > identity.start
}

function sourceVersionFor(config: StudioPreviewConfig, sourcePath: string): string | undefined {
  const direct = config.sourceVersions[sourcePath]
  if (direct !== undefined) {
    return direct
  }
  const normalized = normalizePath(sourcePath)
  return Object.entries(config.sourceVersions).find(([path]) => normalizePath(path) === normalized)?.[1]
}

function createOverlay(host: StudioPreviewHost): StudioPreviewOverlay {
  const overlay = host.document.createElement('div')
  Object.assign(overlay.style, {
    border: '2px solid #2563eb',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: '2147483647',
  })
  host.document.body?.appendChild(overlay)
  return overlay
}

function createDragOverlay(host: StudioPreviewHost, kind: 'drag' | 'drop'): StudioPreviewOverlay {
  const overlay = host.document.createElement('div')
  overlay.setAttribute('data-tao-studio-drag-overlay', kind)
  Object.assign(overlay.style, {
    background: kind === 'drag' ? 'rgba(37, 99, 235, 0.12)' : '#f3c969',
    border: kind === 'drag' ? '2px dashed #2563eb' : 'none',
    boxSizing: 'border-box',
    opacity: kind === 'drag' ? '0.75' : '1',
    pointerEvents: 'none',
    position: 'fixed',
    zIndex: '2147483647',
  })
  host.document.body?.appendChild(overlay)
  return overlay
}

function positionOverlay(overlay: StudioPreviewOverlay, rect: StudioPreviewRect): void {
  Object.assign(overlay.style, {
    display: 'block',
    height: `${Math.max(0, rect.height)}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(0, rect.width)}px`,
  })
}

function positionDropOverlay(overlay: StudioPreviewOverlay, gap: StudioRenderGap): void {
  const after = gap.after?.element.getBoundingClientRect()
  const before = gap.before?.element.getBoundingClientRect()
  if (after === undefined || before === undefined) {
    const reference = after ?? before
    if (reference === undefined) {
      overlay.style['display'] = 'none'
      return
    }
    if (gap.horizontal) {
      Object.assign(overlay.style, {
        display: 'block',
        height: `${Math.max(reference.height, 16)}px`,
        left: `${after === undefined ? reference.left : reference.left + reference.width}px`,
        top: `${reference.top}px`,
        width: '3px',
      })
      return
    }
    Object.assign(overlay.style, {
      display: 'block',
      height: '3px',
      left: `${reference.left}px`,
      top: `${after === undefined ? reference.top : reference.top + reference.height}px`,
      width: `${Math.max(reference.width, 24)}px`,
    })
    return
  }
  if (gap.horizontal) {
    const left = after.left + after.width + (before.left - after.left - after.width) / 2
    Object.assign(overlay.style, {
      display: 'block',
      height: `${Math.max(after.height, before.height, 16)}px`,
      left: `${left}px`,
      top: `${Math.min(after.top, before.top)}px`,
      width: '3px',
    })
    return
  }
  const top = after.top + after.height + (before.top - after.top - after.height) / 2
  Object.assign(overlay.style, {
    display: 'block',
    height: '3px',
    left: `${Math.min(after.left, before.left)}px`,
    top: `${top}px`,
    width: `${Math.max(after.width, before.width, 24)}px`,
  })
}

function bestRenderGap(
  host: StudioPreviewHost,
  x: number,
  y: number,
  dragged: StudioRenderTarget,
): StudioRenderGap | undefined {
  const groups = new Map<string, StudioRenderTarget[]>()
  for (const target of allRenderTargets(host)) {
    const parent = target.element.parentElement?.closest?.(studioRenderSelector)
    const parentTarget = renderTargetFromElement(parent)
    const key = parentTarget === undefined ? 'root' : renderIdentityKey(parentTarget.identity)
    groups.set(key, [...(groups.get(key) ?? []), target])
  }
  let best: StudioRenderGap | undefined
  for (const targets of groups.values()) {
    if (
      targets.some(target =>
        renderIdentityKey(target.identity) !== renderIdentityKey(dragged.identity)
        && dragged.element.contains?.(target.element)
      )
    ) {
      continue
    }
    const candidates = targets.filter(target =>
      renderIdentityKey(target.identity) !== renderIdentityKey(dragged.identity)
      && normalizePath(target.identity.sourcePath) === normalizePath(dragged.identity.sourcePath)
      && target.identity.ownerName === dragged.identity.ownerName
    )
    if (candidates.length < 1) {
      continue
    }
    const horizontal = renderFlowIsHorizontal(candidates)
    const sorted = candidates.toSorted((left, right) =>
      renderCenter(left.element.getBoundingClientRect(), horizontal)
      - renderCenter(right.element.getBoundingClientRect(), horizontal)
    )
    const first = sorted[0]!
    best = nearerGap(best, {
      before: first,
      distance: Math.abs((horizontal ? x : y) - renderStart(first.element.getBoundingClientRect(), horizontal)),
      horizontal,
    })
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const after = sorted[index]!
      const before = sorted[index + 1]!
      const midpoint = (
        renderCenter(after.element.getBoundingClientRect(), horizontal)
        + renderCenter(before.element.getBoundingClientRect(), horizontal)
      ) / 2
      const distance = Math.abs((horizontal ? x : y) - midpoint)
      best = nearerGap(best, { after, before, distance, horizontal })
    }
    const last = sorted.at(-1)!
    best = nearerGap(best, {
      after: last,
      distance: Math.abs((horizontal ? x : y) - renderEnd(last.element.getBoundingClientRect(), horizontal)),
      horizontal,
    })
  }
  return best
}

function nearerGap(current: StudioRenderGap | undefined, candidate: StudioRenderGap): StudioRenderGap {
  return current === undefined || candidate.distance < current.distance ? candidate : current
}

function allRenderTargets(host: StudioPreviewHost): StudioRenderTarget[] {
  return Array.from(host.document.querySelectorAll(studioRenderSelector))
    .map(renderTargetFromElement)
    .filter((target): target is StudioRenderTarget => target !== undefined)
}

function renderFlowIsHorizontal(targets: readonly StudioRenderTarget[]): boolean {
  const rects = targets.map(target => target.element.getBoundingClientRect())
  const x = rects.map(rect => rect.left + rect.width / 2)
  const y = rects.map(rect => rect.top + rect.height / 2)
  return Math.max(...x) - Math.min(...x) > Math.max(...y) - Math.min(...y)
}

function renderCenter(rect: StudioPreviewRect, horizontal: boolean): number {
  return horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2
}

function renderStart(rect: StudioPreviewRect, horizontal: boolean): number {
  return horizontal ? rect.left : rect.top
}

function renderEnd(rect: StudioPreviewRect, horizontal: boolean): number {
  return horizontal ? rect.left + rect.width : rect.top + rect.height
}

function renderId(identity: TaoStudioIdentity): string {
  return `${identity.sourcePath}:${identity.start}:${identity.end}`
}

function renderIdentityKey(identity: TaoStudioIdentity): string {
  return `${identity.sourcePath}:${identity.start}:${identity.end}`
}

function sourceSpan(identity: TaoStudioIdentity): number {
  return Math.max(0, identity.end - identity.start)
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function nonEmptyValue(value: unknown): value is string {
  return typeof value === 'string' && nonEmpty(value)
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

// Mirrors `isRecord` in packages/shared/shared-src/core/Json.ts; `runtime-mirrors.test.ts` keeps them in step.
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStudioElement(value: unknown): value is StudioPreviewElement {
  return isObject(value)
    && typeof value['getAttribute'] === 'function'
    && typeof value['getBoundingClientRect'] === 'function'
}
