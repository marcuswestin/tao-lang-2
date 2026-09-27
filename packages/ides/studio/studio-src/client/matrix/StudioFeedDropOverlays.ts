import { type StudioFeedDropAtPointMessage, studioProtocolChannel, studioProtocolVersion } from '../../StudioProtocol'
import { StudioFeedTransfer } from '../StudioFeedController'
import type { StudioPreviewConnection } from './StudioPreviewConnection'

/** Browsers block same-page cross-origin drags before the iframe can receive dragenter. */
export function mountFeedDropOverlay(
  host: HTMLElement,
  previews: readonly StudioPreviewConnection[],
  enabled: () => boolean,
): () => void {
  const document = host.ownerDocument
  let active = false
  const clear = (): void => {
    active = false
    delete host.dataset['feedDragging']
  }
  const start = (event: DragEvent): void => {
    clear()
    if (enabled() && event.dataTransfer?.types.includes(StudioFeedTransfer.mime)) {
      active = true
      host.dataset['feedDragging'] = 'true'
    }
  }
  const over = (event: DragEvent): void => {
    if (!active) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }
  const drop = (event: DragEvent): void => {
    if (!active) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    clear()
    if (!enabled() || host.dataset['canvasPanReady'] === 'true') {
      return
    }
    const preview = previews.find(preview => {
      const rect = preview.iframe.getBoundingClientRect()
      return preview.interactionMode === 'edit' && preview.cellIdentity !== undefined
        && rect.width > 0 && rect.height > 0
        && event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
    })
    if (preview?.cellIdentity === undefined) {
      return
    }
    const payload = event.dataTransfer?.getData(StudioFeedTransfer.mime) ?? ''
    if (payload.length > 16_384) {
      return
    }
    let value: ReturnType<typeof StudioFeedTransfer.parse>
    try {
      value = StudioFeedTransfer.parse(payload)
    } catch {
      return
    }
    if (value.kind === 'entity') {
      return
    }
    const frame = preview.iframe
    const rect = frame.getBoundingClientRect()
    const message: StudioFeedDropAtPointMessage = {
      channel: studioProtocolChannel,
      protocolVersion: studioProtocolVersion,
      type: 'feed-drop-at-point',
      identity: { ...preview.cellIdentity, previewInstanceId: preview.previewInstanceId },
      drop: value,
      clientX: (event.clientX - rect.left) * frame.clientWidth / rect.width,
      clientY: (event.clientY - rect.top) * frame.clientHeight / rect.height,
    }
    frame.contentWindow?.postMessage(message, preview.origin)
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      clear()
    }
  }
  document.addEventListener('dragstart', start)
  document.addEventListener('dragend', clear)
  document.addEventListener('drop', clear)
  document.addEventListener('keydown', keydown)
  document.defaultView?.addEventListener('blur', clear)
  host.addEventListener('dragover', over)
  host.addEventListener('drop', drop)
  return () => {
    clear()
    document.removeEventListener('dragstart', start)
    document.removeEventListener('dragend', clear)
    document.removeEventListener('drop', clear)
    document.removeEventListener('keydown', keydown)
    document.defaultView?.removeEventListener('blur', clear)
    host.removeEventListener('dragover', over)
    host.removeEventListener('drop', drop)
  }
}
