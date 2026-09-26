import React from 'react'
import { Arrays } from './core/RuntimeCore'
import { RuntimeAssert } from './TR-assert'
import { createElement } from './TR-create-element'
import { Debug, type TaoDebugStep } from './TR-debug'
import { captureArguments, onRuntimeFailure } from './TR-error-containment'
import { HostEnvironmentError, UnexpectedBehaviorError, UserInputError } from './TR-errors'
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
import { StudioLensHost, type TaoStudioLensRenderSample } from './TR-studio-lens'
import { TaoStudioProtocolVersions } from './TR-studio-protocol'
import RuntimeSwitch from './TR-switch'
import type { TaoStudioIdentity } from './TR-TaoProps'
import { Clock } from './TR-units'

const studioProtocolChannel = TaoStudioProtocolVersions.channel
const studioProtocolVersion = TaoStudioProtocolVersions.protocolVersion
const studioSourceActionVersion = TaoStudioProtocolVersions.sourceActionVersion
const studioRenderSelector = '[data-tao-studio]'

type StudioPreviewDiagnostic = { at: number; detail?: string; stage: string }
type StudioPreviewDiagnosticHost = typeof globalThis & {
  __taoStudioPreviewDiagnostics?: StudioPreviewDiagnostic[]
}

function recordStudioPreviewStage(stage: string, detail?: string): void {
  if (requireReactNativeRuntime().Platform?.OS !== 'web') {
    return
  }
  const host = globalThis as StudioPreviewDiagnosticHost
  const events = host.__taoStudioPreviewDiagnostics ??= []
  events.push({ at: Date.now(), ...(detail === undefined ? {} : { detail }), stage })
  if (events.length > 60) {
    events.splice(0, events.length - 60)
  }
}

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
  /** Clears a previously caught failure when Studio accepts a newer preview without remounting
   * healthy children while revisions advance. */
  resetKey?: string
}

