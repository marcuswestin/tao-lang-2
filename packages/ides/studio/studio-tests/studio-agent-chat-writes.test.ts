// Studio agent chat: the change surface, and the reference a model consults before writing Tao.
import type { SemanticSnapshot, SnapshotNode } from '@compiler/workspace'
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { chatInstructions, scenarioInstructions } from '../studio-src/agent-chat/AgentChatInstructions'
import { findSpec, type SpecSection } from '../studio-src/agent-chat/AgentChatReference'
import type { AgentChatWriteWorld, StagedChange } from '../studio-src/agent-chat/AgentChatWrites'
import { APPROVAL_REQUIRED, stageChange, writeTools } from '../studio-src/agent-chat/AgentChatWrites'

const PATH = 'App.tao'

const SOURCE = `app Reader {
   Name "Reader"
}

view Greeting() {
   render Text("Hello")
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
  add({ id: 'app:Reader', kind: 'app', name: 'Reader', path: PATH, ...span('app Reader {') })
  add({
    id: 'view:Greeting',
    kind: 'view',
    name: 'Greeting',
    path: PATH,
    ...span('view Greeting() {\n   render Text("Hello")\n}'),
  })
  add({
    detail: { owner: 'Greeting', texts: [{ ...span('"Hello"'), text: '"Hello"' }] },
    id: 'render:Greeting:1',
    kind: 'render',
    name: 'Text',
    path: PATH,
    ...span('render Text("Hello")'),
  })
  return { appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }
}

type Applied = { change: StagedChange }

function world(overrides: Partial<AgentChatWriteWorld> = {}): AgentChatWriteWorld & { applied: Applied[] } {
  const applied: Applied[] = []
  return {
    applied,
    apply: async change => {
      applied.push({ change })
      return { message: 'compiled', rolledBack: false, status: 'compiled' }
    },
    files: async () => [{ content: SOURCE, path: PATH }],
    snapshot: async () => snapshot(),
    sourceVersionOf: async () => 'v1',
    undo: async () => ({ message: 'compiled', restored: [PATH], status: 'compiled' }),
    ...overrides,
  }
}

/** call runs one tool the way the loop would, with no model involved. */
async function call(
  tools: ReturnType<typeof writeTools>,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const execute = tools[name]?.execute
  Expect(execute).not.toBe(undefined)
  return await (execute as (input: unknown, options: unknown) => Promise<Record<string, unknown>>)(input, {})
}

Describe('Studio agent chat writes', () => {
  Test('only the two tools that touch the project need approval', () => {
    Expect([...APPROVAL_REQUIRED]).toEqual(['applyChange', 'undoLastChange'])
  })

  Test('instructions direct proposing and applying in the same turn without asking in chat first', () => {
    Expect(chatInstructions.includes('Do not ask in chat')).toBe(true)
    Expect(chatInstructions.includes('call applyChange immediately')).toBe(true)
    Expect(scenarioInstructions.includes('do not ask in chat first')).toBe(true)
  })

  Test('proposing computes the change and shows a diff, and writes nothing', async () => {
    const changes = new Map<string, StagedChange>()
    const it = world()

    const result = await call(writeTools(it, changes, () => {}), 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hi")\n}',
    })

    Expect(result['changeId']).toBe('change-1')
    Expect(String(result['diff']).includes('Hi')).toBe(true)
    Expect(String(result['next']).includes('Do not ask in chat first')).toBe(true)
    Expect(changes.size).toBe(1)
    // Nothing reached the project: proposing is not applying.
    Expect(it.applied).toEqual([])
  })

  Test('all staging surfaces share one change-id allocator', async () => {
    const changes = new Map<string, StagedChange>()
    let issued = 0
    const issue = () => `change-${++issued}`
    const firstSurface = stageChange(world(), changes, issue)
    const secondSurface = stageChange(world(), changes, issue)

    const first = await firstSurface('first', [{ after: 'two', before: 'one', path: PATH }])
    const second = await secondSurface('second', [{ after: 'three', before: 'two', path: PATH }])

    Expect(first['changeId']).toBe('change-1')
    Expect(second['changeId']).toBe('change-2')
    Expect([...changes.keys()]).toEqual(['change-1', 'change-2'])
  })

  Test('applying writes the staged change and records what it was computed against', async () => {
    const changes = new Map<string, StagedChange>()
    const it = world()
    const tools = writeTools(it, changes, () => {})
    await call(tools, 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hi")\n}',
    })

    const result = await call(tools, 'applyChange', { changeId: 'change-1' })

    Expect(result['applied']).toBe(true)
    Expect(it.applied.length).toBe(1)
    Expect(it.applied[0]?.change.expect).toEqual([{ path: PATH, sourceVersion: 'v1' }])
    // A change that has been applied is no longer staged, so it cannot be applied twice.
    Expect(changes.size).toBe(0)
  })

  Test('proposing multiple declarations at once stages a single change with multiple diff definitions', async () => {
    const source = `app Reader {
   Name "Reader"
}

