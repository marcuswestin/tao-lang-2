import { Describe, Expect, Test } from '@shared/test'
import {
  StudioSketchGeometry,
  type StudioSketchGeometryState,
  type StudioSketchRect,
  type StudioSketchResizeHandle,
} from '../studio-src/client/StudioSketchGeometry'

const first: StudioSketchRect = {
  binding: 'Playlist.Cover',
  content: 'Cover art',
  height: 20,
  id: 'first',
  kind: 'Placeholder',
  width: 30,
  x: 10,
  y: 20,
}

Describe('Studio sketch geometry', () => {
  Test('normalizes reverse drawing and rejects either dimension below the minimum threshold', () => {
    const drawn = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginDraw(StudioSketchGeometry.initial(), 'drawn', { x: 20, y: 30 }),
      { x: 5, y: 10 },
    )
    Expect(drawn).toEqual({
      rects: [{ height: 20, id: 'drawn', kind: 'Placeholder', width: 15, x: 5, y: 10 }],
      selectedId: 'drawn',
    })

    const boundary = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginDraw(drawn, 'boundary', { x: 0, y: 0 }, { content: 'Text', kind: 'Text' }),
      { x: StudioSketchGeometry.minimumDrawExtent, y: StudioSketchGeometry.minimumDrawExtent },
    )
    Expect(boundary.rects.at(-1)).toMatchObject({
      content: 'Text',
      height: StudioSketchGeometry.minimumDrawExtent,
      width: StudioSketchGeometry.minimumDrawExtent,
    })

    const rejected = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginDraw(boundary, 'tiny', { x: 0, y: 0 }),
      { x: StudioSketchGeometry.minimumDrawExtent - 1, y: 100 },
    )
    Expect(rejected).toEqual(boundary)
  })

  Test('hits the frontmost rectangle and selects inclusively at its edge', () => {
    const front = { ...first, id: 'front', x: 20, y: 25 }
    const state = StudioSketchGeometry.initial([first, front])

    Expect(StudioSketchGeometry.hit(state.rects, { x: 25, y: 30 })?.id).toBe('front')
    Expect(StudioSketchGeometry.select(state, { x: 40, y: 40 }).selectedId).toBe('front')
    Expect(StudioSketchGeometry.select(state, { x: 100, y: 100 }).selectedId).toBeUndefined()
  })

  Test('moves a hit rectangle while retaining every FS-D1 content field and nonnegative origin', () => {
    const moved = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginMove(StudioSketchGeometry.initial([first]), { x: 15, y: 25 }),
      { x: 3, y: 8 },
    )
    Expect(moved.rects).toEqual([{ ...first, x: 0, y: 3 }])
    Expect(moved.selectedId).toBe('first')
  })

  Test('resizes from all eight handles and clamps before dimensions become non-positive', () => {
    const expected: Record<StudioSketchResizeHandle, Partial<StudioSketchRect>> = {
      east: { width: 35 },
      north: { height: 26, y: 14 },
      'north-east': { height: 26, width: 35, y: 14 },
      'north-west': { height: 26, width: 25, x: 15, y: 14 },
      south: { height: 14 },
      'south-east': { height: 14, width: 35 },
      'south-west': { height: 14, width: 25, x: 15 },
      west: { width: 25, x: 15 },
    }
    for (const handle of Object.keys(expected) as StudioSketchResizeHandle[]) {
      const selected = { ...StudioSketchGeometry.initial([first]), selectedId: first.id }
      const resized = StudioSketchGeometry.endPointer(
        StudioSketchGeometry.beginResize(selected, handle, { x: 0, y: 0 }),
        { x: 5, y: -6 },
      )
      Expect(resized.rects[0]).toMatchObject(expected[handle])
    }

    const selected = { ...StudioSketchGeometry.initial([first]), selectedId: first.id }
    const clamped = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginResize(selected, 'north-west', { x: 0, y: 0 }),
      { x: 100, y: 100 },
    )
    Expect(clamped.rects[0]).toMatchObject({ height: 1, width: 1, x: 39, y: 39 })

    const canvasClamped = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginResize(selected, 'north-west', { x: 0, y: 0 }),
      { x: -100, y: -100 },
    )
    Expect(canvasClamped.rects[0]).toMatchObject({ height: 40, width: 40, x: 0, y: 0 })
  })

  Test('cancels drawings, moves, resizes, and Option-drag duplicates transactionally', () => {
    const initial = { ...StudioSketchGeometry.initial([first]), selectedId: first.id }
    const gestures: StudioSketchGeometryState[] = [
      StudioSketchGeometry.updatePointer(
        StudioSketchGeometry.beginDraw(initial, 'drawn', { x: 0, y: 0 }),
        { x: 40, y: 40 },
      ),
      StudioSketchGeometry.updatePointer(
        StudioSketchGeometry.beginMove(initial, { x: 15, y: 25 }),
        { x: 40, y: 40 },
      ),
      StudioSketchGeometry.updatePointer(
        StudioSketchGeometry.beginResize(initial, 'south-east', { x: 0, y: 0 }),
        { x: 40, y: 40 },
      ),
      StudioSketchGeometry.updatePointer(
        StudioSketchGeometry.beginMove(initial, { x: 15, y: 25 }, { duplicateId: 'copy', optionKey: true }),
        { x: 40, y: 40 },
      ),
    ]
    for (const gesture of gestures) {
      Expect(StudioSketchGeometry.cancelPointer(gesture)).toEqual(initial)
    }
  })

  Test('Option-drag duplicates with the explicit stable ID and rejects an ID collision', () => {
    const initial = StudioSketchGeometry.initial([first])
    const duplicated = StudioSketchGeometry.endPointer(
      StudioSketchGeometry.beginMove(initial, { x: 15, y: 25 }, { duplicateId: 'copy-7', optionKey: true }),
      { x: 20, y: 35 },
    )
    Expect(duplicated.rects).toEqual([first, { ...first, id: 'copy-7', x: 15, y: 30 }])
    Expect(duplicated.selectedId).toBe('copy-7')
    Expect(
      StudioSketchGeometry.beginMove(duplicated, { x: 16, y: 31 }, { duplicateId: 'first', optionKey: true }),
    ).toBe(duplicated)
  })

  Test('updates kind and content inline without disturbing geometry or binding', () => {
    const selected = { ...StudioSketchGeometry.initial([first]), selectedId: first.id }
    const updated = StudioSketchGeometry.updateSelected(selected, { content: 'Now playing', kind: 'Text' })
    Expect(updated.rects).toEqual([{ ...first, content: 'Now playing', kind: 'Text' }])
  })
})
