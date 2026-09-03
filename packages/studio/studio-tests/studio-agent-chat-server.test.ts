// Studio agent chat: the server path, driven end to end with a scripted model.
//
// The loop and the tools have their own tests. This one exercises what a person actually reaches: the command
// handler, the mode gate, the two cloud gates, and the approval round trip that runs across two HTTP calls.
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { Workspace } from '@workspace'
import { MockLanguageModelV3 } from 'ai/test'
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

function scripted(turns: readonly Turn[]): MockLanguageModelV3 {
  let step = 0
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const turn = turns[Math.min(step, turns.length - 1)]!
      step += 1
      type Part =
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: string }
      const content: Part[] = turn.call === undefined
        ? [{ text: turn.text ?? '', type: 'text' }]
        : [{
          input: JSON.stringify(turn.call.input),
          toolCallId: `call-${step}`,
          toolName: turn.call.name,
          type: 'tool-call',
        }]
      return {
        content,
        finishReason: {
          raw: undefined,
          unified: turn.call === undefined ? ('stop' as const) : ('tool-calls' as const),
        },
        usage: {
          inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: 1, total: 1 },
          outputTokens: { reasoning: undefined, text: 1, total: 1 },
          totalTokens: 2,
        },
        warnings: [],
      }
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
    applyAgentPocFiles: async (request: { edits: readonly { path: string; content: string }[] }) => {
      applied.push(...request.edits)
      return { compile: { message: 'compiled', status: 'compiled' }, rolledBack: false }
    },
    agentPocParse: async () => await parsed(),
    compileSnapshot: () => ({ diagnostics: [], status: 'compiled' }),
    files: async () => [{ path: PATH }],
    // The snapshot keeps only files under the project root, so this has to be where the source really is.
    projectRoot: ROOT,
    readFile: async (path: string) => ({ content: SOURCE, path, sourceVersion: 'v1' }),
    undoAgentPocFiles: async () => ({ compile: { message: 'compiled', status: 'compiled' }, restored: [PATH] }),
  } as unknown as StudioProjectSession
}

function chat(turns: readonly Turn[], applied: { path: string; content: string }[] = []) {
  return conversationForTesting(session(applied), new AgentChatProvider({}, scripted(turns)))
}

Describe('Studio agent chat server', () => {
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

  Test('an empty message is refused before a model is called', async () => {
    const it = chat([{ text: 'unreachable' }])
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: '   ' }) as Record<string, unknown>

    Expect(turn['status']).toBe('failed')
    Expect(turn['message']).toBe('Ask a question first.')
  })

  Test('ask mode has no tool that could change the app', async () => {
    // The model asks for a change tool by name; in this mode it does not exist, so the call cannot be made.
    const it = chat([{ call: { input: { changeId: 'change-1' }, name: 'applyChange' } }, { text: 'I cannot.' }])
    await it.handle('enable', { enabled: true })

    const turn = await it.handle('send', { message: 'change the greeting' }) as Record<string, unknown>

    // The turn ends without any write reaching the project.
    Expect(turn['status']).not.toBe('needs-approval')
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

    await it.handle('mode', { mode: 'build' })

    Expect((await it.handle('history', {}) as { history: unknown[] }).history).toEqual([])
  })
})
