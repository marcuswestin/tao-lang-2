import { Expect, Test } from '@shared/test'
import { studioCanvasSelectionBounds } from '../studio-src/client/app/StudioCanvasTargets'
import type { StudioPreviewConnection } from '../studio-src/client/StudioMatrixView'
import type { StudioInspectorSelection } from '../studio-src/StudioInspector'
import type { StudioPreviewLayoutMeasurementsMessage } from '../studio-src/StudioProtocol'

Test('canvas selection framing uses scrolled viewport coordinates at current zoom and refuses stale geometry', () => {
  const identity = {
    project: '/project',
    appName: 'App',
    previewInstanceId: 'preview',
    cellId: 'cell',
    cellRevision: 1,
    compileRevision: 2,
    manifestRevision: 'manifest',
  }
  const selection: StudioInspectorSelection = {
    identity: { ...identity, path: '/project/App.tao', sourceVersion: 'source' },
    renderId: '/project/App.tao:1:4',
    range: { start: 1, end: 4 },
  }
  const measurements: StudioPreviewLayoutMeasurementsMessage = {
    identity,
    channel: 'tao-studio',
    protocolVersion: 1,
    type: 'preview-layout-measurements',
    measurements: [{
      renderId: selection.renderId,
      elementName: 'Text',
      rect: { x: 10, y: 700, width: 100, height: 30 },
      viewportRect: { x: 10, y: -5, width: 100, height: 30 },
    }],
  }
  const iframe = {
    offsetWidth: 400,
    getBoundingClientRect: () => ({ left: 50, top: 70, width: 800 }),
  } as HTMLIFrameElement
  const host = { contains: (node: unknown) => node === iframe } as HTMLElement
  const preview = {
    iframe,
    interactionMode: 'edit',
    origin: 'http://preview.local',
    previewInstanceId: 'preview',
    cellIdentity: identity,
    layoutMeasurements: measurements,
  } as StudioPreviewConnection
  Expect(studioCanvasSelectionBounds(host, selection, [preview])).toEqual({
    left: 70,
    top: 60,
    right: 270,
    bottom: 120,
  })
  preview.cellIdentity = { ...preview.cellIdentity!, compileRevision: 3 }
  Expect(studioCanvasSelectionBounds(host, selection, [preview])).toBeUndefined()
  preview.cellIdentity = identity
  preview.layoutMeasurements = {
    ...measurements,
    measurements: [{ ...measurements.measurements[0]!, viewportRect: undefined }],
  }
  Expect(studioCanvasSelectionBounds(host, selection, [preview])).toBeUndefined()
})
