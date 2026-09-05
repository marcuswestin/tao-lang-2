import type {
  GenerationAvailability,
  GenerationFailure,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationResult,
  GenerationRun,
  JsonValue,
} from './generation-contract'
import { emptyPartials, generationPrompt, parseJsonText } from './generation-prompt'
import { checkGenerationSchema } from './json-schema'

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

type OllamaFetch = (input: string, init?: RequestInit) => Promise<Response>

export type OllamaGenerationProviderOptions = {
  readonly fetch?: OllamaFetch
  readonly generationTimeoutMs?: number
  readonly model: string
  readonly url?: string
}

export type ListOllamaModelsOptions = {
  readonly fetch?: OllamaFetch
  readonly timeoutMs?: number
  readonly url?: string
}

/**
 * OllamaGenerationProvider asks a locally served Ollama model for schema-constrained JSON through its
 * chat endpoint's `format` field. It needs no key and no network beyond the loopback interface.
 */
export class OllamaGenerationProvider implements GenerationProvider {
  readonly #fetch: OllamaFetch
  readonly #generationTimeoutMs: number
  readonly #model: string
  readonly #url: string

  constructor(options: OllamaGenerationProviderOptions) {
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#generationTimeoutMs = options.generationTimeoutMs ?? 180_000
    this.#model = options.model
    this.#url = (options.url ?? DEFAULT_OLLAMA_URL).replace(/\/$/u, '')
  }

  async availability(): Promise<GenerationAvailability> {
    const models = await listOllamaModels({ fetch: this.#fetch, url: this.#url })
    if (models === undefined) {
      return { status: 'unavailable', reason: `Ollama is not listening at ${this.#url}.` }
    }
    if (!models.some(name => sameModel(name, this.#model))) {
      return { status: 'unavailable', reason: `Ollama has no model named ${this.#model}.` }
    }
    return { status: 'available' }
  }

  generate<Value extends JsonValue = JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): GenerationRun<Value> {
    return { partials: emptyPartials(), final: this.#generate<Value>(schema, inputs, guide) }
  }

  async #generate<Value extends JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): Promise<GenerationResult<Value>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#generationTimeoutMs)
    try {
      const { $schema: _dialect, ...format } = schema
      const response = await this.#fetch(`${this.#url}/api/chat`, {
        body: JSON.stringify({
          model: this.#model,
          stream: false,
          format,
          options: { temperature: 0.2 },
          messages: [
            {
              role: 'system',
              content: 'You fill in JSON that matches the given schema exactly. Answer with the JSON only.',
            },
            { role: 'user', content: generationPrompt(inputs, guide) },
          ],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: requestSignal(controller.signal),
      })
      if (!response.ok) {
        return failure('provider_error', `Ollama returned HTTP ${response.status}: ${(await response.text()).trim()}`)
      }
      const body = await response.json() as { message?: { content?: unknown } }
      const content = typeof body.message?.content === 'string' ? body.message.content : ''
      const value = parseJsonText(content)
      if (value === undefined) {
        return failure('provider_error', 'Ollama answered without JSON.')
      }
      const issues = checkGenerationSchema(schema, value)
      return issues.length === 0
        ? { status: 'success', value: value as Value }
        : failure('schema_mismatch', 'Ollama returned a value outside the requested schema.', issues)
    } catch (error) {
      if (controller.signal.aborted) {
        return failure('cancelled', `Ollama did not answer within ${this.#generationTimeoutMs} ms.`)
      }
      return failure('provider_error', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
    }
  }
}

/** listOllamaModels returns the installed model names, or undefined when nothing is listening. */
export async function listOllamaModels(options: ListOllamaModelsOptions = {}): Promise<string[] | undefined> {
  const url = (options.url ?? DEFAULT_OLLAMA_URL).replace(/\/$/u, '')
  const fetcher = options.fetch ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 1_500)
  try {
    const response = await fetcher(`${url}/api/tags`, { signal: requestSignal(controller.signal) })
    if (!response.ok) {
      return undefined
    }
    const body = await response.json() as { models?: unknown }
    if (!Array.isArray(body.models)) {
      return []
    }
    return body.models.flatMap(model =>
      typeof model === 'object' && model !== null && typeof (model as { name?: unknown }).name === 'string'
        ? [(model as { name: string }).name]
        : []
    )
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

function requestSignal(signal: AbortSignal): RequestInit['signal'] {
  // Bun and DOM publish structurally different AbortSignal declarations; the runtime object is shared.
  return signal as unknown as RequestInit['signal']
}

function sameModel(installed: string, wanted: string): boolean {
  return installed === wanted || installed === `${wanted}:latest` || `${installed}:latest` === wanted
}

function failure(code: GenerationFailure['code'], message: string, issues?: readonly string[]): GenerationFailure {
  return issues === undefined ? { status: 'failure', code, message } : { status: 'failure', code, message, issues }
}
