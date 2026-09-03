// Studio agent chat: authoring a state to develop against, the gate in front of app code, and the account of
// what Tao already guarantees.
import { Describe, Expect, Test } from '@shared/test'
import { authoringTools, type CodeChangeRequest } from '../studio-src/agent-chat/AgentChatAuthoring'
import { parseChecks, viewCoverage } from '../studio-src/agent-chat/AgentChatCoverage'
import { taoGuarantees } from '../studio-src/agent-chat/AgentChatGuarantees'
import type { AgentChatWriteWorld } from '../studio-src/agent-chat/AgentChatWrites'
import type { SemanticSnapshot, SnapshotNode } from '../studio-src/agent-poc/SemanticSnapshot'

const PATH = 'App.tao'
const TEST_PATH = 'App.test.tao'

const SOURCE = `app Reader {
   Name "Reader"
}

data Stories / Story {
   Title text
}

view StoryRow(Story) {
   render Text(Story.Title)
}

view Empty() {
   render Text("Nothing yet")
}
`

const TESTS = `use Reader from ./

test "reader" {
   test "shows a story" {
      run Reader
      expect text "Nothing yet"
   }
}
`

function span(needle: string): { start: number; end: number } {
  const start = SOURCE.indexOf(needle)
  Expect(start).not.toBe(-1)
  return { end: start + needle.length, start }
}

function snapshot(): SemanticSnapshot {
  const nodes = new Map<string, SnapshotNode>()
  const add = (node: SnapshotNode) => nodes.set(node.id, node)
  add({ id: 'entity:Stories', kind: 'entity', name: 'Stories', path: PATH, detail: { singular: 'Story' } })
  add({
    detail: { parameters: ['Story (entity Stories)'] },
    id: 'view:StoryRow',
    kind: 'view',
    name: 'StoryRow',
    path: PATH,
    ...span('view StoryRow(Story) {'),
  })
  add({
    detail: { parameters: [] },
    id: 'view:Empty',
    kind: 'view',
    name: 'Empty',
    path: PATH,
    ...span('view Empty() {'),
  })
  add({
    detail: { owner: 'Empty', texts: [{ end: 0, start: 0, text: '"Nothing yet"' }] },
    id: 'render:Empty:1',
    kind: 'render',
    name: 'Text',
    path: PATH,
  })
  add({
    detail: { owner: 'StoryRow', texts: [{ end: 0, start: 0, text: '"{ Story.Title } today"' }] },
    id: 'render:StoryRow:1',
    kind: 'render',
    name: 'Text',
    path: PATH,
  })
  return { appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }
}

function world(): AgentChatWriteWorld {
  return {
    apply: async () => ({ message: 'compiled', rolledBack: false, status: 'compiled' }),
    files: async () => [{ content: SOURCE, path: PATH }],
    snapshot: async () => snapshot(),
    sourceVersionOf: async () => 'v1',
    testSources: async () => [{ content: TESTS, path: TEST_PATH }],
    undo: async () => ({ message: 'compiled', restored: [], status: 'compiled' }),
  }
}

type Staged = { summary: string; edits: readonly { path: string; before: string; after: string }[] }

function tools(staged: Staged[], requests: CodeChangeRequest[] = []) {
  return authoringTools(
    world(),
    async (summary, edits) => {
      staged.push({ edits, summary })
      return { changeId: `change-${staged.length}`, summary }
    },
    requests,
    () => {},
  )
}

async function call(set: ReturnType<typeof tools>, name: string, input: unknown): Promise<Record<string, unknown>> {
  const execute = set[name]?.execute
  Expect(execute).not.toBe(undefined)
  return await (execute as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)(input, {})
}

