import type { StudioPreviewConnection } from './StudioPreviewConnection'

/**
 * Panels floating over the canvas (the edit log, the selection HUD) are Studio chrome: pressing one
 * neither pans the canvas nor lets go of the preview being edited.
 */
const studioCanvasChromeSelector = '[data-tao-studio-canvas-chrome]'

/** Input selection is separate from the preview used for inspection and source actions. */
export function mountPreviewFocus(host: HTMLElement, previews: readonly StudioPreviewConnection[]): {
  reconcile: () => void
  clear: () => void
  dispose: () => void
  canPanWithoutSpace: (event: PointerEvent) => boolean
} {
  const document = host.ownerDocument
  type Entry = {
    iframe: HTMLIFrameElement
    marker: HTMLElement
    viewport: HTMLElement
    shield: HTMLButtonElement
    pointerEvents: string
    tabIndex: number
    dispose: () => void
  }
  const entries = new Map<StudioPreviewConnection, Entry>()
  let selected: StudioPreviewConnection | undefined
  let disposed = false
  const panning = (): boolean => host.dataset['canvasPanReady'] === 'true' || host.dataset['canvasPanning'] === 'true'
  const update = (): void => {
    for (const [preview, entry] of entries) {
      const focused = preview === selected
      entry.iframe.style.pointerEvents = focused ? entry.pointerEvents : 'none'
      entry.iframe.tabIndex = focused ? entry.tabIndex : -1
      if (!focused && document.activeElement === entry.iframe) {
        entry.iframe.blur()
      }
      entry.shield.hidden = focused
      if (focused) {
        entry.marker.dataset['previewInteractive'] = 'true'
      } else {
        delete entry.marker.dataset['previewInteractive']
      }
    }
  }
  const clear = (): void => {
    selected = undefined
    update()
  }
  const focus = (preview: StudioPreviewConnection, event: Event): void => {
    if (event.defaultPrevented || !entries.has(preview)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (panning()) {
      return
    }
    selected = preview
    update()
    preview.focus?.()
  }
  const reconcile = (): void => {
    if (disposed) {
      return
    }
    for (const [preview, entry] of entries) {
      if (!previews.includes(preview) || preview.iframe !== entry.iframe || !host.contains(entry.iframe)) {
        entry.dispose()
        entries.delete(preview)
        if (selected === preview) {
          selected = undefined
        }
      }
    }
    for (const preview of previews) {
      if (!host.contains(preview.iframe)) {
        continue
      }
      const existing = entries.get(preview)
      if (existing !== undefined) {
        const marker = preview.frame ?? preview.iframe
        if (existing.marker !== marker) {
          delete existing.marker.dataset['previewInteractive']
          existing.marker = marker
        }
        continue
      }
      const iframe = preview.iframe
      const viewport = iframe.closest<HTMLElement>('.studio-preview-cell-viewport') ?? host
      const shield = document.createElement('button')
      shield.type = 'button'
      shield.className = 'studio-preview-focus-shield'
        + (viewport === host ? ' studio-preview-focus-whole-app' : '')
      shield.setAttribute('aria-label', `Focus ${preview.scenarioLabel ?? (iframe.title || 'preview')}`)
      const click = (event: MouseEvent): void => {
        if (event.button === 0) {
          focus(preview, event)
        }
      }
      const keydown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' || event.key === ' ') {
          focus(preview, event)
        }
      }
      shield.addEventListener('click', click)
      shield.addEventListener('keydown', keydown)
      const entry: Entry = {
        iframe,
        marker: preview.frame ?? iframe,
        viewport,
        shield,
        pointerEvents: iframe.style.pointerEvents,
        tabIndex: iframe.tabIndex,
        dispose: () => {
          shield.removeEventListener('click', click)
          shield.removeEventListener('keydown', keydown)
          shield.remove()
          iframe.style.pointerEvents = entry.pointerEvents
          iframe.tabIndex = entry.tabIndex
          delete entry.marker.dataset['previewInteractive']
        },
      }
      entries.set(preview, entry)
      viewport.append(shield)
    }
    update()
  }
  const outsidePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || panning()) {
      return
    }
    const entry = selected === undefined ? undefined : entries.get(selected)
    const target = event.target
    if (
      entry !== undefined && target instanceof Element && !entry.iframe.contains(target)
      && !(entry.viewport !== host && entry.viewport.contains(target))
      && target.closest(studioCanvasChromeSelector) === null
    ) {
      clear()
    }
  }
  document.addEventListener('pointerdown', outsidePointerDown, true)
  reconcile()
  return {
    reconcile,
    clear,
    canPanWithoutSpace: event => {
      if (
        disposed || (event.button !== 0 && event.button !== 1) || !(event.target instanceof Element)
        || !host.contains(event.target)
      ) {
        return false
      }
      for (const [preview, entry] of entries) {
        if (entry.shield.contains(event.target)) {
          return selected !== preview
        }
        if (entry.iframe.contains(event.target)) {
          return false
        }
        if (entry.viewport !== host && entry.viewport.contains(event.target)) {
          return selected !== preview && event.target === entry.viewport
        }
      }
      return event.target.closest(
        'button, input, select, textarea, a, canvas, [contenteditable], [role="button"], [role="menu"], '
          + `[role="menuitem"], [role="slider"], .studio-preview-cell, .studio-draw-canvas, ${studioCanvasChromeSelector}`,
      ) === null
    },
    dispose: () => {
      disposed = true
      document.removeEventListener('pointerdown', outsidePointerDown, true)
      for (const entry of entries.values()) {
        entry.dispose()
      }
      entries.clear()
      selected = undefined
    },
  }
}
