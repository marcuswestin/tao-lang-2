// Studio agent chat: one conversation, and the loop that advances it.
//
// The loop is the AI SDK's. What this file owns is the part Tao cannot delegate: the budget that stops a
// runaway turn, the pause when a tool needs a person's approval, and the transcript that says afterwards
// exactly which tools ran and what they returned.

import { type LanguageModel, type ModelMessage, stepCountIs, streamText, type ToolSet } from 'ai'
import type { AgentChatToolCall } from './AgentChatTools'

/**
 * What the panel is told while a turn is still running. A turn can take many seconds across several tool
 * calls, and printing only at the end makes a working agent look like a hung one.
 */
export type AgentChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }

export type AgentChatApproval = {
  approvalId: string
  toolName: string
  input: unknown
  reason?: string
}

export type AgentChatTurn = {
  /**
   * `complete` - the model finished and answered.
   * `needs-approval` - one or more tools are waiting for a person; the turn resumes with respond().
   * `budget-exhausted` - the step budget ran out first; the answer, if any, is partial.
   * `failed` - the provider or a tool failed in a way the loop could not continue through.
   */
  status: 'complete' | 'needs-approval' | 'budget-exhausted' | 'failed'
  text: string
  toolCalls: readonly AgentChatToolCall[]
  pendingApprovals: readonly AgentChatApproval[]
  steps: number
  usage: { inputTokens?: number; outputTokens?: number }
  message?: string
}

export type AgentChatSessionOptions = {
  model: LanguageModel
  tools: ToolSet
  instructions: string
  /** The Tao-owned budget. The model does not get to decide when it has done enough. */
  maxSteps?: number
  /** Tools that may only run once a person has said yes. */
  approvalRequired?: readonly string[]
  /**
   * A last check before a person is asked. A tool call that cannot do anything useful must not become an
   * approval card: asking someone to approve a change that does not exist teaches them to click yes.
   */
  approvalPolicy?: (call: { toolName: string; input: unknown }) => { denied: string } | undefined
  /** Records every tool call for the transcript; supplied by the tool registry. */
  drain?: () => AgentChatToolCall[]
}

const DEFAULT_MAX_STEPS = 12

/**
 * AgentChatSession holds one conversation. It is deliberately server-side and stateful: the messages, and
 * the approval state that goes with them, never travel to the browser and back.
 */
export class AgentChatSession {
  #options: AgentChatSessionOptions
  #messages: ModelMessage[] = []
  #pending: AgentChatApproval[] = []

  constructor(options: AgentChatSessionOptions) {
    this.#options = options
  }

  /**
   * replaceTools swaps the tool surface without losing the conversation. It is how a person granting the
   * agent permission mid-conversation takes effect: the messages so far are exactly the context in which
   * they granted it, so starting over would discard the reason.
   */
  replaceTools(tools: ToolSet, approvalRequired: readonly string[]): void {
    this.#options = { ...this.#options, approvalRequired, tools }
  }

  /** messages exposes the conversation for the run log and for tests; callers must not mutate it. */
  get messages(): readonly ModelMessage[] {
    return this.#messages
  }

  get pendingApprovals(): readonly AgentChatApproval[] {
    return this.#pending
  }

  async send(text: string, onEvent?: (event: AgentChatEvent) => void): Promise<AgentChatTurn> {
    if (this.#pending.length > 0) {
      // A person's answer to "may I?" is not another instruction. Resolving the pause first keeps the
      // conversation honest about what it is waiting for.
      return {
        message: 'Answer the pending approval before sending another message.',
        pendingApprovals: this.#pending,
        status: 'needs-approval',
        steps: 0,
        text: '',
        toolCalls: [],
        usage: {},
      }
    }
    this.#messages.push({ content: text, role: 'user' })
    return await this.#run(onEvent)
  }

