import { Errors } from '@shared/core'
import type {
  GenerationFailure,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationResult,
  GenerationRun,
  GenerationValidateRule,
  JsonValue,
} from './generation-contract'
import { checkGenerationSchema } from './json-schema'

export interface ValidateGeneratedDraftOptions<Value extends JsonValue> {
  readonly schema: GenerationJsonSchema
  readonly rules?: readonly GenerationValidateRule<Value>[]
}

export interface GenerateValidatedOptions<Value extends JsonValue> extends ValidateGeneratedDraftOptions<Value> {
  readonly provider: GenerationProvider
  readonly inputs: readonly GenerationInput[]
  readonly guide: string
  /** The durable write boundary. It is called only after schema and validate gates pass. */
  readonly accept?: (value: Value) => void | Promise<void>
}

export async function validateGeneratedDraft<Value extends JsonValue>(
  value: Value,
  options: ValidateGeneratedDraftOptions<Value>,
): Promise<GenerationResult<Value>> {
  const schemaIssues = checkGenerationSchema(options.schema, value)
  if (schemaIssues.length > 0) {
    return failure('schema_mismatch', 'The generated draft does not match its entity schema.', schemaIssues)
  }

  const validationIssues: string[] = []
  for (const rule of options.rules ?? []) {
    try {
      const outcome = await rule.validate(value)
      if (outcome === false) {
        validationIssues.push(`${rule.name} failed.`)
      } else if (typeof outcome === 'string') {
        validationIssues.push(outcome)
      } else if (Array.isArray(outcome)) {
        validationIssues.push(...outcome)
      }
    } catch (error) {
      validationIssues.push(`${rule.name}: ${Errors.messageOf(error)}`)
    }
  }
  if (validationIssues.length > 0) {
    return failure('validation_failed', 'The generated draft failed entity validation.', validationIssues)
  }

  return { status: 'success', value }
}

export function generateValidated<Value extends JsonValue>(
  options: GenerateValidatedOptions<Value>,
): GenerationRun<Value> {
  const run = options.provider.generate<Value>(options.schema, options.inputs, options.guide)
  return {
    partials: run.partials,
    final: gateFinal(run.final, options),
  }
}

async function gateFinal<Value extends JsonValue>(
  providerFinal: Promise<GenerationResult<Value>>,
  options: GenerateValidatedOptions<Value>,
): Promise<GenerationResult<Value>> {
  const result = await providerFinal
  if (result.status === 'failure') {
    return result
  }

  const gated = await validateGeneratedDraft(result.value, options)
  if (gated.status === 'failure' || !options.accept) {
    return gated
  }

  try {
    await options.accept(gated.value)
    return gated
  } catch (error) {
    return failure('accept_failed', `The generated draft could not be accepted: ${Errors.messageOf(error)}`)
  }
}

function failure(
  code: GenerationFailure['code'],
  message: string,
  issues?: readonly string[],
): GenerationFailure {
  return { status: 'failure', code, message, issues }
}
