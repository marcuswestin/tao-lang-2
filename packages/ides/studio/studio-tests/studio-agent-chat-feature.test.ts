// Semantic agent proof of concept: the parts of feature planning that Tao decides, without the model.
//
// Focused placement snapshots use real source offsets; import regressions validate real project files.
import { buildSemanticSnapshot, type SemanticSnapshot, type SnapshotNode, Workspace } from '@compiler/workspace'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import {
  type FeatureShape,
  lowerFeature,
  lowerReword,
  type RewordShape,
  textCandidates,
} from '../studio-src/agent-chat/FeaturePlan'

const PATH = 'App.tao'

const SOURCE = `use Col, Text from @tao/ui

app Reader { id "reader" version "1.0.0" name "Reader"
}

data Stories / Story {
   Title text,
   Score number
}

view StoryRow(Story) {
   render Col() [card] {
      Text("{ Story.Score } points by { Story.Title }")
}  }
`

function snapshot(source = SOURCE): SemanticSnapshot {
  /** span locates a snippet in the fixture source so a node carries the offsets it would really have. */
  function span(needle: string): { start: number; end: number } {
    const start = source.indexOf(needle)
    Expect(start).not.toBe(-1)
    return { end: start + needle.length, start }
  }
  const nodes = new Map<string, SnapshotNode>()
  const add = (node: SnapshotNode) => nodes.set(node.id, node)
  add({
    id: 'app:Reader',
    kind: 'app',
    name: 'Reader',
    path: PATH,
    ...span('app Reader { id "reader" version "1.0.0" name "Reader"\n}'),
  })
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
  Test('imports the singular fixture entity even when its plural is already imported', async () => {
    await withTaoFiles('feature-singular-import-', {
      'App.tao': `
        use Stories from @data
        use Home from @ui
        app Reader { id "reader" version "1.0.0" name "Reader" view Home }
        fixture Preview { }
      `,
      'packages/@data/Data.tao': `
        public data Stories / Story {
          Title text,
          Score number
        }
      `,
      'packages/@ui/Views.tao': `
        use Story from @data
        use Col, Text from @tao/ui
        public view Home() { render Text("Stories") }
        public view StoryRow(Story) {
          render Col() {
            Text(Story.Title)
          }
        }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await workspace.validate(paths['App.tao'])
      Expect(before.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const semantic = buildSemanticSnapshot(root, 'Reader', before.files, before.diagnostics)
      const problems: string[] = []
      const result = await lowerFeature(
        semantic,
        { ...FLAG_SHAPE },
        path => FS.readText(FS.resolvePath(path, root)),
        problems,
      )

      Expect(problems).toEqual([])
      Expect(result.steps.every(step => step.status === 'ready')).toBe(true)
      const entry = result.edits.find(edit => edit.path === 'App.tao')
      Expect(entry?.before).toContain('use Stories from @data')
      Expect(entry?.after).toContain('use Stories, Story from @data')
      Expect(entry?.after).toContain('BookmarkedStory = create Story')
      Expect(result.steps.some(step => step.action.includes('importing Story from @data'))).toBe(true)
      for (const edit of result.edits) {
        await FS.writeText(FS.resolvePath(edit.path, root), edit.after)
      }
      const compiled = await workspace.compile(paths['App.tao'], { studio: true })
      Expect(compiled.studioManifest?.fixtures[0]?.creates).toContainEqual({
        entity: 'Story',
        fields: { Bookmarked: true, Score: 1, Title: 'Bookmark sample' },
        name: 'BookmarkedStory',
      })
    })
  })

  Test('lists every literal a view renders as a rewordable candidate', () => {
    const candidates = textCandidates(snapshot())

    Expect(candidates.length).toBe(1)
    Expect(candidates[0]!.handle).toBe('T1')
    Expect(candidates[0]!.view).toBe('StoryRow')
    Expect(candidates[0]!.text).toBe('"{ Story.Score } points by { Story.Title }"')
  })

  Test('keeps a locally declared fixture entity free of a data import', async () => {
    await withTaoFiles('feature-local-fixture-', {
      'App.tao': `
        use Col, Text from @tao/ui
        app Reader { id "reader" version "1.0.0" name "Reader" view Home }
        data Stories / Story {
          Title text,
          Score number
        }
        view Home() { render Text("Stories") }
        public view StoryRow(Story) {
          render Col() {
            Text(Story.Title)
          }
        }
        fixture Preview { }
      `,
    }, async (paths, root) => {
      const workspace = await Workspace.open(root)
      const before = await workspace.validate(paths['App.tao'])
      Expect(before.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([])
      const problems: string[] = []
      const result = await lowerFeature(
        buildSemanticSnapshot(root, 'Reader', before.files, before.diagnostics),
        { ...FLAG_SHAPE },
        path => FS.readText(FS.resolvePath(path, root)),
        problems,
      )

      Expect(problems).toEqual([])
      Expect(result.edits).toHaveLength(1)
      const entry = result.edits[0]!
      Expect(entry.after).toContain('BookmarkedStory = create Story')
      Expect(entry.after).not.toContain('from @data')
      await FS.writeText(paths['App.tao'], entry.after)
      const compiled = await workspace.compile(paths['App.tao'], { studio: true })
      Expect(compiled.studioManifest?.fixtures[0]?.creates[0]?.entity).toBe('Story')
    })
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
    Expect(after).toContain('Score number,\n   Bookmarked yes / no')
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

  Test('preserves the anchor field comment with or without a trailing comma', async () => {
    for (const suffix of [' // Original score', ', // Original score']) {
      const source = SOURCE.replace('Score number\n', `Score number${suffix}\n`)
      const problems: string[] = []
      const result = await lowerFeature(snapshot(source), { ...FLAG_SHAPE }, async () => source, problems)

      Expect(problems).toEqual([])
      Expect(result.edits[0]!.after).toContain('Score number, // Original score\n   Bookmarked yes / no,')
    }
  })

  Test('refuses a field kind it cannot lower without pretending to place it', async () => {
    const problems: string[] = []
    const result = await lowerFeature(snapshot(), { ...FLAG_SHAPE, fieldKind: 'text' }, readFile, problems)

    Expect(result.edits).toEqual([])
    Expect(result.steps[0]!.status).toBe('unsupported')
    Expect(result.steps[0]!.note).toContain('yes/no')
  })
})
