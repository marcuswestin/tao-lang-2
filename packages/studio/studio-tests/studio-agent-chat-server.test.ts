// Studio agent chat: the server path, driven end to end with a scripted model.
//
// The loop and the tools have their own tests. This one exercises what a person actually reaches: the command
// handler, the mode gate, the two cloud gates, and the approval round trip that runs across two HTTP calls.
import { FS } from '@shared'
import { Deferred, Describe, Expect, Test, until } from '@shared/test'
import { Workspace } from '@workspace'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { AgentChatProvider } from '../studio-src/agent-chat/AgentChatProvider'
import { conversationForTesting } from '../studio-src/agent-chat/AgentChatServer'
import type { StudioProjectSession } from '../studio-src/StudioProjectSession'

const PATH = 'App.tao'
const SOURCE = `app Reader {
   Name "Reader"
}

view Greeting() {
   render Text("Hello")
}
`

type Turn = { text?: string; call?: { name: string; input: unknown } }

/** The provider-level stream parts this double emits, named locally so no extra dependency is declared. */
type StreamPart =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
  | { type: 'finish'; finishReason: { raw: undefined; unified: string }; usage: unknown }

/**
 * The loop streams, so the double has to stream too. Text arrives as several deltas rather than one blob,
 * which is what lets a test assert that a caller sees it progressively.
 */
function scripted(turns: readonly Turn[]): MockLanguageModelV3 {
  let step = 0
  return new MockLanguageModelV3({
    doStream: async () => {
      const turn = turns[Math.min(step, turns.length - 1)]!
      step += 1
      const finishReason = {
        raw: undefined,
        unified: turn.call === undefined ? ('stop' as const) : ('tool-calls' as const),
      }
      const usage = {
        inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 1, total: 1 },
        outputTokens: { reasoning: undefined, text: 1, total: 1 },
        totalTokens: 2,
      }
      const parts: StreamPart[] = turn.call === undefined
        ? [
          { id: '0', type: 'text-start' },
          // Word by word, so a test can tell a stream from a single delivery.
          ...(turn.text ?? '').split(/(?<= )/).map((delta): StreamPart => ({
            delta,
            id: '0',
            type: 'text-delta',
          })),
          { id: '0', type: 'text-end' },
          { finishReason, type: 'finish', usage },
        ]
        : [
          {
            input: JSON.stringify(turn.call.input),
            toolCallId: `call-${step}`,
            toolName: turn.call.name,
            type: 'tool-call',
          },
          { finishReason, type: 'finish', usage },
        ]
      return { stream: simulateReadableStream({ chunks: parts }) as never }
    },
  })
}

/**
 * The source really is parsed, so the snapshot the tools see is the one Tao would build. Without that a
 * proposal cannot resolve a declaration and the round trip proves nothing.
 */
const ROOT = FS.resolvePath(`agent-chat-${process.pid}`, process.env['TMPDIR'] ?? '/tmp')

let parsedOnce: Promise<{ files: unknown[]; diagnostics: unknown[] }> | undefined

function parsed(): Promise<{ files: unknown[]; diagnostics: unknown[] }> {
  // One workspace for the whole file: opening the same root twice in a process is a known hazard, and every
  // test here wants the same source anyway.
  parsedOnce ??= (async () => {
    await FS.mkdir(ROOT)
    await FS.writeText(FS.resolvePath(PATH, ROOT), SOURCE)
    const workspace = await Workspace.open(ROOT)
    return await workspace.validate(PATH) as unknown as { files: unknown[]; diagnostics: unknown[] }
  })()
  return parsedOnce
}

/** A project session reduced to what the chat's world actually reaches. */
function session(applied: { path: string; content: string }[]): StudioProjectSession {
  return {
    appName: 'Reader',
    applyAgentFiles: async (request: { edits: readonly { path: string; content: string }[] }) => {
      applied.push(...request.edits)
      return {
        compile: { message: 'compiled', status: 'compiled' },
        rolledBack: false,
        sourceVersions: request.edits.map(edit => ({ path: edit.path, sourceVersion: 'v1' })),
      }
    },
    agentParse: async () => await parsed(),
    compileSnapshot: () => ({ diagnostics: [], status: 'compiled' }),
    files: async () => [{ path: PATH }],
    // The snapshot keeps only files under the project root, so this has to be where the source really is.
    projectRoot: ROOT,
    readFile: async (path: string) => ({ content: SOURCE, path, sourceVersion: 'v1' }),
    agentUndoPreview: () => ({ diff: 'reverse diff', restored: [PATH] }),
    undoAgentFiles: async () => ({ compile: { message: 'compiled', status: 'compiled' }, restored: [PATH] }),
  } as unknown as StudioProjectSession
}

