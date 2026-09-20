// Semantic agent proof of concept: the parts of feature planning that Tao decides, without the model.
//
// The snapshots here are built by hand from a source string so every offset is real and the assertions are
// about placement and validation, not about what the on-device model happens to say on a given day.
import { Describe, Expect, Test } from '@shared/test'
import type { SemanticSnapshot, SnapshotNode } from '@workspace'
import {
  type FeatureShape,
  lowerFeature,
  lowerReword,
  type RewordShape,
  textCandidates,
} from '../studio-src/agent-chat/FeaturePlan'

const PATH = 'App.tao'

const SOURCE = `use Col, Text from @tao/ui

app Reader {
   Name "Reader"
}

data Stories / Story {
   Title text
   Score number
}

view StoryRow(Story) {
   render Col() [card] {
      Text("{ Story.Score } points by { Story.Title }")
}  }
`

/** span locates a snippet in the fixture source so a node carries the offsets it would really have. */
function span(needle: string): { start: number; end: number } {
  const start = SOURCE.indexOf(needle)
  Expect(start).not.toBe(-1)
  return { end: start + needle.length, start }
}

function snapshot(): SemanticSnapshot {
  const nodes = new Map<string, SnapshotNode>()
  const add = (node: SnapshotNode) => nodes.set(node.id, node)
  add({ id: 'app:Reader', kind: 'app', name: 'Reader', path: PATH, ...span('app Reader {\n   Name "Reader"\n}') })
  add({
    detail: { fields: [{ name: 'Title', type: 'text' }, { name: 'Score', type: 'number' }], singular: 'Story' },
    id: 'entity:Stories',
    kind: 'entity',
    name: 'Stories',
    path: PATH,
    ...span('data Stories / Story {'),
  })
  add({
    detail: { entity: 'Stories', hasDefault: false, type: 'text' },
    id: 'field:Story.Title',
    kind: 'field',
    name: 'Story.Title',
    path: PATH,
    ...span('Title text'),
  })
  add({
    detail: { entity: 'Stories', hasDefault: false, type: 'number' },
    id: 'field:Story.Score',
    kind: 'field',
    name: 'Story.Score',
    path: PATH,
    ...span('Score number'),
  })
  add({
    detail: {
      actions: [],
      parameters: ['Story (entity Stories)'],
      queries: [],
      states: [],
      visibility: 'file',
    },
    id: 'view:StoryRow',
    kind: 'view',
    name: 'StoryRow',
    path: PATH,
    ...span('view StoryRow(Story) {'),
  })
  const outer = span('Col() [card] {\n      Text("{ Story.Score } points by { Story.Title }")\n}  }')
  add({
    detail: { layout: ['card'], owner: 'StoryRow', target: 'Col' },
    id: `render:${PATH}:${outer.start}:${outer.end}`,
    kind: 'render',
    name: 'Col',
    path: PATH,
    ...outer,
  })
  const inner = span('Text("{ Story.Score } points by { Story.Title }")')
  add({
    detail: {
      layout: [],
      owner: 'StoryRow',
      target: 'Text',
      texts: [{
        ...span('"{ Story.Score } points by { Story.Title }"'),
        text: '"{ Story.Score } points by { Story.Title }"',
      }],
    },
    id: `render:${PATH}:${inner.start}:${inner.end}`,
    kind: 'render',
    name: 'Text',
    path: PATH,
    ...inner,
  })
  return {
    appName: 'Reader',
    diagnostics: [],
    edges: [],
    nodes,
    projectRoot: '.',
  }
}

const readFile = async () => SOURCE

function rewordShape(newText: string): RewordShape {
  return { featureName: 'Reword', newText, summary: 'x', textHandle: 'T1' }
}

const FLAG_SHAPE: FeatureShape = {
  entity: 'Stories',
  featureName: 'Bookmark stories',
  fieldKind: 'yes/no',
  fieldName: 'Bookmarked',
  label: 'Bookmark',
  presentIn: 'StoryRow',
  scenarioName: 'bookmarked',
  summary: 'x',
}

