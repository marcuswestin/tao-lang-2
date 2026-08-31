import React from 'react'
import { currentExternalEffectRevision } from './TR-action-transactions'
import { DataControls } from './TR-data'
import type { RuntimeAppDefinition } from './TR-navigation-app'
import { requireReactNativeRuntime } from './TR-react-native'
import {
  captureRuntime,
  type TaoRuntimeCaptureArtifact,
  type TaoRuntimeFailure,
  type TaoRuntimeFailureFrame,
  type TaoRuntimeJson,
} from './TR-runtime-capture'

export type TaoErrorBoundaryProps = Readonly<{
  app?: RuntimeAppDefinition
  boundaryId: string
  children?: React.ReactNode
  frame: TaoRuntimeFailureFrame | (() => TaoRuntimeFailureFrame)
  stateKey: string | number | (() => string | number)
}>

type ResolvedDiagnostics = Readonly<{
  frame: TaoRuntimeFailureFrame
  stateKey: string | number
}>

type FailureState = Readonly<{
  componentStack?: string
  error: unknown
  fingerprint: string
  recoveryError?: string
  retryEligible: boolean
}>

type BoundaryState =
  | Readonly<{ phase: 'healthy'; revision: number }>
  | Readonly<{ error: unknown; phase: 'diagnostic'; revision: number }>
  | Readonly<{ confirmReset?: boolean; failure: FailureState; phase: 'failed' | 'stopped'; revision: number }>
  | Readonly<{ error: Error; phase: 'escalate'; revision: number }>

const failureListeners = new Set<(artifact: TaoRuntimeCaptureArtifact) => void>()
let lastRecoveryBackup: TaoRuntimeCaptureArtifact | undefined
let lastFailureCapture: TaoRuntimeCaptureArtifact | undefined

/** onRuntimeFailure publishes complete semantic captures only after the diagnostic render pass. */
export function onRuntimeFailure(listener: (artifact: TaoRuntimeCaptureArtifact) => void): () => void {
  failureListeners.add(listener)
  return () => failureListeners.delete(listener)
}

export function recoveryBackup(): TaoRuntimeCaptureArtifact | undefined {
  return lastRecoveryBackup
}

/** latestFailureCapture supports explicit developer export without exposing any unregistered domain. */
export function latestFailureCapture(): TaoRuntimeCaptureArtifact | undefined {
  return lastFailureCapture
}

