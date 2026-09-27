import { Describe, Expect, Test } from '@shared/test'
import type { StudioLayoutEntry, StudioRenderInspection } from '@source-actions'
import {
  renderRange,
  studioCarriedMeasurement,
  studioSelectionCarry,
} from '../studio-src/client/app/StudioSelectionCarry'
import {
  studioSelectionHudAction,
  studioSelectionHudModel,
  studioSelectionHudPlacement,
} from '../studio-src/client/app/StudioSelectionHud'
import { StudioInspector } from '../studio-src/StudioInspector'
import {
  type StudioPreviewLayoutMeasurement,
  type StudioPreviewLayoutMeasurementsMessage,
  studioProtocolChannel,
  studioProtocolVersion,
} from '../studio-src/StudioProtocol'

const path = '/workspace/app/Main.tao'

function inspection(elementName: string, layoutEntries: readonly StudioLayoutEntry[]): StudioRenderInspection {
  return {
    elementName,
    explorations: [],
    layoutEntries,
    renderId: `${path}:10:40`,
    styleEntries: [],
    styleProvenance: [],
  }
}

function selection(start: number, end: number) {
  return StudioInspector.selection({
    channel: studioProtocolChannel,
    identity: {
      appName: 'Garden',
      compileRevision: 1,
      occurrence: { nodeKind: 'render', renderOwner: 'Main' },
      path,
      previewInstanceId: 'preview-1',
      project: '/workspace',
      sourceVersion: 'source-1',
    },
    protocolVersion: studioProtocolVersion,
    range: { end, start },
    type: 'preview-select-source',
  })
}

function layout(
  compileRevision: number,
  measurements: readonly StudioPreviewLayoutMeasurement[],
): StudioPreviewLayoutMeasurementsMessage {
  return {
    channel: studioProtocolChannel,
    identity: { appName: 'Garden', compileRevision, previewInstanceId: 'preview-1', project: '/workspace' },
    measurements,
    protocolVersion: studioProtocolVersion,
    type: 'preview-layout-measurements',
  }
}

function measured(
  elementName: string,
  start: number,
  end: number,
  x: number,
  y: number,
): StudioPreviewLayoutMeasurement {
  return { elementName, rect: { height: 40, width: 100, x, y }, renderId: `${path}:${start}:${end}` }
}

Describe('Studio selection HUD', () => {
  Test('reads direction, alignment, gap, pad and sizing from the inspected layout', () => {
    Expect(
      studioSelectionHudModel(inspection('Col', [['gap', 12], ['pad', 'horizontal', 8], ['aligned', 'left'], ['hug']])),
    )
      .toEqual({
        alignment: 'left',
        direction: 'Col',
        element: 'Col',
        gap: '12',
        pad: 'horizontal 8',
        sizing: 'hug',
      })
    const text = studioSelectionHudModel(inspection('Text', [['claim', 2]]))
    Expect(text.direction).toBeUndefined()
    Expect(text.alignment).toBe('unset')
    Expect(text.sizing).toBe('claim 2')
  })

  Test('commits one source action per control, and nothing for an invalid draft', () => {
    const renderId = `${path}:10:40`
    Expect(studioSelectionHudAction(renderId, 'direction', 'Row')).toEqual({ kind: 'toggle-flow-direction', renderId })
    Expect(studioSelectionHudAction(renderId, 'gap', '16')).toEqual({
      entry: ['gap', 16],
      kind: 'set-layout-entry',
      renderId,
    })
    Expect(studioSelectionHudAction(renderId, 'pad', 'vertical 4')).toEqual({
      entry: ['pad', 'vertical', 4],
      kind: 'set-layout-entry',
      renderId,
    })
    Expect(studioSelectionHudAction(renderId, 'alignment', 'center')?.['entry']).toEqual(['aligned', 'center'])
    Expect(studioSelectionHudAction(renderId, 'alignment', 'centered')?.['entry']).toEqual(['centered'])
    Expect(studioSelectionHudAction(renderId, 'sizing', 'fill')?.['entry']).toEqual(['fill'])
    Expect(studioSelectionHudAction(renderId, 'gap', '-3')).toBeUndefined()
    Expect(studioSelectionHudAction(renderId, 'sizing', 'unset')).toBeUndefined()
  })

  Test('sits under the selection, above it when there is no room below, and inside the host', () => {
    const host = { bottom: 600, left: 100, right: 900, top: 0 }
    const hud = { height: 30, width: 300 }
    Expect(studioSelectionHudPlacement({ bottom: 200, left: 150, right: 250, top: 100 }, host, hud))
      .toEqual({ left: 50, top: 208 })
    Expect(studioSelectionHudPlacement({ bottom: 590, left: 150, right: 250, top: 500 }, host, hud))
      .toEqual({ left: 50, top: 462 })
    Expect(studioSelectionHudPlacement({ bottom: 200, left: 850, right: 890, top: 100 }, host, hud).left).toBe(492)
  })
})

Describe('Studio selection carry', () => {
  Test('parses render ids from the end, so paths may contain colons', () => {
    Expect(renderRange('/a:b/Main.tao:10:40')).toEqual({ end: 40, path: '/a:b/Main.tao', start: 10 })
    Expect(renderRange('nonsense')).toBeUndefined()
  })

  Test('follows an edited element to the render that starts where it started', () => {
    const before = layout(1, [measured('Col', 10, 40, 0, 0), measured('Text', 20, 30, 0, 0)])
    const carry = studioSelectionCarry(
      selection(10, 40),
      { entry: ['gap', 16], kind: 'set-layout-entry', renderId: `${path}:10:40` },
      before,
      0,
    )
    Expect(carry).toBeDefined()
    Expect(studioCarriedMeasurement(carry!, before)).toBeUndefined()
    const after = layout(2, [measured('Text', 20, 30, 0, 0), measured('Col', 10, 49, 0, 0)])
    Expect(studioCarriedMeasurement(carry!, after)?.renderId).toBe(`${path}:10:49`)
  })

  Test('finds a flipped Row by where it sits when an added import moved its source', () => {
    const carry = studioSelectionCarry(
      selection(10, 40),
      { kind: 'toggle-flow-direction', renderId: `${path}:10:40` },
      layout(1, [measured('Col', 10, 40, 20, 20)]),
      0,
    )
    const after = layout(2, [measured('Row', 15, 45, 22, 20), measured('Text', 20, 30, 400, 400)])
    Expect(studioCarriedMeasurement(carry!, after)?.renderId).toBe(`${path}:15:45`)
    Expect(studioCarriedMeasurement(carry!, layout(2, [measured('Row', 15, 45, 300, 300)]))).toBeUndefined()
  })

  Test('carries only in-place edits of the selected element', () => {
    const before = layout(1, [measured('Col', 10, 40, 0, 0)])
    Expect(studioSelectionCarry(selection(10, 40), { kind: 'remove-render', renderId: `${path}:10:40` }, before, 0))
      .toBeUndefined()
    Expect(
      studioSelectionCarry(
        selection(10, 40),
        { entry: ['gap', 1], kind: 'set-layout-entry', renderId: `${path}:50:60` },
        before,
        0,
      ),
    ).toBeUndefined()
  })
})
