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

interface AppleAvailability {
  readonly available: boolean
  readonly reason: string
}

interface AppleChatOptions {
  readonly messages: string
  readonly schema: GenerationJsonSchema
  readonly stream: true
}

interface AppleOnDeviceModule {
  readonly appleAISDK: {
    checkAvailability(): Promise<AppleAvailability>
  }
  readonly chat: (options: AppleChatOptions) => AsyncIterableIterator<string>
}

type AppleModuleLoader = () => Promise<AppleOnDeviceModule>

/**
 * Studio-server binding for Apple's on-device Foundation Model.
 *
 * The native package is loaded only after an availability or generation call,
 * so importing shared generation machinery remains safe in tests and on other
 * platforms.
 */
export class AppleOnDeviceGenerationProvider implements GenerationProvider {
  readonly #loadModule: AppleModuleLoader
  #module: Promise<AppleOnDeviceModule> | undefined

  constructor(loadModule: AppleModuleLoader = loadAppleOnDeviceModule) {
    this.#loadModule = loadModule
  }

  async availability(): Promise<GenerationAvailability> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      return { status: 'unavailable', reason: 'Apple Intelligence requires an Apple Silicon Mac.' }
    }

    try {
      const module = await this.#appleModule()
      return normalizeAvailability(await module.appleAISDK.checkAvailability())
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
      const availability = await this.availability()
      if (availability.status === 'unavailable') {
        partials.finish()
        return failure('model_unavailable', availability.reason)
      }
      const module = await this.#appleModule()

      const stream = module.chat({
        messages: generationPrompt(inputs, guide),
        schema,
        stream: true,
      })
      let response = ''
      let lastPartial: string | undefined
      for await (const chunk of stream) {
        response += chunk
        const partial = parseGeneratedValue(response)
        if (partial !== undefined) {
          const serialized = JSON.stringify(partial)
          if (serialized !== lastPartial) {
            partials.push(partial as DeepPartial<Value>)
            lastPartial = serialized
          }
        }
      }
      partials.finish()

      const value = parseGeneratedValue(response)
      if (value === undefined) {
        return failure('provider_error', 'Apple Foundation Models returned invalid structured JSON.')
      }
      const issues = checkGenerationSchema(schema, value)
      if (issues.length > 0) {
        return failure(
          'schema_mismatch',
          'Apple Foundation Models returned a value outside the requested schema.',
          issues,
        )
      }
      return { status: 'success', value: value as Value }
    } catch (error) {
      partials.finish()
      return failure('provider_error', errorMessage(error))
    }
  }

  #appleModule(): Promise<AppleOnDeviceModule> {
    this.#module ??= this.#loadModule()
    return this.#module
  }
}

async function loadAppleOnDeviceModule(): Promise<AppleOnDeviceModule> {
  // Keep native binding evaluation out of deterministic tests and non-Apple processes.
  const importModule = Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
  return await importModule('@meridius-labs/apple-on-device-ai') as AppleOnDeviceModule
}

function normalizeAvailability(availability: AppleAvailability): GenerationAvailability {
  return availability.available
    ? { status: 'available' }
    : { status: 'unavailable', reason: availability.reason }
}

function generationPrompt(inputs: readonly GenerationInput[], guide: string): string {
  return [
    guide,
    'Generate one value matching the supplied schema from these explicitly provided inputs:',
    JSON.stringify(Object.fromEntries(inputs.map((input) => [input.name, input.value]))),
  ].join('\n\n')
}

function parseGeneratedValue(response: string): JsonValue | undefined {
  try {
    const parsed: unknown = JSON.parse(response)
    if (!isJsonValue(parsed)) {
      return undefined
    }
    if (isJsonObject(parsed) && 'object' in parsed && isJsonValue(parsed['object'])) {
      return parsed['object']
    }
    return parsed
  } catch {
    return undefined
  }
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }
  if (typeof value !== 'object') {
    return false
  }
  return Object.values(value).every(isJsonValue)
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
        return await new Promise((resolve) => this.#waiting.push(resolve))
      },
    }
  }
}
