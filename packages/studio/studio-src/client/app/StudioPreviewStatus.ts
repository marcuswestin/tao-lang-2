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
  signal: AbortSignal | undefined
}>

/**
 * The notice that explains a preview that cannot show the app. A failed compile leaves the last good
 * frame on screen, which otherwise looks like the change simply did nothing.
 */
export class StudioPreviewNotice {
  readonly #deps: StudioPreviewNoticeDeps
  #bundleNotice: { detail: string; heading: string } | undefined

  constructor(deps: StudioPreviewNoticeDeps) {
    this.#deps = deps
  }

  render(): void {
    studioPreviewNotice(this.#deps.preview, previewNoticeFor(this.#deps.compileState()) ?? this.#bundleNotice)
  }

  /**
   * Asks the server whether the preview's bundler can build the app. A bundler failure leaves an
   * empty frame and reports nothing to the problems panel, so without this a person sees a blank
   * preview and no reason for it. The probe reads the same bundle the preview asked for, so it is a
   * warm read whenever the preview did start.
   */
  checkBundle(): void {
    if (this.#deps.previewUrl === undefined) {
      return
    }
    void StudioApiClient.previewDiagnosis(this.#deps.signal).then(diagnosis => {
      this.#bundleNotice = previewBundleNoticeFor(diagnosis)
      this.render()
    }).catch(() => {
      // A probe that cannot run says nothing; the compile notice still covers the failures it knows.
    })
  }
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
