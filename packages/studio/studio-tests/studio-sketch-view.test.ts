import { Expect, Test } from '@shared/test'
import { StudioSketchMutationLane } from '../studio-src/client/StudioMatrixView'
import { StudioSketchGeometry } from '../studio-src/client/StudioSketchGeometry'
import {
  StudioSketchChanges,
  StudioSketchOuterDrawing,
} from '../studio-src/client/StudioSketchView'
import type { StudioSketchRect } from '../studio-src/StudioSketchCatalog'

Test('Studio outer sketch drawing normalizes 360x76 and ignores taps, cancellation, and stray pointers', () => {
  const gesture = StudioSketchOuterDrawing.begin(undefined, 1, { x: 420, y: 100 })
  Expect(StudioSketchOuterDrawing.end(gesture, 2, { x: 60, y: 24 })).toEqual({ gesture })
  Expect(StudioSketchOuterDrawing.end(gesture, 1, { x: 60.4, y: 23.6 })).toEqual({
    size: { height: 76, width: 360 },
  })

  const tap = StudioSketchOuterDrawing.begin(undefined, 3, { x: 10, y: 10 })
  Expect(StudioSketchOuterDrawing.end(tap, 3, { x: 11, y: 11 })).toEqual({})
  Expect(StudioSketchOuterDrawing.cancel(tap, 4)).toBe(tap)
  Expect(StudioSketchOuterDrawing.cancel(tap, 3)).toBeUndefined()
})

Test('Studio overlay geometry preserves order across draw, move, duplicate, resize, and cancel', () => {
  const original = testRects()
  let state = StudioSketchGeometry.initial(original)
  state = StudioSketchGeometry.beginDraw(state, 'drawn', { x: 250, y: 10 })
  state = StudioSketchGeometry.endPointer(state, { x: 300, y: 50 })
  Expect(state.rects.map(rect => rect.id)).toEqual(['back', 'front', 'drawn'])

  state = StudioSketchGeometry.beginMove(state, { x: 260, y: 20 })
  state = StudioSketchGeometry.endPointer(state, { x: 270, y: 25 })
  Expect(state.rects.at(-1)).toMatchObject({ height: 40, width: 50, x: 260, y: 15 })

  state = StudioSketchGeometry.beginMove(state, { x: 270, y: 25 }, { duplicateId: 'copy', optionKey: true })
  state = StudioSketchGeometry.endPointer(state, { x: 280, y: 30 })
  Expect(state.rects.map(rect => rect.id)).toEqual(['back', 'front', 'drawn', 'copy'])

  state = StudioSketchGeometry.beginResize(state, 'east', { x: 320, y: 30 })
  state = StudioSketchGeometry.endPointer(state, { x: 340, y: 30 })
  Expect(state.rects.at(-1)?.width).toBe(70)

  state = StudioSketchGeometry.beginDraw(state, 'cancelled', { x: 5, y: 5 })
  state = StudioSketchGeometry.updatePointer(state, { x: 40, y: 40 })
  state = StudioSketchGeometry.cancelPointer(state)
  Expect(state.rects.some(rect => rect.id === 'cancelled')).toBe(false)
})

Test('Studio sketch changes prefer authoritative duplicate order and serialize revision reads', async () => {
  const sketch = {
    height: 76,
    id: 'sketch-1',
    name: 'View1',
    project: 'music',
    rects: testRects(),
    view: 'View1',
    width: 360,
  }
  const copy = { ...sketch.rects[0]!, id: 'copy' }
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]! })).toBe(true)
  Expect(StudioSketchChanges.equal(sketch.rects[0]!, { ...sketch.rects[0]!, x: 11 })).toBe(false)
  const authoritative = [{ ...sketch, rects: [sketch.rects[0]!, copy, sketch.rects[1]!] }]
  Expect(
    StudioSketchChanges.settle([sketch], {
      kind: 'duplicate',
      rect: copy,
      sketchId: sketch.id,
      sourceRectId: sketch.rects[0]!.id,
    }, authoritative)[0]?.rects.map(rect => rect.id),
  ).toEqual(['back', 'copy', 'front'])

  const lane = new StudioSketchMutationLane()
  const revisions: number[] = []
  let revision = 0
  let releaseFirst: (() => void) | undefined
  const first = lane.run(async () => {
    revisions.push(revision)
    await new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    revision = 1
  })
  const second = lane.run(async () => {
    revisions.push(revision)
    revision = 2
  })
  await Promise.resolve()
  Expect(revisions).toEqual([0])
  releaseFirst!()
  await Promise.all([first, second])
  Expect(revisions).toEqual([0, 1])
})

function testRects(): readonly StudioSketchRect[] {
  return [
    { height: 20, id: 'back', kind: 'Placeholder', width: 20, x: 10, y: 10 },
    { content: 'Front', height: 20, id: 'front', kind: 'Text', width: 20, x: 40, y: 10 },
  ]
}
