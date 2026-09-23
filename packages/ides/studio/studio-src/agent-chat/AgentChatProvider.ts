// Studio agent chat: which model answers, and whether it is allowed to.
//
// Two separate gates, deliberately. A key being present says a hosted model *could* be reached. The person
// turning cloud use on for this session says it *may* be. Neither implies the other, and the panel shows both.

import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { Errors } from '@shared'
import type { LanguageModel } from 'ai'

/**
 * Every hosted provider the chat can answer with. Each is chosen per session in the panel; the default
 * models are each vendor's standard tier, and each can be overridden from the environment Studio runs in.
 */
const PROVIDERS = {
  anthropic: {
    create: (apiKey: string, model: string): LanguageModel => createAnthropic({ apiKey })(model),
    keyVariable: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    model: 'claude-sonnet-5',
    modelVariable: 'TAO_STUDIO_AGENT_ANTHROPIC_MODEL',
  },
  openai: {
    create: (apiKey: string, model: string): LanguageModel => createOpenAI({ apiKey })(model),
    keyVariable: 'OPENAI_API_KEY',
    label: 'OpenAI',
    model: 'gpt-5.6-terra',
    modelVariable: 'TAO_STUDIO_AGENT_OPENAI_MODEL',
  },
} as const

export type AgentChatProviderName = keyof typeof PROVIDERS

const PROVIDER_NAMES = Object.keys(PROVIDERS) as AgentChatProviderName[]

/** Names the provider a session starts with; without it, the first provider that has a key. */
const PROVIDER_VARIABLE = 'TAO_STUDIO_AGENT_PROVIDER'

/** One provider the person can choose, as the panel lists it. */
type AgentChatProviderOption = {
  /** True when its key is available. */
  configured: boolean
  label: string
  model: string
  name: AgentChatProviderName
}

export type AgentChatAvailability = {
  /** True when a hosted model could be reached: the chosen provider has a key. */
  configured: boolean
  /** True when the person has turned cloud use on for this session. */
  enabled: boolean
  provider: AgentChatProviderName
  model: string
  /** Every provider the person can switch to, including those without a key. */
  providers: AgentChatProviderOption[]
  /** Why the chat cannot run right now, when it cannot. */
  reason?: string
}

function isProviderName(name: string | undefined): name is AgentChatProviderName {
  return name !== undefined && Object.hasOwn(PROVIDERS, name)
}

/**
 * AgentChatProvider holds the session's answers to "which vendor answers?" and "may this send the project's
 * source to it?". Cloud use defaults to off and is turned off again whenever the vendor changes, since
 * consenting to send a project to one vendor is not consent to send it to another. Nothing here reads a
 * `.env` file: keys come from the environment Studio was launched with, and never leave the server.
 */
export class AgentChatProvider {
  #enabled = false
  readonly #environment: Record<string, string | undefined>
  /** A model supplied directly, so the server path can be driven in a test without a provider or a network. */
  readonly #injected: LanguageModel | undefined
  #provider: AgentChatProviderName

  constructor(
    environment: Record<string, string | undefined> = process.env,
    injected?: LanguageModel,
  ) {
    this.#environment = environment
    this.#injected = injected
    const named = environment[PROVIDER_VARIABLE]
    this.#provider = isProviderName(named)
      ? named
      : PROVIDER_NAMES.find(name => this.#keyFor(name) !== undefined) ?? 'anthropic'
  }

  get modelId(): string {
    return this.#modelFor(this.#provider)
  }

  #modelFor(name: AgentChatProviderName): string {
    const configured = this.#environment[PROVIDERS[name].modelVariable]
    return configured === undefined || configured === '' ? PROVIDERS[name].model : configured
  }

  #keyFor(name: AgentChatProviderName): string | undefined {
    if (this.#injected !== undefined) {
      return 'injected'
    }
    const key = this.#environment[PROVIDERS[name].keyVariable]
    return key === undefined || key === '' ? undefined : key
  }

  availability(): AgentChatAvailability {
    const configured = this.#keyFor(this.#provider) !== undefined
    return {
      configured,
      enabled: this.#enabled,
      model: this.modelId,
      provider: this.#provider,
      providers: PROVIDER_NAMES.map(name => ({
        configured: this.#keyFor(name) !== undefined,
        label: PROVIDERS[name].label,
        model: this.#modelFor(name),
        name,
      })),
      ...(configured
        ? this.#enabled ? {} : {
          reason: `Cloud use is off for this session. Turn it on to send this project to ${
            PROVIDERS[this.#provider].label
          }.`,
        }
        : {
          reason: `No ${
            PROVIDERS[this.#provider].keyVariable
          } is available. Run \`just secrets\` to decrypt it, then restart Studio; or launch Studio with it set in the environment.`,
        }),
    }
  }

  /** enable records the person's per-session decision. It is never remembered across sessions. */
  enable(enabled: boolean): AgentChatAvailability {
    this.#enabled = enabled
    return this.availability()
  }

  /** choose switches the vendor for this session, and turns cloud use off unless the vendor is unchanged. */
  choose(provider: string): AgentChatAvailability {
    if (!isProviderName(provider)) {
      Errors.throwUserInput(`'${provider}' is not an agent chat provider; choose ${PROVIDER_NAMES.join(' or ')}.`)
    }
    if (provider !== this.#provider) {
      this.#provider = provider
      this.#enabled = false
    }
    return this.availability()
  }

  /**
   * model returns the language model to run, or undefined when either gate is closed. The caller reports
   * `availability().reason` rather than guessing why.
   */
  model(): LanguageModel | undefined {
    const key = this.#keyFor(this.#provider)
    if (key === undefined || !this.#enabled) {
      return undefined
    }
    return this.#injected ?? PROVIDERS[this.#provider].create(key, this.modelId)
  }
}