/** TaoErrorBoundary is the accepted steady-state component boundary; diagnostics run only after failure. */
export class TaoErrorBoundary extends React.Component<TaoErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { phase: 'healthy', revision: 0 }
  #bareComponentStack: string | undefined
  #effectRevision = 0
  #resolvedDiagnostics: ResolvedDiagnostics | undefined
  #retryFingerprint: string | undefined

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, phase: 'diagnostic' }
  }

  override componentDidCatch(_error: unknown, info: React.ErrorInfo): void {
    // A boundary may remain mounted while its generated frame/state key changes. Resolve diagnostics
    // for each newly caught failure so the report never reuses metadata from an earlier render.
    this.#resolvedDiagnostics = undefined
    this.#bareComponentStack = info.componentStack ?? undefined
  }

  override render(): React.ReactNode {
    if (this.state.phase === 'healthy') {
      this.#effectRevision = currentExternalEffectRevision()
      return React.createElement(React.Fragment, { key: this.state.revision }, this.props.children)
    }
    if (this.state.phase === 'diagnostic') {
      return React.createElement(
        DiagnosticPass,
        {
          key: `diagnostic-${this.state.revision}`,
          onFailure: (error, info) => this.#finishDiagnostic(error, info.componentStack ?? undefined),
          onRecovered: () => this.#finishDiagnostic(this.state.phase === 'diagnostic' ? this.state.error : undefined),
        },
        this.props.children,
      )
    }
    if (this.state.phase === 'escalate') {
      return React.createElement(EscalationThrower, { error: this.state.error })
    }
    return React.createElement(FailureSurface, {
      app: this.props.app,
      confirmReset: this.state.confirmReset === true,
      failure: this.state.failure,
      level: this.#diagnostics().frame.boundary,
      onResetData: () => this.#requestResetData(),
      onRestart: () => this.#restart(),
      onRetry: () => this.#retry(),
      stopped: this.state.phase === 'stopped',
    })
  }

  #finishDiagnostic(error: unknown, componentStack = this.#bareComponentStack): void {
    if (this.state.phase !== 'diagnostic') {
      return
    }
    const diagnostics = this.#diagnostics()
    const fingerprint = failureFingerprint(error, diagnostics.stateKey)
    const repeated = this.#retryFingerprint === fingerprint
    const failure: FailureState = {
      componentStack,
      error,
      fingerprint,
      retryEligible: currentExternalEffectRevision() === this.#effectRevision,
    }
    const report = runtimeFailure(this.props, diagnostics.frame, failure, repeated)
    void publishFailure(report)
    if (repeated && diagnostics.frame.boundary !== 'app') {
      this.setState({ error: new TaoBoundaryEscalation(report), phase: 'escalate', revision: this.state.revision })
      return
    }
    this.setState({ failure, phase: repeated ? 'stopped' : 'failed', revision: this.state.revision })
  }

  #retry(): void {
    if (this.state.phase !== 'failed' || !this.state.failure.retryEligible) {
      return
    }
    this.#retryFingerprint = this.state.failure.fingerprint
    this.#resolvedDiagnostics = undefined
    this.setState({ phase: 'healthy', revision: this.state.revision + 1 })
  }

  #restart(): void {
    this.props.app?.reset()
    this.#retryFingerprint = undefined
    this.#resolvedDiagnostics = undefined
    this.setState({ phase: 'healthy', revision: this.state.revision + 1 })
  }

  #requestResetData(): void {
    if ((this.state.phase !== 'failed' && this.state.phase !== 'stopped') || !DataControls.CanResetAll()) {
      return
    }
    if (this.state.confirmReset !== true) {
      this.setState({ ...this.state, confirmReset: true })
      return
    }
    void this.#resetData()
  }

  async #resetData(): Promise<void> {
    if (!DataControls.CanResetAll()) {
      return
    }
    try {
      lastRecoveryBackup = await captureRuntime()
      await DataControls.ResetAll()
      this.#restart()
    } catch (error) {
      if (this.state.phase !== 'failed' && this.state.phase !== 'stopped') {
        return
      }
      this.setState({
        ...this.state,
        confirmReset: false,
        failure: { ...this.state.failure, recoveryError: errorShape(error).message },
      })
    }
  }

  #diagnostics(): ResolvedDiagnostics {
    this.#resolvedDiagnostics ??= {
      frame: typeof this.props.frame === 'function' ? this.props.frame() : this.props.frame,
      stateKey: typeof this.props.stateKey === 'function' ? this.props.stateKey() : this.props.stateKey,
    }
    return this.#resolvedDiagnostics
  }
}

class DiagnosticPass extends React.Component<{
  children?: React.ReactNode
  onFailure(error: unknown, info: React.ErrorInfo): void
  onRecovered(): void
}, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    this.props.onFailure(error, info)
  }
  override componentDidMount(): void {
    if (!this.state.failed) {
      this.props.onRecovered()
    }
  }
  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

class TaoBoundaryEscalation extends Error {
  override readonly name = 'TaoBoundaryEscalation'
  constructor(readonly failure: TaoRuntimeFailure) {
    super(failure.error.message)
  }
}

function EscalationThrower({ error }: { error: Error }): never {
  throw error
}

function FailureSurface(props: {
  app?: RuntimeAppDefinition
  confirmReset: boolean
  failure: FailureState
  level: TaoRuntimeFailureFrame['boundary']
  onResetData(): void
  onRestart(): void
  onRetry(): void
  stopped: boolean
}): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  const message = errorShape(props.failure.error).message
  const controls = [
    !props.stopped && props.failure.retryEligible
      ? React.createElement(RecoveryButton, { key: 'retry', label: 'Try again', onPress: props.onRetry })
      : null,
    props.app
      ? React.createElement(RecoveryButton, { key: 'restart', label: 'Restart app', onPress: props.onRestart })
      : null,
    props.app && DataControls.CanResetAll()
      ? React.createElement(RecoveryButton, {
        key: 'reset',
        label: props.confirmReset ? 'Confirm reset app data' : 'Reset app data',
        onPress: props.onResetData,
      })
      : null,
    canCopyFailureCapture()
      ? React.createElement(RecoveryButton, {
        key: 'copy-capture',
        label: 'Copy failure capture',
        onPress: () => {
          void copyFailureCapture()
        },
      })
      : null,
  ]
  return React.createElement(RN.View, {
    accessibilityLabel: props.stopped ? 'App error retry stopper' : `${props.level} error`,
    accessibilityViewIsModal: props.level === 'app',
    children: React.createElement(
      RN.View,
      { style: styles.panel },
      React.createElement(
        RN.Text,
        { style: styles.title },
        props.stopped ? 'This keeps failing' : "Couldn't render this view",
      ),
      React.createElement(RN.Text, { style: styles.message }, message),
      props.failure.recoveryError
        ? React.createElement(
          RN.Text,
          { accessibilityRole: 'alert', style: styles.message },
          props.failure.recoveryError,
        )
        : null,
      ...controls,
    ),
    style: props.level === 'app' ? styles.overlay : styles.inline,
  })
}

