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
  readonly availabilityTimeoutMs?: number
  readonly fetch?: FoundationModelsFetch
  readonly generationTimeoutMs?: number
  /** Reports a supervised helper failure before attempting a request. */
  readonly helperFailure?: () => string | undefined
  readonly token: string
  readonly url: string
}

type FoundationModelsFetch = (input: string, init?: RequestInit) => Promise<Response>

/** AppleFoundationModelsProvider adapts the supervised Swift helper to the shared provider seam. */
export class AppleFoundationModelsProvider implements GenerationProvider {
  readonly #availabilityTimeoutMs: number
  readonly #fetch: FoundationModelsFetch
  readonly #generationTimeoutMs: number
  readonly #headers: Record<string, string>
  readonly #helperFailure: () => string | undefined
  readonly #url: string

  constructor(options: AppleFoundationModelsProviderOptions) {
    this.#availabilityTimeoutMs = positiveTimeout(options.availabilityTimeoutMs, 5_000)
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.#generationTimeoutMs = positiveTimeout(options.generationTimeoutMs, 60_000)
    this.#headers = { authorization: `Bearer ${options.token}` }
    this.#helperFailure = options.helperFailure ?? (() => undefined)
    this.#url = options.url.replace(/\/$/, '')
  }

  async availability(): Promise<GenerationAvailability> {
    const helperFailure = this.#helperFailure()
    if (helperFailure !== undefined) {
      return { status: 'unavailable', reason: helperFailure }
    }
    const deadline = requestDeadline(this.#availabilityTimeoutMs)
    try {
      const response = await abortable(
        this.#fetch(`${this.#url}/availability`, {
          headers: this.#headers,
          signal: requestSignal(deadline.signal),
        }),
        deadline.signal,
      )
      if (!response.ok) {
        return { status: 'unavailable', reason: await responseMessage(response, deadline.signal) }
      }
      return parseAvailability(await abortable(response.json(), deadline.signal))
    } catch (error) {
      if (deadline.signal.aborted) {
        return { status: 'unavailable', reason: deadlineMessage('availability', this.#availabilityTimeoutMs) }
      }
      return { status: 'unavailable', reason: errorMessage(error) }
    } finally {
      deadline.clear()
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
    const helperFailure = this.#helperFailure()
    if (helperFailure !== undefined) {
      partials.finish()
      return failure('model_unavailable', helperFailure)
    }
    const deadline = requestDeadline(this.#generationTimeoutMs)
    try {
      const response = await abortable(
        this.#fetch(`${this.#url}/generate`, {
          body: JSON.stringify({
            deadlineMs: this.#generationTimeoutMs,
            prompt: generationPrompt(inputs, guide),
            schema,
          }),
          headers: { ...this.#headers, 'content-type': 'application/json' },
          method: 'POST',
          signal: requestSignal(deadline.signal),
        }),
        deadline.signal,
      )
      if (!response.ok || response.body === null) {
        return failure('provider_error', await responseMessage(response, deadline.signal))
      }

      for await (const event of responseEvents(response.body, deadline.signal)) {
        if (event.type === 'partial') {
          partials.push(event.value as DeepPartial<Value>)
        } else if (event.type === 'failure') {
          return failure(event.code ?? 'provider_error', event.message)
        } else {
          const issues = checkGenerationSchema(schema, event.value)
          return issues.length === 0
            ? { status: 'success', value: event.value as Value }
            : failure(
              'schema_mismatch',
              'Apple Foundation Models returned a value outside the requested schema.',
              issues,
            )
        }
      }
      return failure('provider_error', 'Apple Foundation Models ended without a final value.')
    } catch (error) {
      if (deadline.signal.aborted) {
        return failure('cancelled', deadlineMessage('generation', this.#generationTimeoutMs))
      }
      return failure('provider_error', errorMessage(error))
    } finally {
      deadline.clear()
      partials.finish()
    }
  }
}

const MAX_EVENT_LINE_BYTES = 1_048_576

async function* responseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<FoundationModelsEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const result = await abortable(reader.read(), signal)
      if (result.value !== undefined) {
        buffer += decoder.decode(result.value, { stream: !result.done })
      } else if (result.done) {
        buffer += decoder.decode()
      }
      if (byteLength(buffer) > MAX_EVENT_LINE_BYTES) {
        throw new Error(`Foundation Models helper event exceeded ${MAX_EVENT_LINE_BYTES} bytes.`)
      }
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim().length > 0) {
          yield parseEvent(line)
        }
      }
      if (result.done) {
        break
      }
    }
    if (buffer.trim().length > 0) {
      yield parseEvent(buffer)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function parseEvent(line: string): FoundationModelsEvent {
  const value = JSON.parse(line) as unknown
  if (!isObject(value) || typeof value['type'] !== 'string') {
    throw new Error('Foundation Models helper returned an invalid event.')
  }
  if ((value['type'] === 'partial' || value['type'] === 'success') && value['value'] !== undefined) {
    return { type: value['type'], value: value['value'] as JsonValue }
  }
  if (value['type'] === 'failure' && typeof value['message'] === 'string') {
    const code = value['code']
    return isFailureCode(code)
      ? { type: 'failure', code, message: value['message'] }
      : { type: 'failure', message: value['message'] }
  }
  throw new Error('Foundation Models helper returned an invalid event.')
}

function parseAvailability(value: unknown): GenerationAvailability {
  if (isObject(value) && value['status'] === 'available') {
    return { status: 'available' }
  }
  if (isObject(value) && value['status'] === 'unavailable' && typeof value['reason'] === 'string') {
    return { status: 'unavailable', reason: value['reason'] }
  }
  return { status: 'unavailable', reason: 'Foundation Models helper returned an invalid availability response.' }
}

function isFailureCode(value: unknown): value is GenerationFailure['code'] {
  return typeof value === 'string' && [
    'accept_failed',
    'cancelled',
    'invalid_scripted_answer',
    'model_unavailable',
    'provider_error',
    'schema_mismatch',
    'scripted_failure',
    'validation_failed',
  ].includes(value)
}

function generationPrompt(inputs: readonly GenerationInput[], guide: string): string {
  return [
    guide,
    'Generate one value matching the supplied schema from these explicitly provided inputs:',
    JSON.stringify(Object.fromEntries(inputs.map(input => [input.name, input.value]))),
  ].join('\n\n')
}

async function responseMessage(response: Response, signal: AbortSignal): Promise<string> {
  const text = await abortable(response.text(), signal)
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

function requestDeadline(timeoutMs: number): {
  clear(): void
  signal: AbortSignal
} {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { clear: () => clearTimeout(timer), signal: controller.signal }
}

function requestSignal(signal: AbortSignal): RequestInit['signal'] {
  // Bun and DOM currently publish structurally different AbortSignal declarations; the runtime object is shared.
  return signal as unknown as RequestInit['signal']
}

async function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    throw new DOMException('The request was cancelled.', 'AbortError')
  }
  return await new Promise<Value>((resolve, reject) => {
    const aborted = () => reject(new DOMException('The request was cancelled.', 'AbortError'))
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', aborted)
        reject(error)
      },
    )
  })
}

function positiveTimeout(value: number | undefined, defaultValue: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : defaultValue
}

function deadlineMessage(operation: string, timeoutMs: number): string {
  return `Apple Foundation Models ${operation} exceeded its ${timeoutMs}ms deadline.`
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class AsyncValueQueue<Value> implements AsyncIterable<Value> {
  static readonly maximumBufferedValues = 64
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
      if (this.#values.length >= AsyncValueQueue.maximumBufferedValues) {
        this.#values.shift()
      }
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
        if (this.#values.length > 0) {
          return { done: false, value: this.#values.shift()! }
        }
        if (this.#finished) {
          return { done: true, value: undefined }
        }
        return await new Promise(resolve => this.#waiting.push(resolve))
      },
    }
  }
}
