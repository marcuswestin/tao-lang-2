import type {
  DeepPartial,
  GenerationAvailability,
  GenerationFailure,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationRun,
  JsonValue,
} from './generation-contract'
import { checkGenerationSchema } from './json-schema'

export interface ScriptedAnswer<Value extends JsonValue = JsonValue> {
  readonly kind: 'answer'
  readonly value: Value
  readonly partials?: readonly DeepPartial<Value>[]
}

export interface ScriptedFailure {
  readonly kind: 'failure'
  readonly code?: GenerationFailure['code']
  readonly message: string
}

export type ScriptedGeneration<Value extends JsonValue = JsonValue> =
  | ScriptedAnswer<Value>
  | ScriptedFailure

export interface RecordedGenerationCall {
  readonly schema: GenerationJsonSchema
  readonly inputs: readonly GenerationInput[]
  readonly guide: string
}

export class ScriptedGenerationProvider implements GenerationProvider {
  readonly calls: RecordedGenerationCall[] = []
  readonly #scripts: ScriptedGeneration[]
  #availability: GenerationAvailability

  constructor(
    scripts: readonly ScriptedGeneration[],
    availability: GenerationAvailability = { status: 'available' },
  ) {
    this.#scripts = [...scripts]
    this.#availability = availability
  }

  async availability(): Promise<GenerationAvailability> {
    return this.#availability
  }

  setAvailability(availability: GenerationAvailability): void {
    this.#availability = availability
  }

  generate<Value extends JsonValue = JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): GenerationRun<Value> {
    this.calls.push({ schema, inputs, guide })
    if (this.#availability.status === 'unavailable') {
      return failureRun({
        status: 'failure',
        code: 'model_unavailable',
        message: this.#availability.reason,
      })
    }
    const script = this.#scripts.shift()
    if (!script) {
      return failureRun({
        status: 'failure',
        code: 'scripted_failure',
        message: 'The scripted provider has no answer for this generation.',
      })
    }
    if (script.kind === 'failure') {
      return failureRun({
        status: 'failure',
        code: script.code ?? 'scripted_failure',
        message: script.message,
      })
    }

    const issues = checkGenerationSchema(schema, script.value)
    if (issues.length > 0) {
      return {
        partials: values([]),
        final: Promise.resolve({
          status: 'failure',
          code: 'invalid_scripted_answer',
          message: 'The scripted answer does not match the generation schema.',
          issues,
        }),
      }
    }

    return {
      partials: values((script.partials ?? []) as readonly DeepPartial<Value>[]),
      final: Promise.resolve({ status: 'success', value: script.value as Value }),
    }
  }
}

function failureRun<Value extends JsonValue>(failure: GenerationFailure): GenerationRun<Value> {
  return { partials: values([]), final: Promise.resolve(failure) }
}

async function* values<Value>(items: readonly Value[]): AsyncIterable<Value> {
  for (const item of items) {
    yield item
  }
}
