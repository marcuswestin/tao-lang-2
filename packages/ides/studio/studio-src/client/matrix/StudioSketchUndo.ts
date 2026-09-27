import { Switch } from '@shared/core'
import type {
  StudioSketch,
  StudioSketchCatalogAction,
  StudioSketchRect,
} from '../../StudioSketchCatalog'

/** The part of a sketch a drawing edit changes, and so the part its undo puts back. */
export type StudioSketchGeometry = Readonly<{
  rectOrder: readonly string[]
  rects: readonly StudioSketchRect[]
  x: number
  y: number
}>

/**
 * Undo for Draw edits. A catalog-only edit (drawing, moving, resizing, retyping, duplicating, or
 * deleting a rectangle, or moving a frame) records the sketch's geometry before and after, and undo
 * writes the before geometry back only while the sketch still holds the after geometry. Snap, Unsnap,
 * and creating or removing a sketch write source files and keep their own paths.
 */
export const StudioSketchUndo = {
  geometry(sketch: StudioSketch): StudioSketchGeometry {
    return { rectOrder: sketch.rectOrder, rects: sketch.rects, x: sketch.x, y: sketch.y }
  },
  same(left: StudioSketchGeometry, right: StudioSketchGeometry): boolean {
    return JSON.stringify(left) === JSON.stringify(right)
  },
  restore(sketchId: string, geometry: StudioSketchGeometry): StudioSketchCatalogAction {
    return { kind: 'restore-sketch', sketchId, ...geometry }
  },
  /** How the edit log names a drawing edit; undefined for actions this undo does not cover. */
  label(actions: readonly StudioSketchCatalogAction[], before: StudioSketch): string | undefined {
    const [first] = actions
    if (first === undefined) {
      return undefined
    }
    if (first.kind === 'delete-rect') {
      return actions.length === 1 ? 'Delete rectangle' : `Delete ${actions.length} rectangles`
    }
    if (actions.length !== 1) {
      return undefined
    }
    const uncovered = () => undefined
    return Switch.kind<StudioSketchCatalogAction, string | undefined>(first, {
      'add-rect': added => `Draw ${added.rect.kind}`,
      'bind-rect': uncovered,
      'create-sketch': uncovered,
      'delete-rect': () => 'Delete rectangle',
      'delete-sketch': uncovered,
      'duplicate-rect': () => 'Duplicate rectangle',
      'move-sketch': () => `Move ${before.name}`,
      'refresh-snap-targets': uncovered,
      'restore-sketch': uncovered,
      'set-sketch-source': uncovered,
      'snap-rects': uncovered,
      'unsnap-rects': uncovered,
      'update-rect': updated => updatePhrase(before.rects.find(rect => rect.id === updated.rectId), updated.rect),
    })
  },
} as const

function updatePhrase(prior: StudioSketchRect | undefined, next: StudioSketchRect): string {
  if (prior === undefined) {
    return 'Edit rectangle'
  }
  if (prior.kind !== next.kind) {
    return `Make ${next.kind}`
  }
  if (prior.content !== next.content) {
    return 'Edit text'
  }
  if (prior.width !== next.width || prior.height !== next.height) {
    return 'Resize rectangle'
  }
  return prior.x !== next.x || prior.y !== next.y ? 'Move rectangle' : 'Edit rectangle'
}
