import { AgentCliGenerationProvider } from '@generation/agent-cli-provider'
import { Errors, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { commandOnPath, detectCreationLanes } from '../cli-src/create/creation-lanes'

const ollamaTags = async (input: string): Promise<Response> =>
  input.endsWith('/api/tags')
    ? Response.json({ models: [{ name: 'qwen3:8b' }, { name: 'gemma3:latest' }] })
    : new Response('', { status: 404 })

const nothingListening = async (): Promise<Response> => Errors.throwHostEnvironment('connection refused')

Describe('tao create lanes', () => {
  Test('offers the installed agent CLIs first, then Ollama, then the on-device model', async () => {
    const lanes = await detectCreationLanes({
      arch: 'arm64',
      commandOnPath: async name => (name === 'claude' ? '/opt/bin/claude' : undefined),
      env: { TAO_OLLAMA_MODEL: 'gemma3' },
      fetch: ollamaTags,
      platform: 'darwin',
      repoRoot: Repo.getRoot(),
    })
    Expect(lanes.map(lane => lane.kind)).toEqual(['claude', 'ollama', 'apple'])
    Expect(lanes.map(lane => lane.window)).toEqual(['wide', 'wide', 'narrow'])
    Expect(lanes[0]!.consent).toBe('Claude Code CLI is installed. Use it to shape the project from your description?')
    Expect(lanes[1]!.consent).toBe(
      'Ollama is listening at http://127.0.0.1:11434 with model gemma3. Use it to shape the project?',
    )

    const opened = await lanes[0]!.open()
    try {
      Expect(opened.provider).toBeInstanceOf(AgentCliGenerationProvider)
    } finally {
      await opened.stop?.()
    }

    // A repository without the Swift helper source cannot compile it, so the Apple lane is not offered.
    const elsewhere = await detectCreationLanes({
      arch: 'arm64',
      commandOnPath: async () => undefined,
      env: {},
      fetch: nothingListening,
      platform: 'darwin',
      repoRoot: '/nowhere',
    })
    Expect(elsewhere).toEqual([])
  })

  Test('takes the first Ollama model when none is preferred, and skips lanes that are not there', async () => {
    const lanes = await detectCreationLanes({
      arch: 'x64',
      commandOnPath: async () => undefined,
      env: {},
      fetch: ollamaTags,
      platform: 'linux',
      repoRoot: undefined,
    })
    Expect(lanes.map(lane => lane.kind)).toEqual(['ollama'])
    Expect(lanes[0]!.consent).toContain('with model qwen3:8b')

    const none = await detectCreationLanes({
      arch: 'arm64',
      commandOnPath: async () => undefined,
      env: {},
      fetch: nothingListening,
      platform: 'darwin',
      repoRoot: undefined,
    })
    Expect(none).toEqual([])
  })

  Test('finds a command on PATH by name', async () => {
    Expect(await commandOnPath('sh', { PATH: '/nonexistent:/bin:/usr/bin' })).toBe('/bin/sh')
    Expect(await commandOnPath('definitely-not-a-command', { PATH: '/bin' })).toBeUndefined()
    Expect(await commandOnPath('sh', {})).toBeUndefined()
  })
})
