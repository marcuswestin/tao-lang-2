import type { StudioPreviewConnection } from './StudioPreviewConnection'

export type StudioFocusedPreviewOptions = {
  initialCellId?: string
  onFocus?: (preview: StudioPreviewConnection) => void
}

/** Keeps visual edits bound to the preview cell that most recently produced a trusted message. */
export class StudioFocusedPreview {
  readonly #previews: readonly StudioPreviewConnection[]
  readonly #listeners = new Set<() => void>()
  readonly #onFocus?: (preview: StudioPreviewConnection) => void
  #focused: StudioPreviewConnection | undefined

  constructor(previews: readonly StudioPreviewConnection[], options?: StudioFocusedPreviewOptions) {
    this.#previews = previews
    this.#onFocus = options?.onFocus
    const initial = options?.initialCellId !== undefined
      ? previews.find(p => (p.cell?.cellId ?? p.cellIdentity?.cellId ?? 'whole-app') === options.initialCellId)
      : undefined
    this.#focused = initial ?? previews[0]
    this.reconcile()
  }

  focus(preview: StudioPreviewConnection): void {
    if (this.#previews.includes(preview) && preview !== this.#focused) {
      this.#focused = preview
      this.#markFocused()
      this.#notify()
      this.#onFocus?.(preview)
    }
  }

  current(): StudioPreviewConnection | undefined {
    return this.#focused !== undefined && this.#previews.includes(this.#focused)
      ? this.#focused
      : this.#previews[0]
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Rewires a manifest-reconciled connection list and falls back when the focused cell was removed. */
  reconcile(wire?: (preview: StudioPreviewConnection) => void, restoreCellId?: string): void {
    const previous = this.#focused
    const previousCellId = previous?.cell?.cellId ?? previous?.cellIdentity?.cellId ?? 'whole-app'
    const restored = restoreCellId === undefined
      ? undefined
      : this.#previews.find(preview =>
        (preview.cell?.cellId ?? preview.cellIdentity?.cellId ?? 'whole-app') === restoreCellId
      )
    this.#focused = restored ?? (previous !== undefined && this.#previews.includes(previous)
      ? previous
      : this.#previews.find(preview =>
        (preview.cell?.cellId ?? preview.cellIdentity?.cellId ?? 'whole-app') === previousCellId
      )
        ?? this.#previews[0])
    for (const preview of this.#previews) {
      preview.focus = () => this.focus(preview)
      wire?.(preview)
    }
    this.#markFocused()
    if (wire !== undefined || previous !== this.#focused) {
      this.#notify()
    }
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      listener()
    }
  }

  #markFocused(): void {
    for (const preview of this.#previews) {
      if (preview.frame === undefined) {
        continue
      }
      if (preview === this.#focused) {
        preview.frame.setAttribute('aria-current', 'true')
      } else {
        preview.frame.removeAttribute('aria-current')
      }
    }
  }
}
