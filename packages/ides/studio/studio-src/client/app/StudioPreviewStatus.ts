import { StudioApiClient, type StudioCompileState } from '../StudioApiClient'
import {
  previewBundleNoticeFor,
  previewNoticeFor,
  type StudioPreviewConnection,
  studioPreviewNotice,
} from '../StudioMatrixView'

export type StudioPreviewNoticeDeps = Readonly<{
  compileState: () => StudioCompileState
  preview: HTMLElement
  previewUrl: string | undefined
  previews: readonly StudioPreviewConnection[]
  signal: AbortSignal | undefined
  /** How long a preview gets to apply a compile before its bundler is asked why it has not. */
  settleMs?: number
}>

const BUNDLE_CHECK_SETTLE_MS = 5_000

/**
 * The notice that explains a preview that cannot show the app. A failed compile leaves the last good
 * frame on screen, which otherwise looks like the change simply did nothing.
 */
export class StudioPreviewNotice {
  readonly #deps: StudioPreviewNoticeDeps
  #bundleNotice: { detail: string; heading: string } | undefined
  #pendingCheck: ReturnType<typeof setTimeout> | undefined

  constructor(deps: StudioPreviewNoticeDeps) {
    this.#deps = deps
  }

  render(): void {
    studioPreviewNotice(this.#deps.preview, previewNoticeFor(this.#deps.compileState()) ?? this.#bundleNotice)
  }

  /**
   * Asks the server whether the preview's bundler can build the app. A bundler failure leaves an
   * empty frame and reports nothing to the problems panel, so without this a person sees a blank
   * preview and no reason for it.
   *
   * The probe asks only about a preview that has not applied the compile once it has had time to.
   * Reading the bundle rebuilds the preview's own Metro graph, and when that lands before Metro's
   * hot-update handler has taken the same file change, Metro can no longer find the revision the
   * preview is subscribed at and ends its hot updates for good: a retained preview then never
   * shows another edit. A preview that applied the compile is running the bundle, so there is
   * nothing to diagnose and nothing to risk.
   */
  checkBundle(): void {
    if (this.#deps.previewUrl === undefined) {
      return
    }
    clearTimeout(this.#pendingCheck)
    this.#pendingCheck = setTimeout(() => {
      this.#pendingCheck = undefined
      if (
        this.#deps.signal?.aborted === true
        || (this.#deps.previews.length > 0 && this.#deps.previews.every(previewApplied))
      ) {
        this.#bundleNotice = undefined
        this.render()
        return
      }
      this.#probeBundle()
    }, this.#deps.settleMs ?? BUNDLE_CHECK_SETTLE_MS)
  }

  #probeBundle(): void {
    void StudioApiClient.previewDiagnosis(this.#deps.signal).then(diagnosis => {
      this.#bundleNotice = previewBundleNoticeFor(diagnosis)
      this.render()
    }).catch(() => {
      // A probe that cannot run says nothing; the compile notice still covers the failures it knows.
    })
  }
}

/** previewApplied is true once a preview reports running the compile it was last handed. */
function previewApplied(preview: StudioPreviewConnection): boolean {
  return preview.appliedRevision !== undefined
    && preview.expectedRevision !== undefined
    && preview.appliedRevision >= preview.expectedRevision
}

/** The toolbar's reload: every frame reloads, and the status line comes back once they have. */
export function mountStudioPreviewReload(
  button: HTMLButtonElement,
  status: HTMLElement,
  previews: readonly StudioPreviewConnection[],
  restoreStatus: () => void,
): void {
  button.addEventListener('click', () => {
    if (previews.length > 0) {
      let pending = previews.length
      let restored = false
      const restore = (): void => {
        if (!restored) {
          restored = true
          restoreStatus()
        }
      }
      for (const connection of previews) {
        connection.iframe.addEventListener('load', () => {
          pending -= 1
          if (pending === 0) {
            restore()
          }
        }, { once: true })
        connection.iframe.src = connection.iframe.src
      }
      // A frame the manifest replaces mid-reload never fires that load; the status still comes back.
      setTimeout(restore, 10_000)
      status.textContent = 'Reloading preview…'
    }
  })
}
