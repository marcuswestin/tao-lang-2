// Studio agent chat: the loop, the tool surface, and the pause that waits for a person.
//
// Every test here runs against a scripted model, so the loop's own behavior is what is under test and no
// network is involved.
import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { jsonSchema, tool } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { AgentChatSession } from '../studio-src/agent-chat/AgentChatSession'
import type { AgentChatToolCall } from '../studio-src/agent-chat/AgentChatTools'

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

function tools(calls: string[]) {
  return {
    countStories: tool({
      description: 'How many stories the app declares.',
      execute: async () => {
        calls.push('countStories')
        return { count: 2 }
      },
      inputSchema: jsonSchema({ properties: {}, type: 'object' }),
    }),
    renameStory: tool({
      description: 'Change a story title.',
      execute: async ({ title }: { title: string }) => {
        calls.push(`renameStory:${title}`)
        return { renamed: title }
      },
      inputSchema: jsonSchema({ properties: { title: { type: 'string' } }, required: ['title'], type: 'object' }),
    }),
  }
}

Describe('Studio agent chat loop', () => {
  Test('answers a question by calling a tool and reporting what it found', async () => {
    const calls: string[] = []
    const drained: AgentChatToolCall[] = []
    const session = new AgentChatSession({
      drain: () => drained.splice(0, drained.length),
      instructions: 'Answer from tools.',
      model: scripted([
        { call: { input: {}, name: 'countStories' } },
        { text: 'The app declares 2 stories.' },
      ]),
      tools: tools(calls),
    })

    const turn = await session.send('how many stories?')

    Expect(turn.status).toBe('complete')
    Expect(turn.text).toBe('The app declares 2 stories.')
    Expect(calls).toEqual(['countStories'])
    Expect(turn.steps).toBe(2)
  })

  Test('the answer arrives in pieces while the turn is still running', async () => {
    // A turn can take many seconds across several tool calls. Printing only at the end makes a working agent
    // look like a hung one, so the caller sees text as the model produces it.
    const seen: string[] = []
    const session = new AgentChatSession({
      instructions: 'Answer from tools.',
      model: scripted([
        { call: { input: {}, name: 'countStories' } },
        { text: 'The app declares 2 stories.' },
      ]),
      tools: tools([]),
    })

    const turn = await session.send('how many stories?', event => {
      seen.push(event.type === 'text' ? event.text : `[tool:${event.name}]`)
    })

    // The tool call is announced when the model asks for it, before any of the answer exists.
    Expect(seen[0]).toBe('[tool:countStories]')
    // The answer came as several deltas, not one blob, and they concatenate to the finished text.
    Expect(seen.filter(entry => !entry.startsWith('[tool:')).length).toBeGreaterThan(1)
    Expect(seen.filter(entry => !entry.startsWith('[tool:')).join('')).toBe(turn.text)
  })

  Test('a tool that changes the app waits for a person instead of running', async () => {
    const calls: string[] = []
    const session = new AgentChatSession({
      approvalRequired: ['renameStory'],
      instructions: 'Do as asked.',
      model: scripted([
        { call: { input: { title: 'Renamed' }, name: 'renameStory' } },
        { text: 'Renamed it.' },
      ]),
      tools: tools(calls),
    })

    const turn = await session.send('rename the story')

    Expect(turn.status).toBe('needs-approval')
    Expect(turn.pendingApprovals.length).toBe(1)
    Expect(turn.pendingApprovals[0]?.toolName).toBe('renameStory')
    Expect(turn.pendingApprovals[0]?.input).toEqual({ title: 'Renamed' })
    // The write has not happened: approval is asked before the change, not after.
    Expect(calls).toEqual([])
  })

  Test('approving runs the tool that was waiting', async () => {
    const calls: string[] = []
    const session = new AgentChatSession({
      approvalRequired: ['renameStory'],
      instructions: 'Do as asked.',
      model: scripted([
        { call: { input: { title: 'Renamed' }, name: 'renameStory' } },
        { text: 'Renamed it.' },
      ]),
      tools: tools(calls),
    })
    const asked = await session.send('rename the story')

    const done = await session.respond([{ approvalId: asked.pendingApprovals[0]!.approvalId, approved: true }])

    Expect(done.status).toBe('complete')
    Expect(calls).toEqual(['renameStory:Renamed'])
    Expect(session.pendingApprovals).toEqual([])
  })

  Test('declining leaves the app untouched', async () => {
    const calls: string[] = []
    const session = new AgentChatSession({
      approvalRequired: ['renameStory'],
      instructions: 'Do as asked.',
      model: scripted([
        { call: { input: { title: 'Renamed' }, name: 'renameStory' } },
        { text: 'I did not rename it.' },
      ]),
      tools: tools(calls),
    })
    const asked = await session.send('rename the story')

    const done = await session.respond([{ approvalId: asked.pendingApprovals[0]!.approvalId, approved: false }])

    Expect(done.status).toBe('complete')
    Expect(calls).toEqual([])
  })

  Test('an approval nobody answered is a denial, not a hang', async () => {
    const calls: string[] = []
    const session = new AgentChatSession({
      approvalRequired: ['renameStory'],
      instructions: 'Do as asked.',
      model: scripted([
        { call: { input: { title: 'Renamed' }, name: 'renameStory' } },
        { text: 'Left it alone.' },
      ]),
      tools: tools(calls),
    })
    await session.send('rename the story')

    const done = await session.respond([])

    Expect(done.status).toBe('complete')
    Expect(calls).toEqual([])
  })

  Test('a new message cannot jump the queue while an approval is pending', async () => {
    const session = new AgentChatSession({
      approvalRequired: ['renameStory'],
      instructions: 'Do as asked.',
      model: scripted([{ call: { input: { title: 'Renamed' }, name: 'renameStory' } }]),
      tools: tools([]),
    })
    await session.send('rename the story')

    const turn = await session.send('actually, do something else')

    Expect(turn.status).toBe('needs-approval')
    Expect(turn.message).toBe('Answer the pending approval before sending another message.')
  })

  Test('a model that will not stop is stopped by the budget, and says so', async () => {
    const calls: string[] = []
    const session = new AgentChatSession({
      instructions: 'Answer from tools.',
      maxSteps: 3,
      model: scripted([{ call: { input: {}, name: 'countStories' } }]),
      tools: tools(calls),
    })

    const turn = await session.send('how many stories?')

    Expect(turn.status).toBe('budget-exhausted')
    Expect(turn.steps).toBe(3)
    Expect(calls.length).toBe(3)
    Expect(turn.message).toBe(
      'The step budget of 3 ran out before the model finished. Ask a narrower question, or raise the budget.',
    )
  })

  Test('a provider failure ends the turn without throwing into Studio', async () => {
    const session = new AgentChatSession({
      instructions: 'Answer from tools.',
      model: new MockLanguageModelV3({
        doStream: async () => Errors.throwHostEnvironment('no API key configured'),
      }),
      tools: tools([]),
    })

    const turn = await session.send('anything')

    Expect(turn.status).toBe('failed')
    Expect(turn.message).toBe('no API key configured')
  })
})