Describe('Agent feature lowering', () => {
  Test('lists every literal a view renders as a rewordable candidate', () => {
    const candidates = textCandidates(snapshot())

    Expect(candidates.length).toBe(1)
    Expect(candidates[0]!.handle).toBe('T1')
    Expect(candidates[0]!.view).toBe('StoryRow')
    Expect(candidates[0]!.text).toBe('"{ Story.Score } points by { Story.Title }"')
  })

  Test('rewords a line in place, keeping every placeholder', async () => {
    const problems: string[] = []
    const result = await lowerReword(
      snapshot(),
      textCandidates(snapshot()),
      rewordShape('{ Story.Title } — { Story.Score } points'),
      readFile,
      problems,
    )

    Expect(problems).toEqual([])
    Expect(result.edits.length).toBe(1)
    Expect(result.edits[0]!.after).toContain('Text("{ Story.Title } — { Story.Score } points")')
    Expect(result.edits[0]!.after).not.toContain('points by')
    Expect(result.steps[0]!.decidedBy).toBe('model')
  })

  Test('rejects a reword that invents a value the view cannot show', async () => {
    const problems: string[] = []
    const result = await lowerReword(
      snapshot(),
      textCandidates(snapshot()),
      rewordShape('{ Story.Score } points, { Story.CommentCount } comments'),
      readFile,
      problems,
    )

    Expect(result.edits).toEqual([])
    Expect(problems[0]).toContain('{ Story.CommentCount }')
    Expect(problems[0]).toContain('StoryRow')
  })

  Test('accepts a reword that reaches another field of the entity the view takes', async () => {
    const problems: string[] = []
    const result = await lowerReword(
      snapshot(),
      textCandidates(snapshot()),
      rewordShape('{ Story.Title }'),
      readFile,
      problems,
    )

    Expect(problems).toEqual([])
    Expect(result.edits.length).toBe(1)
    Expect(result.steps[0]!.note).toContain('{ Story.Score }')
  })

  Test('rejects a reword that changes nothing', async () => {
    const problems: string[] = []
    const result = await lowerReword(
      snapshot(),
      textCandidates(snapshot()),
      rewordShape('{ Story.Score } points by { Story.Title }'),
      readFile,
      problems,
    )

    Expect(result.edits).toEqual([])
    Expect(problems[0]).toContain('no-op rejected')
  })

  Test('rejects a reword carrying a quote that would not parse', async () => {
    const problems: string[] = []
    const result = await lowerReword(
      snapshot(),
      textCandidates(snapshot()),
      rewordShape('{ Story.Score } "points"'),
      readFile,
      problems,
    )

    Expect(result.edits).toEqual([])
    Expect(problems[0]).toContain('quote')
  })

  Test('places a first flag from the view structure when no yes/no field exists to copy', async () => {
    const problems: string[] = []
    const result = await lowerFeature(snapshot(), { ...FLAG_SHAPE }, readFile, problems)

    Expect(problems).toEqual([])
    // One file holds the entity, the view and the app, so it must be rewritten once, not once per placement.
    Expect(result.edits.length).toBe(1)
    const after = result.edits[0]!.after
    Expect(after).toContain('Score number\n   Bookmarked yes / no')
    Expect(after).toContain('action SetBookmarked(Value boolean)')
    Expect(after).toContain('Bookmarked: Value')
    Expect(after).toContain('#markBookmarked')
    // The control belongs beside the text, inside the card, not after the container closes.
    Expect(after.indexOf('#markBookmarked')).toBeGreaterThan(after.indexOf('points by'))
    Expect(after).toContain('use Checkbox, Col, Text from @tao/ui')
    Expect(result.steps.some(step => step.action.includes('no yes/no field to copy'))).toBe(true)
    Expect(result.steps.some(step => step.status === 'unsupported' && step.action.includes('scenario'))).toBe(true)
  })

  Test('repairs a field name the model wrote in prose case instead of refusing the shape', async () => {
    const problems: string[] = []
    const result = await lowerFeature(snapshot(), { ...FLAG_SHAPE, fieldName: 'bookmarked' }, readFile, problems)

    Expect(problems).toEqual([])
    Expect(result.steps[0]!.decidedBy).toBe('tao')
    Expect(result.steps[0]!.action).toBe('capitalize the field name: bookmarked → Bookmarked')
    Expect(result.edits[0]!.after).toContain('Bookmarked yes / no')
  })

  Test('refuses a field kind it cannot lower without pretending to place it', async () => {
    const problems: string[] = []
    const result = await lowerFeature(snapshot(), { ...FLAG_SHAPE, fieldKind: 'text' }, readFile, problems)

    Expect(result.edits).toEqual([])
    Expect(result.steps[0]!.status).toBe('unsupported')
    Expect(result.steps[0]!.note).toContain('yes/no')
  })
})
