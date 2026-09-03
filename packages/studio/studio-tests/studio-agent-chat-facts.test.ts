// Studio agent chat: the facts an advisory answer stands on.
//
// The snapshot is built by hand so each fact is provoked by an exact graph shape: a view no scenario covers,
// an action nothing invokes, a field written but never read. What is under test is what Tao is willing to
// claim, not what a model says about it.
import { Describe, Expect, Test } from '@shared/test'
import { declarationSource, fileOutlines, improvementFacts } from '../studio-src/agent-chat/AgentChatFacts'
import type { SemanticSnapshot, SnapshotEdge, SnapshotNode } from '../studio-src/agent-poc/SemanticSnapshot'

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
    const facts = improvementFacts(snapshot())

    const uncovered = facts.filter(fact => fact.kind === 'view-without-scenario')
    Expect(uncovered.length).toBe(1)
    Expect(uncovered[0]?.subject).toBe('StoryRow')
    // The evidence is a source location, so a person can open it and disagree.
    Expect(uncovered[0]?.evidence.startsWith(`${PATH}:`)).toBe(true)
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

  Test('names an action nothing invokes', () => {
    const facts = improvementFacts(snapshot())

    Expect(facts.filter(fact => fact.kind === 'action-never-invoked').map(fact => fact.subject)).toEqual(['MarkSeen'])
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

  Test('reports a compile error as a fact, and ignores a warning', () => {
    const broken = snapshot()
    const withDiagnostics: SemanticSnapshot = {
      ...broken,
      diagnostics: [
        { filePath: PATH, message: 'Unknown declaration Foo', severity: 'error', source: 'validator' },
        { filePath: PATH, message: 'Consider naming this', severity: 'warning', source: 'validator' },
      ],
    }

    const problems = improvementFacts(withDiagnostics).filter(fact => fact.kind === 'compile-problem')
    Expect(problems.length).toBe(1)
    Expect(problems[0]?.detail).toBe('The project does not compile cleanly: Unknown declaration Foo')
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
