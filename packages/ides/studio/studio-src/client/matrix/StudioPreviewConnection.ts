import { Errors } from '@shared/core'
import { cellIdentity } from '../../StudioPreviewCell'
import type {
  StudioCellEnvironment,
  StudioCellIdentity,
  StudioPreviewCell,
  StudioPreviewManifestV2,
} from '../../StudioPreviewManifest'
import type {
  StudioJsonObject,
  StudioLensRenderSample,
  StudioPreviewLayoutMeasurementsMessage,
  StudioRuntimeCaptureArtifact,
  StudioSourceActionEnvelope,
  StudioSourceActionIdentity,
} from '../../StudioProtocol'
import { StudioApiError, StudioApiRoutes } from '../StudioApiClient'
import type { StudioScenarioControlModel } from '../StudioScenarioControls'
import type { StudioDebugState } from './StudioDebugEvents'
import { invalidatePreviewJourneyRecording, type StudioJourneyRecordingDraft } from './StudioJourneyRecording'
import type { StudioRuntimeLog } from './StudioRuntimeCapture'

export type StudioInteractionMode = 'edit' | 'run'

/** One preview iframe and the Studio-side state that follows it through reloads, remounts, and suspension. */
export type StudioPreviewConnection = {
  activate?: () => void
  applySourceAction?: (envelope: StudioSourceActionEnvelope) => Promise<void>
  /** The cell identity the frame last acknowledged applying, and the frame instance that applied it. */
  appliedIdentity?: Readonly<{ identity: StudioCellIdentity; previewInstanceId: string }>
  appliedRevision?: number
  capture?: {
    fixtureName: string
    identity: StudioSourceActionIdentity
    reject: (error: Error) => void
    requestId: string
    resolve: (result: 'cancelled' | 'saved') => void
    timeout: ReturnType<typeof setTimeout>
  }
  captureFixture?: (fixtureName: string) => Promise<'cancelled' | 'saved'>
  generation?: { phase: 'generating' | 'saving'; requestId: string }
  generationNotice?: string
  debug?: StudioDebugState
  cell?: StudioPreviewCell
  cellIdentity?: StudioCellIdentity
  frame?: HTMLElement
  iframe: HTMLIFrameElement
  interactionMode: StudioInteractionMode
  manifestCompatibilitySignature?: string
  expectedRevision?: number
  origin: string
  previewInstanceId: string
  reconfigureEnvironment?: (environment: StudioCellEnvironment) => Promise<void>
  reconfigureArguments?: (args: StudioJsonObject) => Promise<void>
  refresh?: Promise<void>
  journeyRecording?: StudioJourneyRecordingDraft
  journeyRecordingTimeout?: ReturnType<typeof setTimeout>
  journeyReplayStatus?: 'failed' | 'pending' | 'settled'
  /** The last replay outcome the frame reported, and the journey revision it reported it for. */
  journeyReplayResult?: Readonly<{ error?: string; revision: string; status: 'failed' | 'settled' }>
  lensNotifyQueued?: boolean
  lensSamples?: readonly StudioLensRenderSample[]
  layoutMeasurements?: StudioPreviewLayoutMeasurementsMessage
  replayRuntimeCapture?: (capture: StudioRuntimeCaptureArtifact) => Promise<void>
  runtimeCaptureRequest?: {
    reject: (error: Error) => void
    requestId: string
    resolve: (capture: StudioRuntimeCaptureArtifact) => void
    timeout: ReturnType<typeof setTimeout>
  }
  runtimeFailure?: StudioRuntimeCaptureArtifact
  runtimeLogs?: readonly StudioRuntimeLog[]
  scenarioModel?: StudioScenarioControlModel
  scenarioControls?: HTMLFormElement
  scenarioLabel?: string
  setInteractionMode?: (mode: StudioInteractionMode) => void
  changed?: () => void
  sourceSyncDisconnect?: () => void
  suspended?: boolean
  suspendedSource?: string
  visibilityObserver?: IntersectionObserver
}

