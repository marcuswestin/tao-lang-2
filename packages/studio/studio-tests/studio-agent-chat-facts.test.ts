// Studio agent chat: the facts an advisory answer stands on.
//
// The snapshot is built by hand so each fact is provoked by an exact graph shape: a view no scenario covers,
// an action nothing invokes, a field written but never read. What is under test is what Tao is willing to
// claim, not what a model says about it.
import { Describe, Expect, Test } from '@shared/test'
import {
  declarationSource,
  fileOutlines,
  improvementFacts,
  type SemanticSnapshot,
  type SnapshotEdge,
  type SnapshotNode,
} from '@workspace'

const PATH = 'App.tao'

const SOURCE = `app Reader {
   Name "Reader"
}

data Stories / Story {
   Title text
   Seen boolean
}

view StoryRow(Story) {
   render Text(Story.Title)
}

action MarkSeen(Story) {
   set Story.Seen to true
}
`

function span(needle: string): { start: number; end: number } {
  const start = SOURCE.indexOf(needle)
  Expect(start).not.toBe(-1)
  return { end: start + needle.length, start }
}

type Build = { edges?: readonly SnapshotEdge[]; nodes?: readonly SnapshotNode[] }

function snapshot(build: Build = {}): SemanticSnapshot {
  const nodes = new Map<string, SnapshotNode>()
  const add = (node: SnapshotNode) => nodes.set(node.id, node)
  add({ id: 'app:Reader', kind: 'app', name: 'Reader', path: PATH, ...span('app Reader {') })
  add({ id: 'entity:Stories', kind: 'entity', name: 'Stories', path: PATH, ...span('data Stories / Story {') })
  add({ id: 'field:Story.Title', kind: 'field', name: 'Story.Title', path: PATH, ...span('Title text') })
  add({ id: 'field:Story.Seen', kind: 'field', name: 'Story.Seen', path: PATH, ...span('Seen boolean') })
  add({ id: 'view:StoryRow', kind: 'view', name: 'StoryRow', path: PATH, ...span('view StoryRow(Story) {') })
  add({ id: 'action:MarkSeen', kind: 'action', name: 'MarkSeen', path: PATH, ...span('action MarkSeen(Story) {') })
  for (const node of build.nodes ?? []) {
    add(node)
  }
  return {
    appName: 'Reader',
    diagnostics: [],
    edges: [
      {
        evidence: `${PATH}:0`,
        from: 'view:StoryRow',
        origin: 'compiler',
        rel: 'reads',
        to: 'field:Story.Title',
        via: 'render reads the field',
      },
      {
        evidence: `${PATH}:0`,
        from: 'action:MarkSeen',
        origin: 'compiler',
        rel: 'writes',
        to: 'field:Story.Seen',
        via: 'set writes the field',
      },
      ...(build.edges ?? []),
    ],
    nodes,
    projectRoot: '/project',
  }
}

const FILES = [{ content: SOURCE, path: PATH }]

