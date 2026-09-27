import { Expect, Test } from '@shared/test'
import { StudioSketchBadge } from '../studio-src/client/StudioSketchBadge'
import type { StudioSketch } from '../studio-src/StudioSketchCatalog'

const drawn: Pick<StudioSketch, 'definitionPath' | 'id' | 'rects' | 'render' | 'snapped' | 'view'> = {
  id: 'sketch-1',
  rects: [],
  snapped: [],
  view: 'View1',
}

Test('Studio sketch badge offers every other renderable view to an empty drawn rectangle', () => {
  Expect(StudioSketchBadge.role(drawn)).toBe('definition')
  Expect(StudioSketchBadge.sourceBacked(drawn)).toBe(false)
  Expect(StudioSketchBadge.items(drawn, ['StoryRow', 'View1', 'CommentRow'])).toEqual([
    { intent: { sketchId: 'sketch-1', to: 'render', view: 'StoryRow' }, kind: 'action', label: 'Render StoryRow' },
    { intent: { sketchId: 'sketch-1', to: 'render', view: 'CommentRow' }, kind: 'action', label: 'Render CommentRow' },
  ])
  Expect(StudioSketchBadge.items(drawn, ['View1'])).toEqual([
    { kind: 'note', label: 'No other view has a scenario to start a render from yet.' },
  ])
})

Test('Studio sketch badge says why a drawn or written definition cannot switch to a render', () => {
  const withRects = { ...drawn, rects: [{ height: 10, id: 'r', kind: 'Text' as const, width: 10, x: 0, y: 0 }] }
  Expect(StudioSketchBadge.items(withRects, ['StoryRow'])).toEqual([
    { kind: 'note', label: 'Clear the drawn rectangles to render an existing view here instead.' },
  ])
  const written = { ...drawn, definitionPath: 'Rows.tao' }
  Expect(StudioSketchBadge.sourceBacked(written)).toBe(true)
  Expect(StudioSketchBadge.items(written, ['StoryRow'])).toEqual([
    { kind: 'note', label: 'View1 is written in Rows.tao; edit it there.' },
  ])
})

Test('Studio sketch badge detaches a render into the view the rectangle already names', () => {
  const render = {
    ...drawn,
    render: { group: 'rows', path: 'Rows.scenarios.tao', scenario: 'drawn1', view: 'StoryRow' },
  }
  Expect(StudioSketchBadge.role(render)).toBe('render')
  Expect(StudioSketchBadge.items(render, ['StoryRow'])).toEqual([
    { intent: { sketchId: 'sketch-1', to: 'definition' }, kind: 'action', label: 'Detach into a new view, View1' },
  ])
})