export const StudioPreviewFrameUrl = {
  create(
    previewUrl: string,
    previewInstanceId: string,
    studioLocation: Pick<Location, 'origin' | 'pathname'>,
    cell = false,
  ): string {
    const url = new URL(previewUrl)
    if (cell) {
      url.searchParams.set('taoStudioCell', '1')
    }
    url.searchParams.set('taoStudioParentOrigin', studioLocation.origin)
    url.searchParams.set('taoStudioPreviewInstanceId', previewInstanceId)
    const sessionId = StudioApiRoutes.currentSessionId(studioLocation.pathname)
    if (sessionId !== undefined) {
      url.searchParams.set('taoStudioSessionId', sessionId)
    }
    return url.toString()
  },
} as const

export const StudioRetainedPreview = {
  registrationIdentities(
    manifest: StudioPreviewManifestV2,
    cell: StudioPreviewCell,
    previous: StudioCellIdentity | undefined,
  ): readonly StudioCellIdentity[] {
    const base = cellIdentity(manifest, cell)
    if (previous === undefined || previous.cellRevision <= base.cellRevision) {
      return [base]
    }
    return [{ ...base, cellRevision: previous.cellRevision }, base]
  },
  async register<Result>(
    identities: readonly StudioCellIdentity[],
    previewInstanceId: string,
    request: (identity: StudioCellIdentity & { previewInstanceId: string }) => Promise<Result>,
  ): Promise<Result> {
    for (const [index, identity] of identities.entries()) {
      try {
        return await request({ ...identity, previewInstanceId })
      } catch (error) {
        if (
          index === identities.length - 1
          || !(error instanceof StudioApiError)
          || error.status !== 409
        ) {
          throw error
        }
      }
    }
    Errors.throwUnexpected('Studio retained preview has no registration identity.')
  },
} as const

export function disconnectPreviews(
  previews: readonly StudioPreviewConnection[],
  reason = 'The Tao Studio preview was disconnected.',
): void {
  for (const preview of previews) {
    invalidatePreviewJourneyRecording(preview)
    if (preview.capture !== undefined) {
      clearTimeout(preview.capture.timeout)
      preview.capture.reject(new Errors.HostEnvironmentError(reason))
      preview.capture = undefined
    }
    if (preview.runtimeCaptureRequest !== undefined) {
      clearTimeout(preview.runtimeCaptureRequest.timeout)
      preview.runtimeCaptureRequest.reject(new Errors.HostEnvironmentError(reason))
      preview.runtimeCaptureRequest = undefined
    }
    preview.visibilityObserver?.disconnect()
    preview.visibilityObserver = undefined
    preview.sourceSyncDisconnect?.()
    preview.sourceSyncDisconnect = undefined
    preview.iframe.src = 'about:blank'
  }
}

/** StudioPreviewSourceSync keeps source identity available across an iframe's initial load and reloads. */
export const StudioPreviewSourceSync = {
  connect(preview: StudioPreviewConnection, synchronize: () => void): void {
    preview.sourceSyncDisconnect?.()
    const listener = (): void => synchronize()
    preview.iframe.addEventListener('load', listener)
    preview.sourceSyncDisconnect = () => preview.iframe.removeEventListener('load', listener)
    // The load callback covers previews that install their message listener synchronously. Tab
    // activation, saves, and selections republish identity for receivers that mount later.
    synchronize()
  },
} as const

/** Pure transition used by the viewport observer and covered without a browser DOM. */
export const StudioPreviewSuspension = {
  transition(suspended: boolean, visible: boolean): 'resume' | 'suspend' | 'unchanged' {
    if (visible && suspended) {
      return 'resume'
    }
    if (!visible && !suspended) {
      return 'suspend'
    }
    return 'unchanged'
  },
} as const

export type StudioActivePreviewOptions = {
  initialCellId?: string
  onActivate?: (preview: StudioPreviewConnection) => void
}