Describe('Studio agent chat facts', () => {
  Test('names a view no scenario covers, so a suggestion can rest on it', () => {
    // A scenario has to cover something before "covered" means anything; a graph with no covers edge at all
    // cannot tell an uncovered view from a relation it does not model.
    const withScenario = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'scenario:Other/one',
        origin: 'compiler',
        rel: 'covers',
        to: 'view:Other',
        via: 'scenario subject',
      }],
      nodes: [
        { id: 'scenario:Other/one', kind: 'scenario', name: 'Other/one', path: PATH },
        { id: 'view:Other', kind: 'view', name: 'Other', path: PATH, ...span('view StoryRow(Story) {') },
      ],
    })

    const uncovered = improvementFacts(withScenario).filter(fact => fact.kind === 'view-without-scenario')
    Expect(uncovered.map(fact => fact.subject)).toEqual(['StoryRow'])
    // The evidence names the relation that was counted, not just a place in the file.
    Expect(uncovered[0]?.evidence.includes('no covers edge reaches it')).toBe(true)
  })

  Test('says nothing about coverage while a scenario names the app itself', () => {
    // An app-level scenario exercises whatever the app renders, and an app node has no renders edge, so the
    // walk stops there. Counting only what it reached called 25 of WordFlower's 26 views uncovered.
    const appLevel = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'scenario:devices/phone',
        origin: 'compiler',
        rel: 'covers',
        to: 'app:Reader',
        via: 'scenario group subject',
      }],
      nodes: [{ id: 'scenario:devices/phone', kind: 'scenario', name: 'devices/phone', path: PATH }],
    })

    const facts = improvementFacts(appLevel)
    Expect(facts.filter(fact => fact.kind === 'view-without-scenario')).toEqual([])
    Expect(facts.some(fact => fact.kind === 'relation-not-modelled' && fact.subject === 'covers')).toBe(true)
  })

  Test('a view a scenario covers is not reported', () => {
    const covered = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'scenario:StoryRow/leading',
        origin: 'compiler',
        rel: 'covers',
        to: 'view:StoryRow',
        via: 'scenario subject',
      }],
      nodes: [{ id: 'scenario:StoryRow/leading', kind: 'scenario', name: 'StoryRow/leading', path: PATH }],
    })

    Expect(improvementFacts(covered).filter(fact => fact.kind === 'view-without-scenario')).toEqual([])
  })

  Test('separates a field that is written but never read from one nothing touches at all', () => {
    const facts = improvementFacts(snapshot())

    // Seen is written by MarkSeen and read by nothing: the flag exists but no screen shows it.
    Expect(facts.filter(fact => fact.kind === 'field-written-never-read').map(fact => fact.subject))
      .toEqual(['Story.Seen'])
    // Title is read, so it is not reported at all.
    Expect(facts.filter(fact => fact.subject === 'Story.Title')).toEqual([])
  })

  Test('names an action nothing invokes, once the graph has that relation at all', () => {
    const withInvokes = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'view:StoryRow',
        origin: 'compiler',
        rel: 'invokes',
        to: 'action:Other',
        via: 'render invokes the action',
      }],
      nodes: [{ id: 'action:Other', kind: 'action', name: 'Other', path: PATH }],
    })

    Expect(improvementFacts(withInvokes).filter(fact => fact.kind === 'action-never-invoked').map(f => f.subject))
      .toEqual(['MarkSeen'])
  })

  Test('an action the source invokes with `do` is not called dead', () => {
    // The invokes edge is only built for handlers the graph walks, and it misses some; the source settles it.
    const withInvokes = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'view:StoryRow',
        origin: 'compiler',
        rel: 'invokes',
        to: 'action:Other',
        via: 'render invokes the action',
      }],
      nodes: [{ id: 'action:Other', kind: 'action', name: 'Other', path: PATH }],
    })

    const facts = improvementFacts(withInvokes, undefined, [
      { content: `${SOURCE}\n      on press -> { do MarkSeen() }\n`, path: PATH },
    ])

    Expect(facts.filter(fact => fact.kind === 'action-never-invoked')).toEqual([])
  })

  Test('an invoked action is not reported', () => {
    const wired = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'view:StoryRow',
        origin: 'compiler',
        rel: 'invokes',
        to: 'action:MarkSeen',
        via: 'render invokes the action',
      }],
    })

    Expect(improvementFacts(wired).filter(fact => fact.kind === 'action-never-invoked')).toEqual([])
  })

  Test('a field used only to order a collection is not called unread', () => {
    // `order by Ordering` reads the field, and produces no reads edge. Calling that dead is a false claim
    // about an ordinary way to use a field.
    const facts = improvementFacts(snapshot(), undefined, [
      { content: `${SOURCE}\n   order by Seen\n`, path: PATH },
    ])

    Expect(facts.filter(fact => fact.kind === 'field-written-never-read')).toEqual([])
  })

  Test('prefers Studio\u2019s real compile state over the snapshot\u2019s parse diagnostics', () => {
    // The snapshot is parsed with validation off, so it sees linker errors only. A validator error would be
    // reported as a clean build if the facts trusted it.
    const facts = improvementFacts(snapshot(), {
      diagnostics: [{ filePath: PATH, message: 'Unknown view Ghost' }],
      status: 'error',
    })

    const problems = facts.filter(fact => fact.kind === 'compile-problem')
    Expect(problems.length).toBe(1)
    Expect(problems[0]?.detail).toBe('The project does not compile cleanly: Unknown view Ghost')
    Expect(problems[0]?.evidence).toBe(`Studio compile status error at ${PATH}`)
    // A clean compile contributes no problem facts, whatever the parse said.
    Expect(
      improvementFacts(snapshot(), { diagnostics: [], status: 'compiled' }).filter(fact =>
        fact.kind === 'compile-problem'
      ),
    ).toEqual([])
  })

  Test('reports a parse error as a fact, and ignores a warning', () => {
    const broken = snapshot()
    const withDiagnostics: SemanticSnapshot = {
      ...broken,
      diagnostics: [
        { filePath: PATH, message: 'Unknown declaration Foo', severity: 'error', source: 'validator' },
        { filePath: PATH, message: 'Consider naming this', severity: 'warning', source: 'validator' },
      ],
    }

    const problems = improvementFacts(withDiagnostics).filter(fact => fact.kind === 'parse-problem')
    Expect(problems.length).toBe(1)
    Expect(problems[0]?.detail).toBe('The project does not parse cleanly: Unknown declaration Foo')
  })

  Test('says nothing about which bundles are unused, because this graph cannot tell', () => {
    // `styled-by` is only emitted for a layout entry that names a bundle. A design's component-default and
    // scheme rules are never named that way, so an unlinked bundle may be either unused or invisible here.
    // Reporting the second as the first called 63 of WordFlower's 92 bundles dead.
    const styled = snapshot({
      edges: [{
        evidence: `${PATH}:0`,
        from: 'render:StoryRow:1',
        origin: 'compiler',
        rel: 'styled-by',
        to: 'bundle:D.used',
        via: 'layout entry names a bundle',
      }],
      nodes: [
        { detail: { design: 'D' }, id: 'bundle:D.used', kind: 'bundle', name: 'used', path: PATH },
        { detail: { design: 'D' }, id: 'bundle:D.lonely', kind: 'bundle', name: 'lonely', path: PATH },
      ],
    })

    const facts = improvementFacts(styled)
    Expect(facts.filter(fact => fact.kind === 'bundle-unused')).toEqual([])
    Expect(facts.some(fact => fact.kind === 'relation-not-modelled' && fact.subject === 'styled-by')).toBe(true)
  })

  Test('a relation with no edges at all produces a statement, not accusations', () => {
    // HNReader has no `invokes` edge in its whole graph. Reading that as "nothing invokes this action" made
    // four of its ten facts false, in the one tool an advisory answer is told to rest on.
    const facts = improvementFacts(snapshot())

    const unmodelled = facts.filter(fact => fact.kind === 'relation-not-modelled').map(fact => fact.subject)
    Expect(unmodelled.includes('invokes')).toBe(true)
    Expect(facts.filter(fact => fact.kind === 'action-never-invoked')).toEqual([])
  })

  Test('outlines a file as its declarations in source order, with line numbers', () => {
    const outlines = fileOutlines(snapshot(), FILES)

    Expect(outlines.length).toBe(1)
    Expect(outlines[0]?.path).toBe(PATH)
    Expect(outlines[0]?.declarations.map(entry => entry.name)).toEqual(['Reader', 'Stories', 'StoryRow', 'MarkSeen'])
    Expect(outlines[0]?.declarations[0]).toEqual({ kind: 'app', line: 1, name: 'Reader' })
    Expect(outlines[0]?.declarations[2]?.line).toBe(10)
  })

  Test('returns one declaration by name, so the model never asks for a path', () => {
    const view = snapshot().nodes.get('view:StoryRow')!

    const source = declarationSource(FILES, view)

    Expect(source?.path).toBe(PATH)
    Expect(source?.line).toBe(10)
    Expect(source?.source).toBe('view StoryRow(Story) {')
  })

  Test('says nothing rather than guessing when a node has no source range', () => {
    const detached: SnapshotNode = { id: 'view:Ghost', kind: 'view', name: 'Ghost' }

    Expect(declarationSource(FILES, detached)).toBe(undefined)
  })
})
