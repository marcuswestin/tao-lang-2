// Studio agent chat: the endpoint, and the one conversation a project session holds.

import { FS, Repo } from '@shared'
import { buildSemanticSnapshot } from '../agent-poc/SemanticSnapshot'
import type { StudioProjectSession } from '../StudioProjectSession'
import { askInstructions } from './AgentChatInstructions'
import { AgentChatProvider } from './AgentChatProvider'
import { AgentChatSession, type AgentChatTurn } from './AgentChatSession'
import { type AgentChatToolCall, type AgentChatWorld, readTools } from './AgentChatTools'

type Json = Record<string, unknown>

const RUN_LOG_DIR = '.artifacts/agent-chat/runs'

/** worldFor gives the tools their only view of the project. Everything they can reach passes through here. */
function worldFor(session: StudioProjectSession): AgentChatWorld {
  return {
    files: async () =>
      await Promise.all(
        (await session.files()).map(async file => ({
          content: (await session.readFile(file.path)).content,
          path: file.path,
        })),
      ),
    snapshot: async () => {
      const parsed = await session.agentPocParse()
      return buildSemanticSnapshot(session.projectRoot, session.appName, parsed.files, parsed.diagnostics)
    },
  }
}

/**
 * AgentChatConversation is one chat against one project. It is deliberately server-side: the messages, the
 * approval state, and the provider key never travel to the browser.
 */
class AgentChatConversation {
  readonly #provider: AgentChatProvider
  readonly #session: StudioProjectSession
  #chat: AgentChatSession | undefined
  #calls: AgentChatToolCall[] = []
  #history: { role: 'user' | 'assistant'; text: string; toolCalls?: readonly AgentChatToolCall[] }[] = []

  constructor(session: StudioProjectSession, provider: AgentChatProvider) {
    this.#provider = provider
    this.#session = session
  }

  get provider(): AgentChatProvider {
    return this.#provider
  }

  get history(): readonly { role: 'user' | 'assistant'; text: string; toolCalls?: readonly AgentChatToolCall[] }[] {
    return this.#history
  }

  reset(): void {
    this.#chat = undefined
    this.#calls = []
    this.#history = []
  }

  async send(text: string): Promise<Json> {
    const model = this.#provider.model()
    if (model === undefined) {
      return { availability: this.#provider.availability(), status: 'unavailable' }
    }
    if (this.#chat === undefined) {
      this.#chat = new AgentChatSession({
        drain: () => this.#calls.splice(0, this.#calls.length),
        instructions: askInstructions,
        model,
        tools: readTools(worldFor(this.#session), call => this.#calls.push(call)),
      })
    }
    this.#history.push({ role: 'user', text })
    const turn = await this.#chat.send(text)
    return await this.#record(turn)
  }

  async #record(turn: AgentChatTurn): Promise<Json> {
    this.#history.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls })
    await this.#log(turn)
    return {
      message: turn.message,
      pendingApprovals: turn.pendingApprovals,
      status: turn.status,
      steps: turn.steps,
      text: turn.text,
      toolCalls: turn.toolCalls,
      usage: turn.usage,
    }
  }

  /** Every turn is written to disk: a transcript is the only audit trail of what was sent to a hosted model. */
  async #log(turn: AgentChatTurn): Promise<void> {
    try {
      const directory = Repo.resolvePath(RUN_LOG_DIR)
      await FS.mkdir(directory)
      await FS.writeText(
        FS.resolvePath(`${new Date().toISOString().replace(/[:.]/g, '-')}.json`, directory),
        JSON.stringify(
          {
            app: this.#session.appName,
            model: this.#provider.modelId,
            status: turn.status,
            steps: turn.steps,
            text: turn.text,
            toolCalls: turn.toolCalls,
            usage: turn.usage,
          },
          null,
          2,
        ),
      )
    } catch {
      // A transcript that cannot be written must not fail the turn the person is waiting on.
    }
  }
}

const conversations = new WeakMap<StudioProjectSession, AgentChatConversation>()

function conversationFor(session: StudioProjectSession): AgentChatConversation {
  const existing = conversations.get(session)
  if (existing !== undefined) {
    return existing
  }
  const created = new AgentChatConversation(session, new AgentChatProvider())
  conversations.set(session, created)
  return created
}

export const AgentChat = {
  async handle(session: StudioProjectSession, command: string, body: Json): Promise<unknown> {
    const conversation = conversationFor(session)
    if (command === 'availability') {
      return conversation.provider.availability()
    }
    if (command === 'enable') {
      return conversation.provider.enable(body['enabled'] === true)
    }
    if (command === 'reset') {
      conversation.reset()
      return { status: 'reset' }
    }
    if (command === 'history') {
      return { history: conversation.history }
    }
    if (command === 'send') {
      const text = String(body['message'] ?? '').trim()
      if (text === '') {
        return { message: 'Ask a question first.', status: 'failed' }
      }
      return await conversation.send(text)
    }
    return { error: `Unknown agent chat command: ${command}` }
  },
} as const