view FrontPage() {
   render Text("Front")
}

view StoryScreen() {
   render Text("Story")
}
`
    const nodes = new Map<string, SnapshotNode>()
    const spanOf = (needle: string) => {
      const start = source.indexOf(needle)
      return { end: start + needle.length, start }
    }
    nodes.set('app:Reader', { id: 'app:Reader', kind: 'app', name: 'Reader', path: PATH, ...spanOf('app Reader {') })
    nodes.set('view:FrontPage', {
      id: 'view:FrontPage',
      kind: 'view',
      name: 'FrontPage',
      path: PATH,
      ...spanOf('view FrontPage() {\n   render Text("Front")\n}'),
    })
    nodes.set('view:StoryScreen', {
      id: 'view:StoryScreen',
      kind: 'view',
      name: 'StoryScreen',
      path: PATH,
      ...spanOf('view StoryScreen() {\n   render Text("Story")\n}'),
    })

    const changes = new Map<string, StagedChange>()
    const it = world({
      files: async () => [{ content: source, path: PATH }],
      snapshot: async () => ({ appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }),
    })
    const tools = writeTools(it, changes, () => {})

    const result = await call(tools, 'proposeEdit', {
      edits: [
        { declaration: 'FrontPage', replacement: 'view FrontPage() {\n   render Text("FrontUpdated")\n}' },
        { declaration: 'StoryScreen', replacement: 'view StoryScreen() {\n   render Text("StoryUpdated")\n}' },
      ],
    })

    Expect(result['changeId']).toBe('change-1')
    Expect(changes.size).toBe(1)
    const staged = changes.get('change-1')
    Expect(staged?.edits.length).toBe(2)
    Expect(staged?.edits[0]?.diff.includes('FrontUpdated')).toBe(true)
    Expect(staged?.edits[1]?.diff.includes('StoryUpdated')).toBe(true)

    // Now apply it: both views are updated in a single apply
    const applied = await call(tools, 'applyChange', { changeId: 'change-1' })
    Expect(applied['applied']).toBe(true)
    Expect(it.applied.length).toBe(1)
    Expect(it.applied[0]?.change.edits[0]?.after.includes('FrontUpdated')).toBe(true)
    Expect(it.applied[0]?.change.edits[0]?.after.includes('StoryUpdated')).toBe(true)
  })

  Test('overlapping declaration edits in the same file are refused', async () => {
    const source = `view Outer() {
   view Inner() {
      render Text("Inside")
   }
}`
    const nodes = new Map<string, SnapshotNode>()
    nodes.set('view:Outer', {
      id: 'view:Outer',
      kind: 'view',
      name: 'Outer',
      path: PATH,
      end: source.length,
      start: 0,
    })
    nodes.set('view:Inner', {
      id: 'view:Inner',
      kind: 'view',
      name: 'Inner',
      path: PATH,
      end: source.indexOf('}') + 1,
      start: source.indexOf('view Inner'),
    })

    const changes = new Map<string, StagedChange>()
    const it = world({
      files: async () => [{ content: source, path: PATH }],
      snapshot: async () => ({ appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }),
    })
    const tools = writeTools(it, changes, () => {})

    const result = await call(tools, 'proposeEdit', {
      edits: [
        { declaration: 'Outer', replacement: 'view Outer() { render Text("1") }' },
        { declaration: 'Inner', replacement: 'view Inner() { render Text("2") }' },
      ],
    })

    Expect(String(result['refused']).includes('Cannot replace overlapping declarations')).toBe(true)
    Expect(changes.size).toBe(0)
  })

  Test('proposeEdit accepts an entity replacement under the semantic entity kind', async () => {
    const source = 'data Stories / Story {\n   Title text\n}\n'
    const nodes = new Map<string, SnapshotNode>()
    nodes.set('entity:Stories', {
      end: source.trimEnd().length,
      id: 'entity:Stories',
      kind: 'entity',
      name: 'Stories',
      path: PATH,
      start: 0,
    })
    const changes = new Map<string, StagedChange>()
    const it = world({
      files: async () => [{ content: source, path: PATH }],
      snapshot: async () => ({ appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }),
    })

    const result = await call(writeTools(it, changes, () => {}), 'proposeEdit', {
      declaration: 'Stories',
      replacement: 'data Stories / Story {\n   Title text\n   Summary text\n}',
    })

    Expect(result['refused']).toBeUndefined()
    Expect(result['changeId']).toBe('change-1')
    Expect(changes.get('change-1')?.edits[0]?.after.includes('Summary text')).toBe(true)
  })

  Test('proposing declarations across multiple files stages a single change with diffs for each file', async () => {
    const pathA = 'ViewA.tao'
    const pathB = 'ViewB.tao'
    const sourceA = 'view ViewA() {\n   render Text("A")\n}'
    const sourceB = 'view ViewB() {\n   render Text("B")\n}'

    const nodes = new Map<string, SnapshotNode>()
    nodes.set('view:ViewA', {
      id: 'view:ViewA',
      kind: 'view',
      name: 'ViewA',
      path: pathA,
      end: sourceA.length,
      start: 0,
    })
    nodes.set('view:ViewB', {
      id: 'view:ViewB',
      kind: 'view',
      name: 'ViewB',
      path: pathB,
      end: sourceB.length,
      start: 0,
    })

    const changes = new Map<string, StagedChange>()
    const it = world({
      files: async () => [
        { content: sourceA, path: pathA },
        { content: sourceB, path: pathB },
      ],
      snapshot: async () => ({ appName: 'Reader', diagnostics: [], edges: [], nodes, projectRoot: '/project' }),
    })
    const tools = writeTools(it, changes, () => {})

    const result = await call(tools, 'proposeEdit', {
      edits: [
        { declaration: 'ViewA', replacement: 'view ViewA() {\n   render Text("AUpdated")\n}' },
        { declaration: 'ViewB', replacement: 'view ViewB() {\n   render Text("BUpdated")\n}' },
      ],
    })

    Expect(result['changeId']).toBe('change-1')
    Expect(changes.size).toBe(1)
    const staged = changes.get('change-1')
    Expect(staged?.edits.length).toBe(2)
    Expect(staged?.edits.some(e => e.path === pathA && e.diff.includes('AUpdated'))).toBe(true)
    Expect(staged?.edits.some(e => e.path === pathB && e.diff.includes('BUpdated'))).toBe(true)

    const applied = await call(tools, 'applyChange', { changeId: 'change-1' })
    Expect(applied['applied']).toBe(true)
  })

  Test('a change that changes nothing is refused rather than staged', async () => {
    const changes = new Map<string, StagedChange>()

    const result = await call(writeTools(world(), changes, () => {}), 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hello")\n}',
    })

    Expect(result['refused']).toBe('That produces no change: the source already reads that way.')
    Expect(changes.size).toBe(0)
  })

  Test('source the formatter cannot parse never reaches the project', async () => {
    const changes = new Map<string, StagedChange>()

    const result = await call(writeTools(world(), changes, () => {}), 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting( {{{ render',
    })

    Expect(String(result['refused']).startsWith('That is not valid Tao:')).toBe(true)
    Expect(changes.size).toBe(0)
  })

  Test('a file that moved under a staged change is reported, not overwritten', async () => {
    const changes = new Map<string, StagedChange>()
    const tools = writeTools(
      world({
        apply: async () => Errors.throwUserInput('App.tao changed since this was planned.'),
      }),
      changes,
      () => {},
    )
    await call(tools, 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hi")\n}',
    })

    const result = await call(tools, 'applyChange', { changeId: 'change-1' })

    Expect(String(result['refused'])).toBe(
      'App.tao changed since this was planned. Re-read the declaration and propose the change again.',
    )
  })

  Test('applying a change that was never staged is refused', async () => {
    const result = await call(writeTools(world(), new Map(), () => {}), 'applyChange', { changeId: 'change-9' })

    Expect(result['refused']).toBe('No change is staged under "change-9".')
  })

  Test('a rolled back compile is reported as not applied, with the reason', async () => {
    const changes = new Map<string, StagedChange>()
    const tools = writeTools(
      world({ apply: async () => ({ message: 'Unknown view Ghost', rolledBack: true, status: 'error' }) }),
      changes,
      () => {},
    )
    await call(tools, 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hi")\n}',
    })

    const result = await call(tools, 'applyChange', { changeId: 'change-1' })

    Expect(result['applied']).toBe(false)
    Expect(result['message']).toBe('Unknown view Ghost')
  })
})

const SPEC: SpecSection[] = [
  {
    carriesDeferral: false,
    file: 'Tao Studio',
    heading: 'Scenario groups',
    text: 'A file-level `scenarios` declaration gives a string-named group of entries.',
  },
  {
    carriesDeferral: true,
    file: 'Tao Testing',
    heading: 'Deterministic state',
    text: 'Driving a provider into those states from a test step is retired; the replacement has not landed.',
  },
  { carriesDeferral: false, file: 'Tao Data', heading: 'Queries', text: 'A query reads rows from a collection.' },
]

Describe('Studio agent chat text handles', () => {
  Test('a handle that was never issued is refused rather than guessed at', async () => {
    const result = await call(writeTools(world(), new Map(), () => {}), 'proposeReword', {
      newText: 'Hi',
      textHandle: 'T1',
    })

    Expect(String(result['refused']).includes('was not issued in this conversation')).toBe(true)
  })

  Test('a handle stops naming its line once the source moves under it', async () => {
    // Handles are positional, so an applied change repoints every one of them. A model still holding an old
    // handle would otherwise reword a line it never looked at, and the guardrail would validate the wrong one.
    const issued = new Map<string, string>()
    const tools = writeTools(world(), new Map(), () => {}, issued)
    await call(tools, 'listTexts', {})
    Expect(issued.get('T1')).toBe('"Hello"')

    // The literal the handle was issued for is no longer what T1 names.
    issued.set('T1', '"Something else"')
    const result = await call(tools, 'proposeReword', { newText: 'Hi', textHandle: 'T1' })

    Expect(String(result['refused']).includes('no longer names')).toBe(true)
    Expect(String(result['refused']).includes('Call listTexts again')).toBe(true)
  })

  Test('listing texts issues a handle for each one', async () => {
    const issued = new Map<string, string>()

    const result = await call(writeTools(world(), new Map(), () => {}, issued), 'listTexts', {})

    Expect((result['texts'] as unknown[]).length).toBe(1)
    Expect([...issued.entries()]).toEqual([['T1', '"Hello"']])
  })
})

Describe('Studio agent chat Tao reference', () => {
  Test('finds the section whose heading is about the topic', () => {
    const found = findSpec(SPEC, 'scenario')

    Expect(found.sections[0]?.heading).toBe('Scenario groups')
    Expect(found.sections[0]?.file).toBe('Tao Studio')
  })

  Test('warns when a section says part of what it describes is not implemented', () => {
    const found = findSpec(SPEC, 'deterministic')

    Expect(found.sections[0]?.carriesDeferral).toBe(true)
    Expect(found.note).toBe(
      'A section below says part of what it describes is not implemented yet. Do not rely on anything it marks as deferred.',
    )
  })

  Test('tells the model not to guess when the spec has nothing', () => {
    const found = findSpec(SPEC, 'websockets')

    Expect(found.sections).toEqual([])
    Expect(String(found.note).includes('Do not guess the syntax')).toBe(true)
  })

  Test('keeps a long section inside its budget without cutting a line in half', () => {
    const long: SpecSection = {
      carriesDeferral: false,
      file: 'Tao Data',
      heading: 'Queries',
      text: ['aaaa query', 'bbbb query', 'cccc query'].join('\n'),
    }

    const found = findSpec([long], 'query', { budget: 12 })

    Expect(found.sections[0]?.text).toBe('aaaa query\n…(section continues)')
  })
})
