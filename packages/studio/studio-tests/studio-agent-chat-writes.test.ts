// Studio agent chat: the change surface, and the reference a model consults before writing Tao.
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { findSpec, type SpecSection } from '../studio-src/agent-chat/AgentChatReference'
import type { AgentChatWriteWorld, StagedChange } from '../studio-src/agent-chat/AgentChatWrites'
import { APPROVAL_REQUIRED, writeTools } from '../studio-src/agent-chat/AgentChatWrites'
import type { SemanticSnapshot, SnapshotNode } from '../studio-src/agent-chat/SemanticSnapshot'

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

  Test('proposing computes the change and shows a diff, and writes nothing', async () => {
    const changes = new Map<string, StagedChange>()
    const it = world()

    const result = await call(writeTools(it, changes, () => {}), 'proposeEdit', {
      declaration: 'Greeting',
      replacement: 'view Greeting() {\n   render Text("Hi")\n}',
    })

    Expect(result['changeId']).toBe('change-1')
    Expect(String(result['diff']).includes('Hi')).toBe(true)
    Expect(changes.size).toBe(1)
    // Nothing reached the project: proposing is not applying.
    Expect(it.applied).toEqual([])
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
