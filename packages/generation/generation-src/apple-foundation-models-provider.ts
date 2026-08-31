import type {
  DeepPartial,
  GenerationAvailability,
  GenerationFailure,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationResult,
  GenerationRun,
  JsonValue,
} from './generation-contract'
import { checkGenerationSchema } from './json-schema'

type FoundationModelsEvent =
  | { readonly type: 'partial'; readonly value: JsonValue }
  | { readonly type: 'success'; readonly value: JsonValue }
  | {
    readonly type: 'failure'
    readonly code?: GenerationFailure['code']
    readonly message: string
  }

export type AppleFoundationModelsProviderOptions = {
  readonly fetch?: FoundationModelsFetch
  readonly token: string
  readonly url: string
}

type FoundationModelsFetch = (input: string, init?: RequestInit) => Promise<Response>

/** AppleFoundationModelsProvider adapts the supervised Swift helper to the shared provider seam. */
export class AppleFoundationModelsProvider implements GenerationProvider {
  readonly #fetch: FoundationModelsFetch
  readonly #headers: Record<string, string>
  readonly #url: string

  constructor(options: AppleFoundationModelsProviderOptions) {
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#headers = { authorization: `Bearer ${options.token}` }
    this.#url = options.url.replace(/\/$/, '')
  }

  async availability(): Promise<GenerationAvailability> {
    try {
      const response = await this.#fetch(`${this.#url}/availability`, { headers: this.#headers })
      if (!response.ok) {
        return { status: 'unavailable', reason: await responseMessage(response) }
      }
      return await response.json() as GenerationAvailability
    } catch (error) {
      return { status: 'unavailable', reason: errorMessage(error) }
    }
  }

  generate<Value extends JsonValue = JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): GenerationRun<Value> {
    const partials = new AsyncValueQueue<DeepPartial<Value>>()
    return {
      partials,
      final: this.#generate(schema, inputs, guide, partials),
    }
  }

  async #generate<Value extends JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
    partials: AsyncValueQueue<DeepPartial<Value>>,
  ): Promise<GenerationResult<Value>> {
    try {
      const response = await this.#fetch(`${this.#url}/generate`, {
        body: JSON.stringify({ prompt: generationPrompt(inputs, guide), schema }),
        headers: { ...this.#headers, 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!response.ok || response.body === null) {
        return failure('provider_error', await responseMessage(response))
      }

      let final: GenerationResult<Value> | undefined
      for await (const event of responseEvents(response.body)) {
        if (event.type === 'partial') {
          partials.push(event.value as DeepPartial<Value>)
        } else if (event.type === 'failure') {
          final = failure(event.code ?? 'provider_error', event.message)
        } else {
          const issues = checkGenerationSchema(schema, event.value)
          final = issues.length === 0
            ? { status: 'success', value: event.value as Value }
            : failure(
              'schema_mismatch',
              'Apple Foundation Models returned a value outside the requested schema.',
              issues,
            )
        }
      }
      return final ?? failure('provider_error', 'Apple Foundation Models ended without a final value.')
    } catch (error) {
      return failure('provider_error', errorMessage(error))
    } finally {
      partials.finish()
    }
  }
}

async function* responseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<FoundationModelsEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const result = await reader.read()
      buffer += decoder.decode(result.value, { stream: !result.done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim().length > 0) {
          yield JSON.parse(line) as FoundationModelsEvent
        }
      }
      if (result.done) {
        break
      }
    }
    if (buffer.trim().length > 0) {
      yield JSON.parse(buffer) as FoundationModelsEvent
    }
  } finally {
    reader.releaseLock()
  }
}

function generationPrompt(inputs: readonly GenerationInput[], guide: string): string {
  return [
    guide,
    'Generate one value matching the supplied schema from these explicitly provided inputs:',
    JSON.stringify(Object.fromEntries(inputs.map(input => [input.name, input.value]))),
  ].join('\n\n')
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text()
  return text.trim().length > 0 ? text : `Foundation Models helper returned HTTP ${response.status}.`
}

function failure(
  code: GenerationFailure['code'],
  message: string,
  issues?: readonly string[],
): GenerationFailure {
  return { status: 'failure', code, message, issues }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class AsyncValueQueue<Value> implements AsyncIterable<Value> {
  readonly #values: Value[] = []
  readonly #waiting: Array<(result: IteratorResult<Value>) => void> = []
  #finished = false

  push(value: Value): void {
    if (this.#finished) {
      return
    }
    const resolve = this.#waiting.shift()
    if (resolve) {
      resolve({ done: false, value })
    } else {
      this.#values.push(value)
    }
  }

  finish(): void {
    if (this.#finished) {
      return
    }
    this.#finished = true
    for (const resolve of this.#waiting.splice(0)) {
      resolve({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<Value> {
    return {
      next: async (): Promise<IteratorResult<Value>> => {
        const value = this.#values.shift()
        if (value !== undefined) {
          return { done: false, value }
        }
        if (this.#finished) {
          return { done: true, value: undefined }
        }
        return await new Promise(resolve => this.#waiting.push(resolve))
      },
    }
  }
}