function RecoveryButton(props: { label: string; onPress(): void }): React.JSX.Element {
  const RN = requireReactNativeRuntime()
  return React.createElement(RN.Pressable, {
    accessibilityLabel: props.label,
    accessibilityRole: 'button',
    children: React.createElement(RN.Text, { style: styles.buttonText }, props.label),
    onPress: props.onPress,
    style: styles.button,
  })
}

function runtimeFailure(
  props: TaoErrorBoundaryProps,
  frame: TaoRuntimeFailureFrame,
  failure: FailureState,
  stopper: boolean,
): TaoRuntimeFailure {
  return Object.freeze({
    boundaryId: props.boundaryId,
    error: errorShape(failure.error),
    frame: { ...frame, ...(failure.componentStack ? { componentStack: failure.componentStack } : {}) },
    retryEligible: failure.retryEligible,
    stopper,
    timestamp: Date.now(),
  })
}

async function publishFailure(failure: TaoRuntimeFailure): Promise<void> {
  let artifact: TaoRuntimeCaptureArtifact
  try {
    artifact = await captureRuntime(failure)
  } catch (error) {
    artifact = Object.freeze({ capturedAt: Date.now(), domains: Object.freeze([]), failure, version: 1 })
    warnContainment('A runtime capture domain failed; publishing the minimal failure report.', error)
  }
  lastFailureCapture = artifact
  for (const listener of failureListeners) {
    try {
      listener(artifact)
    } catch (error) {
      warnContainment('A runtime failure listener threw while receiving a capture.', error)
    }
  }
}

function canCopyFailureCapture(): boolean {
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    return false
  }
  const navigator =
    (globalThis as { navigator?: { clipboard?: { writeText?(text: string): Promise<void> } } }).navigator
  return typeof navigator?.clipboard?.writeText === 'function'
}

async function copyFailureCapture(): Promise<void> {
  const artifact = lastFailureCapture
  const navigator =
    (globalThis as { navigator?: { clipboard?: { writeText?(text: string): Promise<void> } } }).navigator
  if (artifact && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(JSON.stringify(artifact, null, 2))
  }
}

function failureFingerprint(error: unknown, stateKey: string | number): string {
  const shaped = errorShape(error)
  return JSON.stringify([stateKey, shaped.name, shaped.message])
}

function errorShape(error: unknown): { message: string; name: string; stack?: string } {
  if (error instanceof TaoBoundaryEscalation) {
    return error.failure.error
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name, ...(error.stack ? { stack: error.stack } : {}) }
  }
  return { message: String(error), name: 'Error' }
}

export function captureArguments(value: unknown): TaoRuntimeJson {
  return captureArgumentValue(value, new Set(), { remaining: 1_000 }, 0)
}

function captureArgumentValue(
  value: unknown,
  ancestors: Set<object>,
  budget: { remaining: number },
  depth: number,
): TaoRuntimeJson {
  if (budget.remaining <= 0 || depth > 8) {
    return '[truncated]'
  }
  budget.remaining -= 1
  if (value === null || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.length <= 4_096 ? value : `${value.slice(0, 4_096)}…`
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    return null
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const captured = value.slice(0, 100).map(entry => captureArgumentValue(entry, ancestors, budget, depth + 1))
      return value.length > 100 ? [...captured, '[truncated]'] : captured
    }
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 100)
    return Object.fromEntries(
      entries.flatMap(([key, entry]) =>
        /credential|password|secret|token|authorization/i.test(key)
          ? []
          : [[key.slice(0, 256), captureArgumentValue(entry, ancestors, budget, depth + 1)]]
      ),
    )
  } finally {
    ancestors.delete(value)
  }
}

function warnContainment(message: string, error: unknown): void {
  if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
    return
  }
  console.warn(message, error)
}

const styles = {
  button: { backgroundColor: '#334155', borderRadius: 7, paddingHorizontal: 12, paddingVertical: 9 },
  buttonText: { color: '#fff', fontWeight: '700' },
  inline: { backgroundColor: '#fff1f2', borderColor: '#be123c', borderWidth: 1, padding: 12 },
  message: { color: '#374151' },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.65)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: 24,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30000,
  },
  panel: { backgroundColor: '#fff', borderRadius: 10, gap: 10, maxWidth: 520, padding: 18, width: '100%' },
  title: { color: '#111827', fontSize: 18, fontWeight: '700' },
} as const
