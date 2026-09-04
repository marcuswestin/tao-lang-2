// Studio agent chat: which model answers, and whether it is allowed to.
//
// Two separate gates, deliberately. A key being present says a hosted model *could* be reached. The person
// turning cloud use on for this session says it *may* be. Neither implies the other, and the panel shows both.

import { createAnthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

const DEFAULT_MODEL = 'claude-sonnet-5'
const KEY_VARIABLE = 'ANTHROPIC_API_KEY'
const MODEL_VARIABLE = 'TAO_STUDIO_AGENT_MODEL'

export type AgentChatAvailability = {
  /** True when a hosted model could be reached: a key is configured. */
  configured: boolean
  /** True when the person has turned cloud use on for this session. */
  enabled: boolean
  provider: 'anthropic'
  model: string
  /** Why the chat cannot run right now, when it cannot. */
  reason?: string
}

/**
 * AgentChatProvider holds the session's answer to "may this send the project's source to a hosted model?".
 * It defaults to no, and nothing here reads a `.env` file: the key comes from the environment Studio was
 * launched with, and never leaves the server.
 */
export class AgentChatProvider {
  #enabled = false
  readonly #environment: Record<string, string | undefined>
  /** A model supplied directly, so the server path can be driven in a test without a provider or a network. */
  readonly #injected: LanguageModel | undefined

  constructor(
    environment: Record<string, string | undefined> = process.env,
    injected?: LanguageModel,
  ) {
    this.#environment = environment
    this.#injected = injected
  }

  get modelId(): string {
    const configured = this.#environment[MODEL_VARIABLE]
    return configured === undefined || configured === '' ? DEFAULT_MODEL : configured
  }

  get #key(): string | undefined {
    if (this.#injected !== undefined) {
      return 'injected'
    }
    const key = this.#environment[KEY_VARIABLE]
    return key === undefined || key === '' ? undefined : key
  }

  availability(): AgentChatAvailability {
    const configured = this.#key !== undefined
    return {
      configured,
      enabled: this.#enabled,
      model: this.modelId,
      provider: 'anthropic',
      ...(configured
        ? this.#enabled ? {} : {
          reason: 'Cloud use is off for this session. Turn it on to send this project to a hosted model.',
        }
        : {
          reason:
            `No ${KEY_VARIABLE} is available. Run \`just secrets\` to decrypt it, then restart Studio; or launch Studio with it set in the environment.`,
        }),
    }
  }

  /** enable records the person's per-session decision. It is never remembered across sessions. */
  enable(enabled: boolean): AgentChatAvailability {
    this.#enabled = enabled
    return this.availability()
  }

  /**
   * model returns the language model to run, or undefined when either gate is closed. The caller reports
   * `availability().reason` rather than guessing why.
   */
  model(): LanguageModel | undefined {
    const key = this.#key
    if (key === undefined || !this.#enabled) {
      return undefined
    }
    return this.#injected ?? createAnthropic({ apiKey: key })(this.modelId)
  }
}