  /** respond answers every pending approval and continues the same turn. */
  async respond(
    responses: readonly { approvalId: string; approved: boolean; reason?: string }[],
    onEvent?: (event: AgentChatEvent) => void,
  ): Promise<AgentChatTurn> {
    if (this.#pending.length === 0) {
      return {
        message: 'Nothing is waiting for approval.',
        pendingApprovals: [],
        status: 'complete',
        steps: 0,
        text: '',
        toolCalls: [],
        usage: {},
      }
    }
    const answered = new Set(responses.map(response => response.approvalId))
    const unanswered = this.#pending.filter(approval => !answered.has(approval.approvalId))
    // An unanswered request is a denial, not a hang: the loop must never wait on something nobody will answer.
    const all = [
      ...responses,
      ...unanswered.map(approval => ({
        approved: false,
        approvalId: approval.approvalId,
        reason: 'No answer was given, so the change was not made.',
      })),
    ]
    this.#messages.push({
      content: all.map(response => ({
        approvalId: response.approvalId,
        approved: response.approved,
        type: 'tool-approval-response' as const,
        ...(response.reason === undefined ? {} : { reason: response.reason }),
      })),
      role: 'tool',
    })
    this.#pending = []
    return await this.#run(onEvent)
  }

  async #run(onEvent?: (event: AgentChatEvent) => void): Promise<AgentChatTurn> {
    const maxSteps = this.#options.maxSteps ?? DEFAULT_MAX_STEPS
    const approvalRequired = new Set(this.#options.approvalRequired ?? [])
    try {
      const result = streamText({
        instructions: this.#options.instructions,
        messages: this.#messages,
        model: this.#options.model,
        stopWhen: stepCountIs(maxSteps),
        tools: this.#options.tools,
        ...(approvalRequired.size === 0 ? {} : {
          toolApproval: ({ toolCall }: { toolCall: { toolName: string; input: unknown } }) => {
            if (!approvalRequired.has(toolCall.toolName)) {
              return undefined
            }
            const refused = this.#options.approvalPolicy?.({
              input: toolCall.input,
              toolName: toolCall.toolName,
            })
            return refused === undefined
              ? ('user-approval' as const)
              : ({ reason: refused.denied, type: 'denied' } as const)
          },
        }),
      })
      // The stream has to be consumed before any of the promises below settle: it is what drives the turn.
      // Text arrives token by token, and a tool call is announced when the model asks for it rather than
      // when the whole turn is over, so a long turn shows what it is doing while it does it.
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          onEvent?.({ text: part.text, type: 'text' })
        } else if (part.type === 'tool-call') {
          onEvent?.({ name: part.toolName, type: 'tool' })
        }
      }
      this.#messages.push(...await result.responseMessages)
      const pending: AgentChatApproval[] = []
      for (const part of await result.content) {
        if (part.type === 'tool-approval-request' && part.isAutomatic !== true) {
          pending.push({
            approvalId: part.approvalId,
            input: part.toolCall.input,
            toolName: part.toolCall.toolName,
            ...(part.reason === undefined ? {} : { reason: part.reason }),
          })
        }
      }
      this.#pending = pending
      const steps = (await result.steps).length
      // A turn that stopped on the step ceiling with a tool call still open has not answered; saying so is
      // more useful than presenting a partial answer as a whole one.
      const exhausted = pending.length === 0 && steps >= maxSteps && await result.finishReason === 'tool-calls'
      const usage = await result.totalUsage
      return {
        pendingApprovals: pending,
        status: pending.length > 0 ? 'needs-approval' : exhausted ? 'budget-exhausted' : 'complete',
        steps,
        text: await result.text,
        toolCalls: this.#options.drain?.() ?? [],
        usage: {
          ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
          ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
        },
        ...(exhausted
          ? {
            message:
              `The step budget of ${maxSteps} ran out before the model finished. Ask a narrower question, or raise the budget.`,
          }
          : {}),
      }
    } catch (error) {
      return {
        message: String(error instanceof Error ? error.message : error),
        pendingApprovals: [],
        status: 'failed',
        steps: 0,
        text: '',
        toolCalls: this.#options.drain?.() ?? [],
        usage: {},
      }
    }
  }
}