Describe('Studio agent chat authoring', () => {
  Test('this mode has no tool that changes app code', () => {
    const names = Object.keys(tools([]))

    Expect(names.includes('proposeEdit')).toBe(false)
    Expect(names.includes('proposeFlag')).toBe(false)
    Expect(names.sort()).toEqual(['listTestFiles', 'proposeScenario', 'proposeTest', 'requestCodeChanges'])
  })

  Test('describing a state stages a fixture and a scenario for the view', async () => {
    const staged: Staged[] = []

    const result = await call(tools(staged), 'proposeScenario', {
      fixtureName: 'LongStories',
      groupName: 'states',
      rows: ['Title: "A very long title"'],
      scenarioName: 'longTitle',
      view: 'StoryRow',
    })

    Expect(result['changeId']).toBe('change-1')
    const after = staged[0]!.edits[0]!.after
    Expect(after.includes('fixture LongStories')).toBe(true)
    // The formatter reflows the row onto its own lines, so the check is on what it says, not its shape.
    Expect(after.includes('longTitleRow = create Story {')).toBe(true)
    Expect(after.includes('Title: "A very long title"')).toBe(true)
    Expect(after.includes('scenarios StoryRow "states"')).toBe(true)
    Expect(after.includes('render (Story: longTitleRow)')).toBe(true)
  })

  Test('a view that takes no entity cannot be given rows, and is told why', async () => {
    const result = await call(tools([]), 'proposeScenario', {
      fixtureName: 'Whatever',
      groupName: 'states',
      rows: ['Title: "x"'],
      scenarioName: 'empty',
      view: 'Empty',
    })

    Expect(String(result['refused']).includes('takes no entity parameter')).toBe(true)
  })

  Test('a check is added to the suite the app already has', async () => {
    const staged: Staged[] = []

    await call(tools(staged), 'proposeTest', {
      name: 'says so when there is nothing to show',
      steps: ['run Reader', 'expect text "Nothing yet"'],
      suite: 'reader',
    })

    Expect(staged[0]!.edits[0]!.path).toBe(TEST_PATH)
    const after = staged[0]!.edits[0]!.after
    Expect(after.includes('test "says so when there is nothing to show"')).toBe(true)
    // The existing check is still there: a new one is added to the suite, not written over it.
    Expect(after.includes('test "shows a story"')).toBe(true)
  })

  Test('steps that are not valid Tao are refused before anything is staged', async () => {
    const staged: Staged[] = []

    const result = await call(tools(staged), 'proposeTest', {
      name: 'nonsense',
      steps: ['this is not a step {{{'],
      suite: 'reader',
    })

    Expect(String(result['refused']).startsWith('Those steps are not valid Tao:')).toBe(true)
    Expect(staged).toEqual([])
  })

  Test('needing the app to change is recorded as a question, not worked around', async () => {
    const requests: CodeChangeRequest[] = []

    const result = await call(tools([], requests), 'requestCodeChanges', {
      missing: 'Story has no Hidden field',
      reason: 'the empty-feed state cannot be reached without one',
    })

    Expect(result['asked']).toBe(true)
    Expect(requests).toEqual([{
      missing: 'Story has no Hidden field',
      reason: 'the empty-feed state cannot be reached without one',
    }])
  })
})

Describe('Studio agent chat coverage', () => {
  Test('reads the checks and their literals out of a test file', () => {
    const checks = parseChecks(TESTS)

    Expect(checks.length).toBe(1)
    Expect(checks[0]?.suite).toBe('reader')
    Expect(checks[0]?.name).toBe('shows a story')
    // `run Reader` names the app without quoting it, so only the asserted text is a literal.
    Expect(checks[0]?.literals).toEqual(['Nothing yet'])
  })

  Test('says which of a view’s texts a check exercises, and how it decided', () => {
    const covered = viewCoverage(snapshot(), snapshot().nodes.get('view:Empty')!, parseChecks(TESTS))

    Expect(covered.shows).toEqual([{ by: 'exact', checks: ['shows a story'], text: 'Nothing yet' }])
    Expect(covered.note.includes('Matched by text, not by the compiler')).toBe(true)
  })

  Test('an interpolated text is matched on its fixed parts, or not at all', () => {
    const withFragment = viewCoverage(snapshot(), snapshot().nodes.get('view:StoryRow')!, [
      { literals: ['Dune today'], name: 'reads a story', suite: 'reader' },
    ])
    Expect(withFragment.shows[0]?.by).toBe('fragment')

    const without = viewCoverage(snapshot(), snapshot().nodes.get('view:StoryRow')!, parseChecks(TESTS))
    Expect(without.shows[0]?.by).toBe('none')
    Expect(without.note.includes('1 of 1 texts this view shows appear in no check')).toBe(true)
  })
})

Describe('Studio agent chat Tao guarantees', () => {
  Test('says what not to test, and marks what cannot be tested yet', () => {
    const all = taoGuarantees()

    Expect(all.guarantees.some(entry => entry.verdict === 'guaranteed')).toBe(true)
    Expect(all.guarantees.every(entry => entry.source !== '')).toBe(true)
    // The guard branches cannot be driven from a test today, and must never be reported as covered.
    const guards = all.guarantees.find(entry => entry.area === 'entity guards')
    Expect(guards?.verdict).toBe('not-testable-yet')
    Expect(all.note.includes('must not be reported as covered')).toBe(true)
  })

  Test('does not claim Tao removes the absent value, or query loading states', () => {
    // Both were wrong in the first draft of this sheet, and both would have taught the agent to skip a real test.
    Expect(taoGuarantees('optional').guarantees[0]?.verdict).toBe('worth-testing')
    Expect(taoGuarantees('emptiness').guarantees[0]?.verdict).toBe('worth-testing')
  })

  Test('an unknown area is unknown, not safe', () => {
    const found = taoGuarantees('websockets')

    Expect(found.guarantees).toEqual([])
    Expect(found.note.includes('That is not a guarantee')).toBe(true)
  })
})