/** Keeps visual edits bound to the preview cell that most recently produced a trusted message. */
export class StudioActivePreview {
  readonly #previews: readonly StudioPreviewConnection[]
  readonly #listeners = new Set<() => void>()
  readonly #onActivate?: (preview: StudioPreviewConnection) => void
  #active: StudioPreviewConnection | undefined

  constructor(previews: readonly StudioPreviewConnection[], options?: StudioActivePreviewOptions) {
    this.#previews = previews
    this.#onActivate = options?.onActivate
    const initial = options?.initialCellId !== undefined
      ? previews.find(p => (p.cell?.cellId ?? p.cellIdentity?.cellId) === options.initialCellId)
      : undefined
    this.#active = initial ?? previews[0]
    this.reconcile()
  }

  activate(preview: StudioPreviewConnection): void {
    if (this.#previews.includes(preview) && preview !== this.#active) {
      this.#active = preview
      this.#markActive()
      this.#notify()
      this.#onActivate?.(preview)
    }
  }

  current(): StudioPreviewConnection | undefined {
    return this.#active !== undefined && this.#previews.includes(this.#active)
      ? this.#active
      : this.#previews[0]
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Rewires a manifest-reconciled connection list and falls back when the active cell was removed. */
  reconcile(wire?: (preview: StudioPreviewConnection) => void): void {
    const previous = this.#active
    const previousCellId = previous?.cell?.cellId ?? previous?.cellIdentity?.cellId
    this.#active = previous !== undefined && this.#previews.includes(previous)
      ? previous
      : this.#previews.find(preview => (preview.cell?.cellId ?? preview.cellIdentity?.cellId) === previousCellId)
        ?? this.#previews[0]
    for (const preview of this.#previews) {
      preview.activate = () => this.activate(preview)
      wire?.(preview)
    }
    this.#markActive()
    if (wire !== undefined || previous !== this.#active) {
      this.#notify()
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #markActive(): void {
    for (const preview of this.#previews) {
      if (preview.frame === undefined) {
        continue
      }
      if (preview === this.#active) {
        preview.frame.setAttribute('aria-current', 'true')
      } else {
        preview.frame.removeAttribute('aria-current')
      }
    }
  }
}

/** Suspends a cell's iframe while it is scrolled far out of view and restores it when it returns. */
export function observePreviewVisibility(frame: HTMLElement, connection: StudioPreviewConnection): void {
  connection.visibilityObserver?.disconnect()
  if (typeof IntersectionObserver === 'undefined') {
    return
  }
  const observer = new IntersectionObserver(entries => {
    const visible = entries.some(entry =>
      entry.target === frame && (entry.isIntersecting || entry.intersectionRatio > 0)
    )
    const transition = StudioPreviewSuspension.transition(connection.suspended === true, visible)
    if (transition === 'suspend') {
      invalidatePreviewJourneyRecording(connection)
      connection.appliedIdentity = undefined
      connection.suspendedSource = connection.iframe.src
      connection.suspended = true
      connection.iframe.src = 'about:blank'
    } else if (transition === 'resume') {
      connection.suspended = false
      const source = connection.suspendedSource
      connection.suspendedSource = undefined
      if (source !== undefined) {
        connection.iframe.src = source
      }
    }
  }, { root: frame.closest<HTMLElement>('.studio-preview-grid'), rootMargin: '600px' })
  observer.observe(frame)
  connection.visibilityObserver = observer
}

export function setPreviewSource(connection: StudioPreviewConnection, source: string): void {
  invalidatePreviewJourneyRecording(connection)
  connection.appliedIdentity = undefined
  if (connection.suspended === true) {
    connection.suspendedSource = source
  } else {
    connection.iframe.src = source
  }
}

export function expectPreviewRevision(connection: StudioPreviewConnection, compileRevision: number): void {
  connection.expectedRevision = compileRevision
}
