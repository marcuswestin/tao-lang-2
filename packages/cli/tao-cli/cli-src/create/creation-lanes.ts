import { DEFAULT_OLLAMA_URL, type GenerationProvider, listOllamaModels, OllamaGenerationProvider } from '@generation'
import { AgentCliGenerationProvider } from '@generation/agent-cli-provider'
import { FS, Platform, Repo } from '@shared'

/** CreationLaneKind names a way to reach a model without configuring a key. */
export type CreationLaneKind = 'apple' | 'claude' | 'codex' | 'ollama'

export const creationLaneKinds: readonly CreationLaneKind[] = ['claude', 'codex', 'ollama', 'apple']

/** CreationWindow says how much a lane's model can read at once, which decides the pipeline shape. */
export type CreationWindow = 'narrow' | 'wide'

export type OpenedLane = {
  provider: GenerationProvider
  stop?: () => Promise<void>
}

/** CreationLane is one detected model lane; `open` starts it only when it is actually chosen. */
export type CreationLane = {
  consent: string
  kind: CreationLaneKind
  label: string
  open: () => Promise<OpenedLane>
  window: CreationWindow
}

type LaneFetch = (input: string, init?: RequestInit) => Promise<Response>

/** The Apple lane compiles this helper from source, so it exists only inside a Tao checkout that has it. */
const APPLE_HELPER_SOURCE = 'packages/ai/generation/generation-native/AppleFoundationModelsServer.swift'

export type DetectCreationLanesOptions = {
  arch?: string
  attachments?: readonly string[]
  commandOnPath?: (name: string) => Promise<string | undefined>
  env?: Record<string, string | undefined>
  fetch?: LaneFetch
  ollamaUrl?: string
  openApple?: () => Promise<OpenedLane>
  platform?: string
  repoRoot?: string
}

/**
 * detectCreationLanes lists the lanes this machine offers, most capable first: an installed coding
 * agent, a listening Ollama, then Apple's on-device model. Detection is cheap; nothing is started.
 */
export async function detectCreationLanes(options: DetectCreationLanesOptions = {}): Promise<CreationLane[]> {
  const env = options.env ?? Platform.runtimeProcess.env
  const findCommand = options.commandOnPath ?? (name => commandOnPath(name, env))
  const lanes: CreationLane[] = []

  for (const kind of ['claude', 'codex'] as const) {
    const command = await findCommand(kind)
    if (command === undefined) {
      continue
    }
    const label = kind === 'claude' ? 'Claude Code CLI' : 'Codex CLI'
    lanes.push({
      kind,
      label,
      window: 'wide',
      consent: `${label} is installed. Use it to shape the project from your description?`,
      open: async () => {
        const cwd = await FS.mkTmpDir('tao-create-agent-')
        return {
          provider: new AgentCliGenerationProvider({
            attachments: options.attachments ?? [],
            command,
            cwd,
            env,
            kind,
          }),
          stop: () => FS.remove(cwd).catch(() => undefined),
        }
      },
    })
  }

  const ollamaUrl = options.ollamaUrl ?? env['TAO_OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL
  const models = await listOllamaModels({
    url: ollamaUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
  if (models !== undefined && models.length > 0) {
    const preferred = env['TAO_OLLAMA_MODEL']
    const model = preferred !== undefined && models.some(name => name === preferred || name === `${preferred}:latest`)
      ? preferred
      : models[0]!
    lanes.push({
      kind: 'ollama',
      label: 'Ollama',
      window: 'wide',
      consent: `Ollama is listening at ${ollamaUrl} with model ${model}. Use it to shape the project?`,
      open: async () => ({
        provider: new OllamaGenerationProvider({
          model,
          url: ollamaUrl,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
        }),
      }),
    })
  }

  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const repoRoot = 'repoRoot' in options ? options.repoRoot : Repo.tryGetRoot()
  const appleHelper = repoRoot === undefined ? false : await FS.isFile(FS.resolvePath(APPLE_HELPER_SOURCE, repoRoot))
  if (platform === 'darwin' && arch === 'arm64' && appleHelper) {
    lanes.push({
      kind: 'apple',
      label: "Apple's on-device model",
      window: 'narrow',
      consent: "Apple's on-device model can run here. Use it to shape the project?",
      open: options.openApple ?? openAppleLane,
    })
  }
  return lanes
}

/** commandOnPath finds an executable by name on PATH, or undefined when it is not installed. */
export async function commandOnPath(
  name: string,
  env: Record<string, string | undefined> = Platform.runtimeProcess.env,
): Promise<string | undefined> {
  for (const directory of (env['PATH'] ?? '').split(':').filter(entry => entry.length > 0)) {
    const candidate = FS.resolvePath(name, directory)
    if (await FS.isFile(candidate)) {
      return candidate
    }
  }
  return undefined
}

async function openAppleLane(): Promise<OpenedLane> {
  const { startAppleFoundationModelsService } = await import('@generation/apple-server')
  const service = await startAppleFoundationModelsService()
  return { provider: service.provider, stop: () => service.stop() }
}
