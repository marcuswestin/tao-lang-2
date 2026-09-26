import type { StudioInspectorSelection } from '../../StudioInspector'
import type { StudioPreviewConnection } from '../StudioMatrixView'

type Bounds = Readonly<{ left: number; top: number; right: number; bottom: number }>

/** Return current screen geometry, never an element's measurement from an older preview revision. */
export function studioCanvasSelectionBounds(
  host: HTMLElement,
  selection: StudioInspectorSelection | undefined,
  previews: readonly StudioPreviewConnection[],
): Bounds | undefined {
  if (selection === undefined) {
    return undefined
  }
  const preview = previews.find(candidate => candidate.previewInstanceId === selection.identity.previewInstanceId)
  const layout = preview?.layoutMeasurements
  if (preview === undefined || layout === undefined || !host.contains(preview.iframe)) {
    return undefined
  }
  const current = preview.cellIdentity
  if (
    layout.identity.previewInstanceId !== preview.previewInstanceId
    || (current !== undefined && (layout.identity.cellId !== current.cellId
      || layout.identity.cellRevision !== current.cellRevision
      || layout.identity.compileRevision !== current.compileRevision
      || layout.identity.manifestRevision !== current.manifestRevision))
  ) {
    return undefined
  }
  if (
    selection.identity.compileRevision !== layout.identity.compileRevision
    || selection.identity.cellRevision !== layout.identity.cellRevision
    || selection.identity.manifestRevision !== layout.identity.manifestRevision
  ) {
    return undefined
  }
  const measured = layout.measurements.find(item => item.renderId === selection.renderId)
  const rect = measured?.viewportRect
  if (rect === undefined || preview.iframe.offsetWidth <= 0) {
    return undefined
  }
  const frame = preview.iframe.getBoundingClientRect()
  const scale = frame.width / preview.iframe.offsetWidth
  const left = frame.left + rect.x * scale
  const top = frame.top + rect.y * scale
  return { left, top, right: left + rect.width * scale, bottom: top + rect.height * scale }
}
