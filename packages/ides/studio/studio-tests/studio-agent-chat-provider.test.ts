import { Describe, Expect, Test } from '@shared/test'
import { AgentChatProvider } from '../studio-src/agent-chat/AgentChatProvider'

/** The vendor and model a built model reports, without sending anything anywhere. */
function built(provider: AgentChatProvider): { modelId: string; provider: string } {
  return provider.model() as unknown as { modelId: string; provider: string }
}

Describe('Studio agent chat provider', () => {
  Test('starts with the first provider that has a key, and lists every provider', () => {
    const availability = new AgentChatProvider({ OPENAI_API_KEY: 'key' }).availability()

    Expect(availability.provider).toBe('openai')
    Expect(availability.configured).toBe(true)
    Expect(availability.providers.map(option => [option.name, option.configured])).toEqual([
      ['anthropic', false],
      ['openai', true],
    ])
  })

  Test('starts with the provider the environment names, and says which key it lacks', () => {
    const availability = new AgentChatProvider({ ANTHROPIC_API_KEY: 'key', TAO_STUDIO_AGENT_PROVIDER: 'openai' })
      .availability()

    Expect(availability.provider).toBe('openai')
    Expect(availability.configured).toBe(false)
    Expect(availability.reason).toContain('No OPENAI_API_KEY is available')
  })

  Test('turns cloud use off when the vendor changes, since consent was given to the other one', () => {
    const provider = new AgentChatProvider({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })
    provider.enable(true)

    Expect(provider.choose('anthropic').enabled).toBe(true)
    const switched = provider.choose('openai')

    Expect(switched.provider).toBe('openai')
    Expect(switched.enabled).toBe(false)
    Expect(provider.model()).toBeUndefined()
  })

  Test('builds the chosen vendor model, with a per-vendor override', () => {
    const provider = new AgentChatProvider({
      ANTHROPIC_API_KEY: 'a',
      OPENAI_API_KEY: 'o',
      TAO_STUDIO_AGENT_OPENAI_MODEL: 'gpt-5.6-sol',
    })
    provider.enable(true)
    Expect(built(provider).provider).toStartWith('anthropic')
    Expect(built(provider).modelId).toBe('claude-sonnet-5')

    provider.choose('openai')
    provider.enable(true)

    Expect(built(provider).provider).toStartWith('openai')
    Expect(built(provider).modelId).toBe('gpt-5.6-sol')
  })

  Test('rejects a provider it does not know', () => {
    Expect(() => new AgentChatProvider({}).choose('elsewhere')).toThrow('not an agent chat provider')
  })
})