type StudioPreviewErrorBoundaryState = {
  error?: unknown
  resetKey?: string
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
  ctrlKey?: boolean
  deltaX?: number
  deltaY?: number
  isComposing?: boolean
  key?: string
  metaKey?: boolean
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

/** The document events this bridge listens for; registration and removal name the same set. */
type StudioPreviewDocumentEvent =
  | 'auxclick'
  | 'blur'
  | 'click'
  | 'contextmenu'
  | 'dblclick'
  | 'dragstart'
  | 'input'
  | 'keydown'
  | 'keyup'
  | 'mousedown'
  | 'mouseenter'
  | 'mouseleave'
  | 'mousemove'
  | 'mouseover'
  | 'mouseout'
  | 'mouseup'
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerout'
  | 'pointerover'
  | 'pointerup'
  | 'scroll'
  | 'wheel'

type StudioPreviewWindowEvent = 'blur' | 'message' | 'resize' | 'scroll'

type StudioPreviewDocumentListener = (
  type: StudioPreviewDocumentEvent,
  listener: (event: StudioPreviewPointerEvent) => void,
  capture?: boolean,
) => void

type StudioPreviewWindowListener = (
  type: StudioPreviewWindowEvent,
  listener: (event: StudioPreviewMessageEvent) => void,
) => void

export type StudioPreviewHost = {
  console?: Partial<Record<StudioPreviewLogLevel, (...arguments_: unknown[]) => void>>
  document: {
    addEventListener: StudioPreviewDocumentListener
    body?: {
      appendChild(element: StudioPreviewOverlay): void
      getBoundingClientRect?(): StudioPreviewRect
    }
    createElement(name: 'div'): StudioPreviewOverlay
    querySelectorAll(selector: string): ArrayLike<StudioPreviewElement>
    removeEventListener: StudioPreviewDocumentListener
  }
  parent: {
    postMessage(message: unknown, targetOrigin: string): void
  }
  window: {
    addEventListener: StudioPreviewWindowListener
    getComputedStyle?: (element: StudioPreviewElement) => { getPropertyValue(property: string): string }
    removeEventListener: StudioPreviewWindowListener
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
  viewportRect?: { height: number; width: number; x: number; y: number }
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
  override state: StudioPreviewErrorBoundaryState = { resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Pick<StudioPreviewErrorBoundaryState, 'error'> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: StudioPreviewErrorBoundaryProps,
    state: StudioPreviewErrorBoundaryState,
  ): StudioPreviewErrorBoundaryState | null {
    return props.resetKey === state.resetKey ? null : { error: undefined, resetKey: props.resetKey }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(error)
  }

  override render(): React.ReactNode {
    return this.state.error === undefined
      ? this.props.children
      : createElement(StudioPreviewFailure, { error: this.state.error })
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
  return createElement(
    RN.View,
    {
      accessibilityRole: 'alert',
      style: { backgroundColor, flex: 1, gap: 8, minHeight: '100%', padding: 20 },
    },
    createElement(RN.Text, { style: { color, fontSize: 18, fontWeight: '700' } }, title),
    createElement(
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

type StudioBootstrapIdentity = Readonly<{ appName: string; compileRevision: number; project: string }>
const maxStudioBootstrapRetries = 30
const publicationRetryParameter = 'taoStudioPublicationRetry'
const publicationRetryRevisionParameter = 'taoStudioPublicationRetryRevision'

function nextStudioPublicationReload(
  currentUrl: string,
  revision: number,
): { attempt: number; url: string } | undefined {
  const url = new URL(currentUrl)
  const previousRevision = Number(url.searchParams.get(publicationRetryRevisionParameter))
  const attempts = previousRevision === revision
    ? Number(url.searchParams.get(publicationRetryParameter) ?? '0')
    : 0
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= maxStudioBootstrapRetries) {
    return undefined
  }
  const attempt = attempts + 1
  url.searchParams.set(publicationRetryParameter, String(attempt))
  url.searchParams.set(publicationRetryRevisionParameter, String(revision))
  return { attempt, url: url.toString() }
}

function clearStudioPublicationRetry(currentUrl: string): string {
  const url = new URL(currentUrl)
  url.searchParams.delete(publicationRetryParameter)
  url.searchParams.delete(publicationRetryRevisionParameter)
  return url.toString()
}

function olderStudioBootstrapRetryDelay(attempt: number): number | undefined {
  return Number.isInteger(attempt) && attempt > 0 && attempt <= maxStudioBootstrapRetries
    ? Math.min(200 * attempt, 1_000)
    : undefined
}

/** A reloaded frame can receive a newer cell before Metro serves its matching publication. */
function reconcileStudioCellBootstrap(
  runtime: { identity?: Partial<StudioBootstrapIdentity> } | null | undefined,
  publication: StudioBootstrapIdentity,
  onNewerPublication: (revision: number) => void,
): 'matched' | 'older' | 'newer' | 'incompatible' {
  const identity = runtime?.identity
  if (
    identity?.appName !== publication.appName || identity.project !== publication.project
    || typeof identity.compileRevision !== 'number'
  ) {
    return 'incompatible'
  }
  if (identity.compileRevision === publication.compileRevision) {
    return 'matched'
  }
  if (identity.compileRevision < publication.compileRevision) {
    return 'older'
  }
  onNewerPublication(identity.compileRevision)
  return 'newer'
}

/** StudioPreview exposes the opt-in generated preview bridge. */
export const StudioPreview = {
  Bootstrap: {
    clearPublicationRetry: clearStudioPublicationRetry,
    nextPublicationReload: nextStudioPublicationReload,
    olderRetryDelay: olderStudioBootstrapRetryDelay,
    reconcile: reconcileStudioCellBootstrap,
  },
  Diagnostics: { record: recordStudioPreviewStage },
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
    recordStudioPreviewStage(
      'replay-effect-start',
      artifact === undefined
        ? 'no replay'
        : artifact.domains.map(domain => domain.domain).join(','),
    )
    if (artifact === undefined) {
      setReady(true)
      return () => {
        active = false
      }
    }
    setReady(false)
    void restoreRuntimeCapture(artifact, (domain, stage) => {
      recordStudioPreviewStage(`replay-domain-${stage}`, domain)
    }).then(
      () => {
        recordStudioPreviewStage(active ? 'replay-ready' : 'replay-completed-after-superseded')
        if (active) {
          setReady(true)
        }
      },
      replayError => {
        recordStudioPreviewStage('replay-error', previewErrorMessage(replayError))
        if (active) {
          setError(replayError)
        }
      },
    )
    return () => {
      active = false
      recordStudioPreviewStage('replay-effect-superseded')
    }
  }, [replayKey])
  if (error !== undefined) {
    return createElement(StudioPreviewFailure, { error })
  }
  return ready ? createElement(React.Fragment, null, props.children) : createElement(StudioPreviewPending)
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
  const publishLens = React.useCallback((sample: TaoStudioLensRenderSample) => {
    const host = browserPreviewHost()
    const sourceVersion = sourceVersionFor(props.config, sample.identity.sourcePath)
    if (host !== undefined && sourceVersion !== undefined) {
      postToStudio(host, props.config, 'preview-lens-render', {
        sample: {
          ...sample,
          resolvedStyle: resolvedStudioStyle(host, sample.identity),
          sourceVersion,
        },
      })
    }
  }, [props.config])
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
    return createElement(StudioPreviewFailure, { error: journeyError })
  }
  return createElement(StudioLensHost, { publish: publishLens }, props.children)
}

/** Reads the browser's final public CSS values after React commits the selected occurrence. */
export function resolvedStudioStyle(
  host: StudioPreviewHost,
  identity: TaoStudioIdentity,
): Readonly<Record<string, string>> | undefined {
  if (host.window.getComputedStyle === undefined) {
    return undefined
  }
  const elements = allRenderTargets(host)
    .filter(target => renderId(target.identity) === renderId(identity))
    .map(target => target.element)
  if (elements.length === 0) {
    return undefined
  }
  const properties = [
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
  ]
  const styles = elements.map(element => {
    const computed = host.window.getComputedStyle!(element)
    const values = properties.flatMap(property => {
      const value = computed.getPropertyValue(property).trim()
      return value.length > 0 && value.length <= 128 ? [[property, value] as const] : []
    })
    return Object.fromEntries(values) as Readonly<Record<string, string>>
  })
  const first = styles[0]!
  return Object.keys(first).length > 0
      && styles.every(style => properties.every(property => style[property] === first[property]))
    ? first
    : undefined
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
        return await findJourneyTarget(host, selector, target, scope, options.targetTimeoutMs, options.signal)
      },
      async select(tag, index, scope) {
        checkAborted()
        let matchCount = 0
        const selected = await waitForTaoJourneyTarget(
          () => {
            const matches = findJourneyTargets(host, 'tag', tag, scope)
            matchCount = matches.length
            return matches[index - 1]
          },
          options.targetTimeoutMs ?? taoJourneyTargetTimeoutMs,
          options.signal,
        )
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
  signal?: AbortSignal,
): Promise<StudioPreviewElement> {
  const match = await waitForTaoJourneyTarget(
    () => {
      const matches = findJourneyTargets(host, selector, target, scope)
      RuntimeAssert.input(
        matches.length <= 1,
        `Tao Studio journey expected exactly one ${selector} target '${target}', found ${matches.length}.`,
        { selector, target },
      )
      return matches[0]
    },
    timeoutMs,
    signal,
  )
  RuntimeAssert.input(
    match !== undefined,
    `Tao Studio journey expected exactly one ${selector} target '${target}', found 0 after waiting ${timeoutMs}ms.`,
    { selector, target },
  )
  return match
}

/** Every journey selector but `text` is one attribute on the element; `text` is its content. */
const journeySelectorAttributes = {
  label: 'aria-label',
  placeholder: 'placeholder',
  tag: 'data-testid',
} as const

function findJourneyTargets(
  host: StudioPreviewHost,
  selector: TaoJourneySelector,
  target: string,
  scope?: StudioPreviewElement,
): StudioPreviewElement[] {
  const candidates = Array.from<StudioPreviewElement>(host.document.querySelectorAll('*')).filter(element =>
    (scope === undefined || element === scope || elementIsWithin(element, scope))
    && (selector === 'text'
      ? element.textContent?.trim() === target
      : element.getAttribute(journeySelectorAttributes[selector]) === target)
  )
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
  const mouse = (type: string, buttons: number): void =>
    dispatchBrowserEvent(target, type, browser.MouseEvent ?? browser.Event, {
      bubbles: true,
      button: 0,
      buttons,
      cancelable: true,
    })
  const pointer = (suffix: 'enter' | 'over'): void =>
    dispatchBrowserEvent(
      target,
      `${browser.PointerEvent === undefined ? 'mouse' : 'pointer'}${suffix}`,
      browser.PointerEvent ?? browser.MouseEvent ?? browser.Event,
      { bubbles: true, cancelable: true, pointerType: 'mouse' },
    )
  RuntimeSwitch<TaoJourneyEvent, void>(event, {
    enter: () => {
      RuntimeAssert.input(value !== undefined, 'A Tao Studio enter journey step must carry text.')
      setJourneyInputValue(target, value)
      dispatchBrowserEvent(target, 'input', browser.Event, { bubbles: true, cancelable: true })
    },
    // A target without `focus` is a plain element, which a click is the honest approximation of.
    focus: () => mouse('click', 0),
    hover: () => {
      pointer('over')
      // A text selector resolves to the innermost matching node, which for a pressable is its
      // nested label, while react-native-web listens for `enter` on the pressable itself. A real
      // pointer entering the label enters every ancestor too, so this one bubbles to reach them.
      pointer('enter')
    },
    press: () => mouse('click', 0),
    pressDown: () => mouse('mousedown', 1),
    pressUp: () => mouse('mouseup', 0),
    submit: () =>
      dispatchBrowserEvent(target, 'keydown', browser.KeyboardEvent ?? browser.Event, {
        bubbles: true,
        cancelable: true,
        code: 'Enter',
        key: 'Enter',
      }),
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
  postToStudio(
    host,
    config,
    result === 'failed' ? 'preview-journey-replay-failed' : 'preview-journey-replay-settled',
    result === 'failed' ? { error: previewErrorMessage(error) } : {},
  )
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
  postToStudio(host, config, 'preview-scheme-changed', { scheme })
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
  let canvasGesturesOwned = false
  let canvasPanKeyHeld = false
  let recording: StudioJourneyRecording | undefined
  let measurementQueued = false
  let stopped = false

  const postLayoutMeasurements = () => {
    measurementQueued = false
    if (stopped || host.document.body?.getBoundingClientRect === undefined) {
      return
    }
    postToStudio(host, config, 'preview-layout-measurements', {
      measurements: collectStudioPreviewLayoutMeasurements(
        host.document.querySelectorAll(studioRenderSelector),
        host.document.body.getBoundingClientRect(),
      ),
    })
  }
  const scheduleLayoutMeasurements = () => {
    if (measurementQueued) {
      return
    }
    measurementQueued = true
    queueMicrotask(() => {
      if (measurementQueued) {
        postLayoutMeasurements()
      }
    })
  }

  /**
   * An edit gesture is a real pointer event arriving while the canvas is in edit mode. A synthetic
   * journey event belongs to the app's own replay, and run mode belongs to the app entirely.
   */
  const editingGesture = (event: StudioPreviewPointerEvent): boolean =>
    event.taoStudioJourney !== true && interactionMode !== 'run'

  const disarmDrag = () => {
    drag = undefined
    dragOverlay?.remove()
    dropOverlay?.remove()
    dragOverlay = undefined
    dropOverlay = undefined
  }

  /** Leaving edit mode — for run mode or for a recording — drops everything edit mode was showing. */
  const clearEditSelection = () => {
    hoverTarget = undefined
    selectedTarget = undefined
    sourceTarget = undefined
    disarmDrag()
    overlay?.remove()
    overlay = undefined
  }

  const postRecordingState = (
    activeRecording: StudioJourneyRecording,
    status: 'recording' | 'stopped' | 'invalidated',
  ) => {
    postToStudio(host, config, 'preview-journey-recording-state', {
      recordingId: activeRecording.id,
      sequence: activeRecording.sequence,
      status,
    })
  }
  const postRecordedStep = (
    activeRecording: StudioJourneyRecording,
    step: Readonly<Record<string, unknown>>,
  ) => {
    activeRecording.sequence += 1
    postToStudio(host, config, 'preview-journey-step-recorded', {
      recordingId: activeRecording.id,
      sequence: activeRecording.sequence,
      step,
    })
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
  const startOrStopRecording = (message: Record<string, unknown>) => {
    const control = recordingControl(message, config)
    if (control === undefined) {
      return
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
      clearEditSelection()
      postRecordingState(recording, 'recording')
    } else if (recording?.id === control.recordingId) {
      const stoppedRecording = recording
      flushRecordedInput()
      recording = undefined
      postRecordingState(stoppedRecording, 'stopped')
    }
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
    overlay.setAttribute(
      'data-tao-studio-overlay',
      sourceTarget !== undefined ? 'source' : hoverTarget !== undefined ? 'hover' : 'selection',
    )
    positionOverlay(overlay, target.element.getBoundingClientRect())
  }
  const onGeometryChange = () => {
    redrawOverlay()
    scheduleLayoutMeasurements()
  }
  const releaseCanvasPanKey = () => {
    if (canvasPanKeyHeld) {
      canvasPanKeyHeld = false
      postToStudio(host, config, 'preview-canvas-pan-key', { held: false })
    }
  }
  const onCanvasShortcutKeyDown = (event: StudioPreviewPointerEvent) => {
    if (
      !canvasGesturesOwned || !(event.metaKey === true || event.ctrlKey === true) || event.isComposing === true
      || event.taoStudioJourney === true || isCanvasTypingTarget(previewElementFromEvent(event))
    ) {
      return
    }
    const commands: Readonly<Record<string, 'fit' | 'reset' | 'zoom-in' | 'zoom-out'>> = {
      '0': 'fit',
      '1': 'reset',
      '=': 'zoom-in',
      '+': 'zoom-in',
      '-': 'zoom-out',
    }
    if (event.key === undefined || !Object.hasOwn(commands, event.key)) {
      return
    }
    blockAppPointerEvent(event)
    postToStudio(host, config, 'preview-canvas-shortcut', { command: commands[event.key] })
  }
  const onCanvasPanKeyDown = (event: StudioPreviewPointerEvent) => {
    if (
      !canvasGesturesOwned || event.key !== ' ' || event.isComposing === true
      || event.taoStudioJourney === true || isCanvasTypingTarget(previewElementFromEvent(event))
    ) {
      return
    }
    blockAppPointerEvent(event)
    if (!canvasPanKeyHeld) {
      canvasPanKeyHeld = true
      hoverTarget = undefined
      postedHoverKey = undefined
      disarmDrag()
      redrawOverlay()
      postToStudio(host, config, 'preview-canvas-pan-key', { held: true })
    }
  }
  const onCanvasPanKeyUp = (event: StudioPreviewPointerEvent) => {
    if (event.key === ' ' && canvasPanKeyHeld && event.taoStudioJourney !== true) {
      blockAppPointerEvent(event)
      releaseCanvasPanKey()
    }
  }
  const onCanvasPanPointer = (event: StudioPreviewPointerEvent) => {
    if (canvasPanKeyHeld && event.taoStudioJourney !== true) {
      blockAppPointerEvent(event)
    }
  }
  const onCanvasWheel = (event: StudioPreviewPointerEvent) => {
    if (
      !canvasGesturesOwned
      || (!canvasPanKeyHeld && event.ctrlKey !== true && event.metaKey !== true)
      || (canvasPanKeyHeld && event.taoStudioJourney === true)
      || event.clientX === undefined
      || event.clientY === undefined
      || event.deltaX === undefined
      || event.deltaY === undefined
    ) {
      return
    }
    // Cancellation is synchronous and happens only after the parent has advertised that Design
    // owns the gesture. Ordinary scrolling belongs to the app unless Space is held.
    if (canvasPanKeyHeld) {
      blockAppPointerEvent(event)
    } else {
      event.preventDefault?.()
    }
    postToStudio(host, config, 'preview-canvas-gesture', {
      clientX: event.clientX,
      clientY: event.clientY,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      zoom: event.ctrlKey === true || event.metaKey === true,
    })
  }

  const onClick = (event: StudioPreviewPointerEvent) => {
    if (!editingGesture(event)) {
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
    postLayoutMeasurements()
    postSourceMessage(host, config, 'preview-select-source', target.identity)
  }
  const onMouseDown = (event: StudioPreviewPointerEvent) => {
    if (!editingGesture(event)) {
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
    if (!editingGesture(event) || drag === undefined || event.clientX === undefined || event.clientY === undefined) {
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
    if (!editingGesture(event)) {
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
    if (!editingGesture(event)) {
      return
    }
    const target = renderTargetFromEvent(event)
    const key = target === undefined ? undefined : renderId(target.identity)
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
  /** Every frame this preview acts on, by the `type` the Studio wire addresses it with. */
  const inboundMessages: Readonly<Record<string, (message: Record<string, unknown>) => void>> = {
    'capture-fixture': message => {
      const requestId = studioRequestId(message)
      if (requestId === undefined || captureFixture === undefined) {
        return
      }
      void captureFixture().then(
        fixture => postToStudio(host, config, 'preview-fixture-captured', { fixture, requestId }),
        error => postCaptureFailure(host, config, 'preview-fixture-capture-failed', requestId, error),
      )
    },
    'capture-runtime': message => {
      const requestId = studioRequestId(message)
      if (requestId === undefined) {
        return
      }
      void captureRuntime().then(
        capture => postToStudio(host, config, 'preview-runtime-captured', { capture, requestId }),
        error => postCaptureFailure(host, config, 'preview-runtime-capture-failed', requestId, error),
      )
    },
    'debug-command': applyDebugCommand,
    'highlight-source': message => {
      const selection = highlightSelection(message, config)
      if (selection === undefined) {
        return
      }
      sourceTarget = selection.range === undefined
        ? undefined
        : sourceHighlightTarget(host, selection.path, selection.range)
      redrawOverlay()
    },
    'set-canvas-gestures': message => {
      if (typeof message['owned'] === 'boolean') {
        canvasGesturesOwned = message['owned']
        if (!canvasGesturesOwned) {
          releaseCanvasPanKey()
        }
      }
    },
    'set-interaction-mode': message => {
      const mode = message['mode']
      if (mode !== 'edit' && mode !== 'run') {
        return
      }
      interactionMode = mode
      if (mode === 'run') {
        clearEditSelection()
      }
    },
    'set-journey-recording': startOrStopRecording,
  }
  const onMessage = (event: StudioPreviewMessageEvent) => {
    // A frame this preview has no handler for is Studio talking to someone else, not an error, so
    // the table is read for an own key rather than dispatched exhaustively.
    const message = studioMessage(event, config, host.parent)
    const type = message?.['type']
    if (message !== undefined && typeof type === 'string' && Object.hasOwn(inboundMessages, type)) {
      inboundMessages[type]!(message)
    }
  }

  // One table drives both halves of the bridge's lifetime: the cleanup below removes exactly what
  // was added, which two hand-written sequences could not promise.
  const canvasPanPointerEvents: readonly StudioPreviewDocumentEvent[] = [
    'auxclick',
    'click',
    'contextmenu',
    'dblclick',
    'dragstart',
    'mousedown',
    'mouseenter',
    'mouseleave',
    'mousemove',
    'mouseover',
    'mouseout',
    'mouseup',
    'pointercancel',
    'pointerdown',
    'pointerenter',
    'pointerleave',
    'pointermove',
    'pointerout',
    'pointerover',
    'pointerup',
  ]
  const documentListeners: readonly Readonly<Parameters<StudioPreviewHost['document']['addEventListener']>>[] = [
    // This capture barrier is synchronous; the parent's iframe shield arrives through postMessage.
    ...canvasPanPointerEvents.map(type => [type, onCanvasPanPointer, true] as const),
    ['click', onClick, true],
    ['click', onRecordedClick, true],
    ['input', onRecordedInput, true],
    ['blur', onRecordedBlur, true],
    ['keydown', onCanvasShortcutKeyDown, true],
    ['keydown', onCanvasPanKeyDown, true],
    ['keyup', onCanvasPanKeyUp, true],
    ['keydown', onRecordedKeyDown, true],
    ['mousedown', onMouseDown, true],
    ['mouseleave', disarmDrag],
    ['mousemove', onMouseMove, true],
    ['mouseover', onMouseOver],
    ['mouseout', onMouseOut],
    ['mouseup', onMouseUp, true],
    ['scroll', onGeometryChange, true],
    ['wheel', onCanvasWheel, true],
  ]
  const windowListeners: readonly Parameters<StudioPreviewHost['window']['addEventListener']>[] = [
    ['blur', disarmDrag],
    ['blur', releaseCanvasPanKey],
    ['message', onMessage],
    ['resize', onGeometryChange],
    ['scroll', onGeometryChange],
  ]
  for (const [type, listener, capture] of documentListeners) {
    host.document.addEventListener(type, listener, capture)
  }
  for (const [type, listener] of windowListeners) {
    host.window.addEventListener(type, listener)
  }
  postToStudio(host, config, 'preview-applied', {
    appliedRevision: config.compileRevision,
    compileRevision: config.compileRevision,
  })
  scheduleLayoutMeasurements()
  const stopFailures = onRuntimeFailure(capture => postToStudio(host, config, 'preview-runtime-failure', { capture }))
  const restoreConsole = forwardPreviewConsole(host, config)
  const stopDebug = Debug.onEvent(event =>
    postToStudio(host, config, 'preview-debug', { event: captureArguments(event) })
  )

  return () => {
    releaseCanvasPanKey()
    stopped = true
    // A preview instance owns its debugger pause and clock hold. Releasing the bridge must release
    // both before a replacement instance starts, without letting the old pause publish a resumed
    // event into the replacement's drawer.
    Debug.Reset()
    if (recording !== undefined) {
      const invalidatedRecording = recording
      flushRecordedInput()
      recording = undefined
      postRecordingState(invalidatedRecording, 'invalidated')
    }
    restoreConsole()
    stopFailures()
    stopDebug()
    for (const [type, listener, capture] of documentListeners) {
      host.document.removeEventListener(type, listener, capture)
    }
    for (const [type, listener] of windowListeners) {
      host.window.removeEventListener(type, listener)
    }
    overlay?.remove()
    disarmDrag()
  }
}

/** Collect root-relative geometry for source layout and viewport geometry for canvas selection. */
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
      || Object.values(measurement).some(value => !Number.isFinite(value))
      || measurement.height < 0 || measurement.width < 0
    ) {
      continue
    }
    renderIds.add(id)
    measurements.push({
      elementName: target.identity.elementName,
      rect: measurement,
      renderId: id,
      viewportRect: { height: rect.height, width: rect.width, x: rect.left, y: rect.top },
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
      postToStudio(host, config, 'preview-console', {
        arguments: Array.isArray(captured) ? captured : [captured],
        level,
        timestamp: Date.now(),
      })
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

/** applyDebugCommand runs one Studio debugger command against this preview's controller. */
function applyDebugCommand(message: Record<string, unknown>): void {
  const steps = Array.isArray(message['steps']) ? message['steps'] : []
  const actions = Array.isArray(message['actions']) ? message['actions'] : []
  const commands: Record<string, () => void> = {
    break: () => Debug.Break(),
    configure: () =>
      Debug.Configure({
        actions: actions.filter((entry): entry is string => typeof entry === 'string'),
        steps: steps.filter(isDebugStepValue),
      }),
    continue: () => Debug.Continue(),
    'step-into': () => Debug.Step('into'),
    'step-out': () => Debug.Step('out'),
    'step-over': () => Debug.Step('over'),
  }
  const command = String(message['command'])
  if (Object.hasOwn(commands, command)) {
    commands[command]!()
  }
}

function isDebugStepValue(value: unknown): value is TaoDebugStep {
  if (!isObject(value) || typeof value['action'] !== 'string' || typeof value['path'] !== 'string') {
    return false
  }
  const declaration = value['declaration']
  const statement = value['statement']
  return (declaration === undefined && statement === undefined)
    || (typeof declaration === 'string' && typeof statement === 'string')
}

function recordingControl(
  message: Record<string, unknown>,
  config: StudioPreviewConfig,
): Readonly<{ active: boolean; captureSensitiveText: boolean; recordingId: string }> | undefined {
  if (config.cellId === undefined || config.cellRevision === undefined || config.manifestRevision === undefined) {
    return undefined
  }
  const identity = message['identity']
  if (
    typeof message['active'] !== 'boolean'
    || !nonEmptyValue(message['recordingId'])
    || (message['captureSensitiveText'] !== undefined && typeof message['captureSensitiveText'] !== 'boolean')
    || !isObject(identity)
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
  return isStudioElement(event.target) ? event.target : undefined
}

/** Text entry retains Space even when a containing preview belongs to the Design canvas. */
function isCanvasTypingTarget(element: StudioPreviewElement | undefined): boolean {
  for (let current = element; current !== undefined && current !== null; current = current.parentElement ?? undefined) {
    const tag = current.tagName?.toLowerCase()
    const editable = current.getAttribute('contenteditable')
    if (
      tag === 'input' || tag === 'textarea' || tag === 'select'
      || current.getAttribute('role') === 'textbox'
      || editable === '' || editable === 'true' || editable === 'plaintext-only'
    ) {
      return true
    }
  }
  return false
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
    const source = element
    const candidates = (['tag', 'label', 'placeholder', 'text'] as const)
      .map(selector => ({ selector, target: recordedSelectorValue(source, selector) }))
      .filter((candidate): candidate is StudioRecordedJourneyTarget => candidate.target !== undefined)
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

/** A recorded selector has to be spellable in a Tao journey later: a tag is an identifier, and an
 * empty value identifies nothing. */
function recordedSelectorValue(element: StudioPreviewElement, selector: TaoJourneySelector): string | undefined {
  const value = selector === 'text'
    ? element.textContent?.trim()
    : element.getAttribute(journeySelectorAttributes[selector])?.trim()
  if (selector === 'tag') {
    return value !== undefined && /^[A-Za-z0-9_]+$/.test(value) ? value : undefined
  }
  return value === undefined || value === '' ? undefined : value
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

/** Both capture requests are one addressed frame carrying one request id. */
function studioRequestId(message: Record<string, unknown>): string | undefined {
  return nonEmptyValue(message['requestId']) ? message['requestId'] : undefined
}

/** A runtime capture and a fixture capture fail the same way; only the type names which one. */
function postCaptureFailure(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  type: 'preview-fixture-capture-failed' | 'preview-runtime-capture-failed',
  requestId: string,
  error: unknown,
): void {
  postToStudio(host, config, type, {
    error: error instanceof Error ? error.message : String(error),
    errorName: runtimeCaptureErrorName(error),
    requestId,
  })
}

function runtimeCaptureErrorName(
  error: unknown,
): 'HostEnvironmentError' | 'UnexpectedBehaviorError' | 'UserInputError' {
  if (error instanceof HostEnvironmentError) {
    return 'HostEnvironmentError'
  }
  if (error instanceof UserInputError) {
    return 'UserInputError'
  }
  return error instanceof UnexpectedBehaviorError ? error.name : 'UnexpectedBehaviorError'
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

/** An occurrence-bearing frame names the render it is about on the preview identity itself. */
function occurrenceIdentity(
  config: StudioPreviewConfig,
  occurrence: TaoStudioIdentity,
  sourceVersion: string,
): Record<string, unknown> {
  return {
    ...previewIdentity(config),
    occurrence: sourceActionOccurrence(occurrence),
    path: occurrence.sourcePath,
    sourceVersion,
  }
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
  postToStudio(host, config, type, {
    identity: occurrenceIdentity(config, occurrence, sourceVersion),
    range: { end: occurrence.end, start: occurrence.start },
  })
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
  postToStudio(host, config, 'source-action', {
    action: {
      ...(gap.after === undefined ? {} : { afterId: renderId(gap.after.identity) }),
      ...(gap.before === undefined ? {} : { beforeId: renderId(gap.before.identity) }),
      draggedId: renderId(dragged),
      kind: 'move-render',
    },
    checkpoint: { id: requestId, phase: 'single' },
    identity: occurrenceIdentity(config, dragged, sourceVersion),
    requestId,
    sourceActionVersion: studioSourceActionVersion,
  })
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

/**
 * postToStudio addresses one frame to the Studio window this preview belongs to. Every outgoing
 * message spelled the channel, the protocol version, the preview identity and the parent origin
 * out in full; each call site now names only its own `type` and the fields that type carries. A
 * payload may override `identity` when it attaches an occurrence to it.
 */
function postToStudio(
  host: StudioPreviewHost,
  config: StudioPreviewConfig,
  type: string,
  payload: Readonly<Record<string, unknown>> = {},
): void {
  host.parent.postMessage({
    channel: studioProtocolChannel,
    identity: previewIdentity(config),
    protocolVersion: studioProtocolVersion,
    ...payload,
    type,
  }, config.parentOrigin)
}

/**
 * studioMessage answers the one question every inbound frame raises first: did the Studio window
 * this preview belongs to send it, on this protocol, naming this preview? The handler table is then
 * left with only the fields its own message carries.
 */
function studioMessage(
  event: StudioPreviewMessageEvent,
  config: StudioPreviewConfig,
  parent: StudioPreviewHost['parent'],
): Record<string, unknown> | undefined {
  if (event.origin !== config.parentOrigin || event.source !== parent || !isObject(event.data)) {
    return undefined
  }
  const message = event.data
  const identity = message['identity']
  if (
    message['channel'] !== studioProtocolChannel
    || message['protocolVersion'] !== studioProtocolVersion
    || !isObject(identity)
    || identity['appName'] !== config.appName
    || identity['project'] !== config.project
    || identity['previewInstanceId'] !== config.previewInstanceId
  ) {
    return undefined
  }
  return message
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

function highlightSelection(
  message: Record<string, unknown>,
  config: StudioPreviewConfig,
): { path: string; range: StudioSourceRange | undefined } | undefined {
  const identity = message['identity']
  if (!isObject(identity)) {
    return undefined
  }
  if (
    !nonEmptyValue(identity['path'])
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
  return Arrays.sorted(
    Array.from(host.document.querySelectorAll(studioRenderSelector))
      .map(renderTargetFromElement)
      .filter((target): target is StudioRenderTarget => target !== undefined)
      .filter(target => sourceRangeMatches(sourcePath, range, target.identity)),
    (left, right) => sourceSpan(left.identity) - sourceSpan(right.identity),
  )[0]
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

/** Every preview overlay floats over the app without taking its pointer events. */
const overlayBaseStyle = {
  boxSizing: 'border-box',
  pointerEvents: 'none',
  position: 'fixed',
  zIndex: '2147483647',
} as const

/** The drop indicator's thickness, and the smallest extent it is drawn along its other axis. */
const dropIndicatorThickness = 3
const dropIndicatorMinimumLength = { across: 16, along: 24 } as const

function createOverlay(host: StudioPreviewHost): StudioPreviewOverlay {
  const overlay = host.document.createElement('div')
  Object.assign(overlay.style, { ...overlayBaseStyle, border: '2px solid #2563eb' })
  host.document.body?.appendChild(overlay)
  return overlay
}

function createDragOverlay(host: StudioPreviewHost, kind: 'drag' | 'drop'): StudioPreviewOverlay {
  const overlay = host.document.createElement('div')
  overlay.setAttribute('data-tao-studio-drag-overlay', kind)
  Object.assign(overlay.style, {
    ...overlayBaseStyle,
    background: kind === 'drag' ? 'rgba(37, 99, 235, 0.12)' : '#f3c969',
    border: kind === 'drag' ? '2px dashed #2563eb' : 'none',
    opacity: kind === 'drag' ? '0.75' : '1',
  })
  host.document.body?.appendChild(overlay)
  return overlay
}

/** showOverlayBox is the one way an overlay is placed: revealing it and sizing it are one act. */
function showOverlayBox(
  overlay: StudioPreviewOverlay,
  box: Readonly<{ height: number; left: number; top: number; width: number }>,
): void {
  Object.assign(overlay.style, {
    display: 'block',
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
  })
}

function positionOverlay(overlay: StudioPreviewOverlay, rect: StudioPreviewRect): void {
  showOverlayBox(overlay, {
    height: Math.max(0, rect.height),
    left: rect.left,
    top: rect.top,
    width: Math.max(0, rect.width),
  })
}

/**
 * The drop indicator is one thin line drawn across the flow: along the flow it sits between the
 * anchors it is offered between — or at the open end when there is only one — and across the flow
 * it spans the longer of them. Both axes are the same rule with `horizontal` naming which is which.
 */
function positionDropOverlay(overlay: StudioPreviewOverlay, gap: StudioRenderGap): void {
  const after = gap.after?.element.getBoundingClientRect()
  const before = gap.before?.element.getBoundingClientRect()
  const anchors = [after, before].filter((rect): rect is StudioPreviewRect => rect !== undefined)
  const first = anchors[0]
  if (first === undefined) {
    overlay.style['display'] = 'none'
    return
  }
  const { horizontal } = gap
  const along = after === undefined
    ? renderStart(first, horizontal)
    : before === undefined
    ? renderEnd(after, horizontal)
    : (renderEnd(after, horizontal) + renderStart(before, horizontal)) / 2
  const acrossStart = Math.min(...anchors.map(rect => renderStart(rect, !horizontal)))
  const acrossLength = Math.max(
    ...anchors.map(rect => horizontal ? rect.height : rect.width),
    horizontal ? dropIndicatorMinimumLength.across : dropIndicatorMinimumLength.along,
  )
  showOverlayBox(overlay, {
    height: horizontal ? acrossLength : dropIndicatorThickness,
    left: horizontal ? along : acrossStart,
    top: horizontal ? acrossStart : along,
    width: horizontal ? dropIndicatorThickness : acrossLength,
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
    const key = parentTarget === undefined ? 'root' : renderId(parentTarget.identity)
    groups.set(key, [...(groups.get(key) ?? []), target])
  }
  /** A render is a drop anchor only if it is not the dragged render itself. */
  const isOtherRender = (target: StudioRenderTarget): boolean =>
    renderId(target.identity) !== renderId(dragged.identity)
  let best: StudioRenderGap | undefined
  for (const targets of groups.values()) {
    if (targets.some(target => isOtherRender(target) && dragged.element.contains?.(target.element))) {
      continue
    }
    const candidates = targets.filter(target =>
      isOtherRender(target)
      && normalizePath(target.identity.sourcePath) === normalizePath(dragged.identity.sourcePath)
      && target.identity.ownerName === dragged.identity.ownerName
    )
    if (candidates.length < 1) {
      continue
    }
    const horizontal = renderFlowIsHorizontal(candidates)
    const sorted = Arrays.sorted(
      candidates,
      (left, right) =>
        renderCenter(left.element.getBoundingClientRect(), horizontal)
        - renderCenter(right.element.getBoundingClientRect(), horizontal),
    )
    // One gap for every boundary between the siblings, including the two open ends: the ends are
    // measured to the edge they open onto, the inner ones to the midpoint between two centres.
    for (let index = 0; index <= sorted.length; index += 1) {
      const after = sorted[index - 1]
      const before = sorted[index]
      const edge = after === undefined
        ? renderStart(before!.element.getBoundingClientRect(), horizontal)
        : before === undefined
        ? renderEnd(after.element.getBoundingClientRect(), horizontal)
        : (
          renderCenter(after.element.getBoundingClientRect(), horizontal)
          + renderCenter(before.element.getBoundingClientRect(), horizontal)
        ) / 2
      best = nearerGap(best, {
        ...(after === undefined ? {} : { after }),
        ...(before === undefined ? {} : { before }),
        distance: Math.abs((horizontal ? x : y) - edge),
        horizontal,
      })
    }
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