/** A test runner whose results are scripted, so a verdict can be driven without running a suite. */
function runner(results: { failed: number; failures: { message: string; name: string }[]; passed: number }[]) {
  let call = 0
  return {
    run: async () => {
      const result = results[Math.min(call, results.length - 1)]!
      call += 1
      return { ...result, status: 'passed' }
    },
  }
}

function chat(
  turns: readonly Turn[],
  applied: { path: string; content: string }[] = [],
  tests?: ReturnType<typeof runner>,
) {
  const it = conversationForTesting(session(applied), new AgentChatProvider({}, scripted(turns)))
  return {
    handle: async (command: string, body: Record<string, unknown>) => await it.handle(command, body, tests as never),
  }
}

Describe('Studio agent chat server', () => {
  Test('a mode change serializes behind an active turn and silences its stale stream', async () => {
    const started = Deferred()
    const release = Deferred()
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream<StreamPart>({
          async start(controller) {
            controller.enqueue({ id: '0', type: 'text-start' })
            controller.enqueue({ delta: 'early ', id: '0', type: 'text-delta' })
            started.resolve()
            await release.promise
            controller.enqueue({ delta: 'stale', id: '0', type: 'text-delta' })
            controller.enqueue({ id: '0', type: 'text-end' })
            controller.enqueue({
              finishReason: { raw: undefined, unified: 'stop' },
              type: 'finish',
              usage: {
                inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 1, total: 1 },
                outputTokens: { reasoning: undefined, text: 2, total: 2 },
                totalTokens: 3,
              },
            })
            controller.close()
          },
        }) as never,
      }),
    })
    const conversation = conversationForTesting(session([]), new AgentChatProvider({}, model))
    await conversation.handle('enable', { enabled: true })
    const seen: string[] = []
    const sending = conversation.send('answer slowly', event => {
      if (event.type === 'text') {
        seen.push(event.text)
      }
    })
    await started.promise
    await until(() => seen.length === 1)

    const changingMode = conversation.handle('mode', { mode: 'scenario' })
    release.resolve()
    const [turn] = await Promise.all([sending, changingMode]) as [Record<string, unknown>, unknown]

    Expect(turn['status']).toBe('failed')
    Expect(seen).toEqual(['early '])
    Expect((await conversation.handle('history', {}) as { history: unknown[] }).history).toEqual([])
  })

  Test('refuses to send anything until a person turns cloud use on', async () => {
    const it = chat([{ text: 'hello' }])

    const before = await it.handle('send', { message: 'what is this app?' }) as Record<string, unknown>

    Expect(before['status']).toBe('unavailable')
    const availability = before['availability'] as Record<string, unknown>
    Expect(availability['enabled']).toBe(false)
    Expect(String(availability['reason'])).toBe(
      'Cloud use is off for this session. Turn it on to send this project to a hosted model.',
    )
  })

  Test('answers once cloud use is on, and reports what it spent', async () => {
    const it = chat([{ text: 'It shows a greeting.' }])
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'what is this app?' }) as Record<string, unknown>

    Expect(turn['status']).toBe('complete')
    Expect(turn['text']).toBe('It shows a greeting.')
    Expect((turn['usage'] as Record<string, unknown>)['inputTokens']).toBe(1)
  })

  Test('coverageOfTests reports the real last run from this Studio session', async () => {
    const tests = runner([{ failed: 1, failures: [{ message: 'no greeting', name: 'greets' }], passed: 2 }])
    const it = chat(
      [
        { call: { input: {}, name: 'runTests' } },
        { call: { input: {}, name: 'coverageOfTests' } },
        { text: 'Two pass and greets fails.' },
      ],
      [],
      tests,
    )
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'what is the current test status?' }) as Record<string, unknown>
    const calls = turn['toolCalls'] as { name: string; summary: string }[]
    const coverage = calls.find(call => call.name === 'coverageOfTests')

    Expect(coverage?.summary.includes('never run in this session')).toBe(false)
    Expect(coverage?.summary.includes('"failed":1')).toBe(true)
    Expect(coverage?.summary.includes('greets')).toBe(true)
  })

  Test('an empty message is refused before a model is called', async () => {
    const it = chat([{ text: 'unreachable' }])
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: '   ' }) as Record<string, unknown>

    Expect(turn['status']).toBe('failed')
    Expect(turn['message']).toBe('Ask a question first.')
  })

  Test('a write still cannot land without a person, now that every conversation can write', async () => {
    // Answering and changing are one mode now, so the approval pause is the only thing between a model that
    // decides to write and a project that changes. It has to hold on the very first turn of a conversation.
    const applied: { path: string; content: string }[] = []
    const it = chat([
      {
        call: {
          input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
          name: 'proposeEdit',
        },
      },
      { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
      { text: 'Waiting on you.' },
    ], applied)
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'say Hi instead' }) as Record<string, unknown>

    Expect(turn['status']).toBe('needs-approval')
    Expect(applied).toEqual([])
  })

  Test('a change that was never staged is denied rather than shown as an approval card', async () => {
    // Asking someone to approve a change that does not exist is how people learn to approve without reading.
    const applied: { path: string; content: string }[] = []
    const it = chat([
      { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
      { text: 'There was nothing to apply.' },
    ], applied)
    await it.handle('mode', { mode: 'build' })
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'apply it' }) as Record<string, unknown>

    Expect(turn['status']).toBe('complete')
    Expect(turn['pendingApprovals']).toEqual([])
    Expect(applied).toEqual([])
  })

  Test('a change lands only after the approval round trip', async () => {
    const applied: { path: string; content: string }[] = []
    const it = chat([
      {
        call: {
          input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
          name: 'proposeEdit',
        },
      },
      { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
      { text: 'Changed it.' },
    ], applied)
    await it.handle('mode', { mode: 'build' })
    await it.handle('enable', { enabled: true })

    const asked = await it.handle('send', { message: 'say Hi instead' }) as Record<string, unknown>

    Expect(asked['status']).toBe('needs-approval')
    const approvals = asked['pendingApprovals'] as { approvalId: string; diff?: string }[]
    Expect(approvals.length).toBe(1)
    // The card carries the change itself, not the arguments that produced it.
    Expect(String(approvals[0]?.diff).includes('Hi')).toBe(true)
    // Nothing has reached the project while a person is deciding.
    Expect(applied).toEqual([])

    const done = await it.handle('respond', {
      responses: [{ approvalId: approvals[0]!.approvalId, approved: true }],
    }) as Record<string, unknown>

    Expect(done['status']).toBe('complete')
    Expect(applied.length).toBe(1)
    Expect(applied[0]?.content.includes('Hi')).toBe(true)
  })

  Test('declining leaves the project untouched', async () => {
    const applied: { path: string; content: string }[] = []
    const it = chat([
      {
        call: {
          input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
          name: 'proposeEdit',
        },
      },
      { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
      { text: 'I left it alone.' },
    ], applied)
    await it.handle('mode', { mode: 'build' })
    await it.handle('enable', { enabled: true })
    const asked = await it.handle('send', { message: 'say Hi instead' }) as Record<string, unknown>
    const approvals = asked['pendingApprovals'] as { approvalId: string }[]

    await it.handle('respond', { responses: [{ approvalId: approvals[0]!.approvalId, approved: false }] })

    Expect(applied).toEqual([])
  })

  Test('undo approval shows the reverse diff before restoring files', async () => {
    const it = chat([
      { call: { input: {}, name: 'undoLastChange' } },
      { text: 'Restored it.' },
    ])
    await it.handle('enable', { enabled: true })

    const asked = await it.handle('send', { message: 'undo that' }) as Record<string, unknown>
    const approvals = asked['pendingApprovals'] as { approvalId: string; diff?: string }[]

    Expect(approvals).toHaveLength(1)
    Expect(approvals[0]?.diff).toBe('reverse diff')
  })

  Test('a change that breaks a test is reported as breaking it, not described as done', async () => {
    // The app passes before the change and fails after it, so the failure belongs to this change.
    const tests = runner([
      { failed: 0, failures: [], passed: 2 },
      { failed: 1, failures: [{ message: 'Expected text "Hello"', name: 'greets' }], passed: 1 },
    ])
    const applied: { path: string; content: string }[] = []
    const it = chat(
      [
        {
          call: {
            input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
            name: 'proposeEdit',
          },
        },
        { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
        { text: 'Applied, but it broke a test.' },
      ],
      applied,
      tests,
    )
    await it.handle('mode', { mode: 'build' })
    await it.handle('enable', { enabled: true })
    // Studio takes the baseline immediately before applying, rather than trusting the model to remember it.
    const asked = await it.handle('send', { message: 'say Hi instead' }) as Record<string, unknown>
    const approvals = asked['pendingApprovals'] as { approvalId: string }[]

    const done = await it.handle('respond', {
      responses: [{ approvalId: approvals[0]!.approvalId, approved: true }],
    }) as Record<string, unknown>

    const verdict = done['verdict'] as { status: string; heading: string; broke: { name: string }[] }
    Expect(verdict.status).toBe('broke')
    Expect(verdict.heading).toBe('This change breaks 1 test the app passed before it.')
    Expect(verdict.broke.map(test => test.name)).toEqual(['greets'])
  })

  Test('a source edit during post-change tests makes the exact change verdict stale', async () => {
    let version = 'v1'
    let run = 0
    const applied: { path: string; content: string }[] = []
    const base = session(applied) as unknown as Record<string, unknown>
    const project = {
      ...base,
      applyAgentFiles: async (request: { edits: readonly { path: string; content: string }[] }) => {
        applied.push(...request.edits)
        version = 'v2'
        return {
          compile: { message: 'compiled', status: 'compiled' },
          rolledBack: false,
          sourceVersions: request.edits.map(edit => ({ path: edit.path, sourceVersion: version })),
        }
      },
      readFile: async (path: string) => ({ content: SOURCE, path, sourceVersion: version }),
    } as unknown as StudioProjectSession
    const tests = {
      run: async () => {
        run += 1
        if (run === 2) {
          version = 'v3-manual'
        }
        return { failed: 0, failures: [], passed: 2, status: 'passed' }
      },
    }
    const conversation = conversationForTesting(
      project,
      new AgentChatProvider(
        {},
        scripted([
          {
            call: {
              input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
              name: 'proposeEdit',
            },
          },
          { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
          { text: 'Changed it.' },
        ]),
      ),
    )
    await conversation.handle('enable', { enabled: true })
    const asked = await conversation.handle('send', { message: 'say Hi' }, tests as never) as Record<string, unknown>
    const approvals = asked['pendingApprovals'] as { approvalId: string }[]

    const done = await conversation.handle('respond', {
      responses: [{ approvalId: approvals[0]!.approvalId, approved: true }],
    }, tests as never) as Record<string, unknown>

    const verdict = done['verdict'] as Record<string, unknown>
    Expect(verdict['status']).toBe('unknown')
    Expect(verdict['versionStatus']).toBe('stale')
    Expect(verdict['afterVersions']).toEqual([{ path: PATH, sourceVersion: 'v2' }])
    Expect(verdict['currentVersions']).toEqual([{ path: PATH, sourceVersion: 'v3-manual' }])
  })

  Test('a verdict stays on the turn that ran the checks and out of every later one', async () => {
    const tests = runner([
      { failed: 0, failures: [], passed: 2 },
      { failed: 1, failures: [{ message: 'Expected text "Hello"', name: 'greets' }], passed: 1 },
    ])
    const it = chat(
      [
        {
          call: {
            input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Hi")\n}' },
            name: 'proposeEdit',
          },
        },
        { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
        { text: 'Applied, but it broke a test.' },
      ],
      [],
      tests,
    )
    await it.handle('mode', { mode: 'build' })
    await it.handle('enable', { enabled: true })
    const asked = await it.handle('send', { message: 'say Hi instead' }) as Record<string, unknown>
    const approvals = asked['pendingApprovals'] as { approvalId: string }[]
    const done = await it.handle('respond', {
      responses: [{ approvalId: approvals[0]!.approvalId, approved: true }],
    }) as Record<string, unknown>
    Expect((done['verdict'] as Record<string, unknown>)['status']).toBe('broke')

    // A plain question afterwards ran no checks, so it has no verdict of its own -- and the history
    // the panel replays on reload must not show it the earlier one under this answer too.
    const after = await it.handle('send', { message: 'what changed?' }) as Record<string, unknown>
    Expect(after['verdict']).toBeUndefined()

    const history = (await it.handle('history', {}) as Record<string, unknown>)['history'] as Record<
      string,
      unknown
    >[]
    Expect(history.filter(entry => entry['verdict'] !== undefined)).toHaveLength(1)
  })

  Test('each of two applied changes in one user turn gets its own bound baseline and verdict', async () => {
    const tests = runner([
      { failed: 0, failures: [], passed: 2 },
      { failed: 1, failures: [{ message: 'first broke', name: 'first' }], passed: 1 },
      { failed: 1, failures: [{ message: 'first broke', name: 'first' }], passed: 1 },
      {
        failed: 2,
        failures: [{ message: 'first broke', name: 'first' }, { message: 'second broke', name: 'second' }],
        passed: 0,
      },
    ])
    const it = chat(
      [
        {
          call: {
            input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("One")\n}' },
            name: 'proposeEdit',
          },
        },
        { call: { input: { changeId: 'change-1' }, name: 'applyChange' } },
        {
          call: {
            input: { declaration: 'Greeting', replacement: 'view Greeting() {\n   render Text("Two")\n}' },
            name: 'proposeEdit',
          },
        },
        { call: { input: { changeId: 'change-2' }, name: 'applyChange' } },
        { text: 'Both changes were measured.' },
      ],
      [],
      tests,
    )
    await it.handle('enable', { enabled: true })
    const firstAsk = await it.handle('send', { message: 'make two changes' }) as Record<string, unknown>
    const firstApproval = (firstAsk['pendingApprovals'] as { approvalId: string }[])[0]!

    const secondAsk = await it.handle('respond', {
      responses: [{ approvalId: firstApproval.approvalId, approved: true }],
    }) as Record<string, unknown>
    const firstVerdict = secondAsk['verdict'] as Record<string, unknown>
    const secondApproval = (secondAsk['pendingApprovals'] as { approvalId: string }[])[0]!
    const done = await it.handle('respond', {
      responses: [{ approvalId: secondApproval.approvalId, approved: true }],
    }) as Record<string, unknown>
    const secondVerdict = done['verdict'] as Record<string, unknown>

    Expect(firstVerdict['changeId']).toBe('change-1')
    Expect(firstVerdict['status']).toBe('broke')
    Expect(secondVerdict['changeId']).toBe('change-2')
    Expect(secondVerdict['status']).toBe('broke')
    Expect((secondVerdict['broke'] as { name: string }[]).map(failure => failure.name)).toEqual(['second'])
  })

  Test('scenario mode withholds the code-change tools until a person allows them', async () => {
    const it = chat([{
      call: {
        input: { missing: 'Story has no Hidden field', reason: 'cannot reach the empty state' },
        name: 'requestCodeChanges',
      },
    }, { text: 'I need the app to change.' }])
    await it.handle('mode', { mode: 'scenario' })
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'show me the empty feed' }) as Record<string, unknown>

    const codeChanges = turn['codeChanges'] as { granted: boolean; requests: unknown[] }
    Expect(codeChanges.granted).toBe(false)
    Expect(codeChanges.requests.length).toBe(1)

    const granted = await it.handle('grant-code-changes', {}) as Record<string, unknown>
    Expect(granted['granted']).toBe(true)
  })

  Test('changing mode starts a new conversation rather than carrying tools across', async () => {
    const it = chat([{ text: 'ok' }])
    await it.handle('enable', { enabled: true })
    await it.handle('send', { message: 'first' })

    await it.handle('mode', { mode: 'scenario' })

    Expect((await it.handle('history', {}) as { history: unknown[] }).history).toEqual([])
  })

  Test('the modes that merged both name the one conversation that answers and changes', async () => {
    // `ask` and `build` were separate; a client that still names either lands in the same place.
    const it = chat([{ text: 'ok' }])

    Expect((await it.handle('mode', { mode: 'ask' }) as { mode: string }).mode).toBe('chat')
    Expect((await it.handle('mode', { mode: 'build' }) as { mode: string }).mode).toBe('chat')
    Expect((await it.handle('mode', { mode: 'scenario' }) as { mode: string }).mode).toBe('scenario')
  })

  Test('history reports conversation history and mode across turns', async () => {
    const it = chat([{ text: 'hello there' }])
    await it.handle('enable', { enabled: true })
    await it.handle('send', { message: 'hi' })

    const res = await it.handle('history', {}) as { history: Array<Record<string, unknown>>; mode: string }
    Expect(res.mode).toBe('chat')
    Expect(res.history).toHaveLength(2)
    Expect(res.history[0]).toMatchObject({ role: 'user', text: 'hi' })
    Expect(res.history[1]).toMatchObject({ role: 'assistant', text: 'hello there', status: 'complete' })
  })
})
