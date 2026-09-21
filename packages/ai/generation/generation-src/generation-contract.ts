export type JsonPrimitive = boolean | number | string | null

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type GenerationScalar = 'boolean' | 'number' | 'text' | 'time'

export type GenerationDefault = boolean | number | string | { readonly kind: 'now' }

export type GenerationFieldType =
  | { readonly kind: 'scalar'; readonly scalar: GenerationScalar }
  | { readonly kind: 'case'; readonly name: string; readonly cases: readonly string[] }
  | {
    readonly kind: 'relation'
    readonly entity: string
    readonly inverse: boolean
  }

export interface GenerationField {
  readonly name: string
  readonly optional: boolean
  readonly secret: boolean
  readonly defaultValue?: GenerationDefault
  /** Copy from Tao's `required "..."` sentence, used as model guidance. */
  readonly guidance?: string
  readonly type: GenerationFieldType
}

export interface EntityGenerationDeclaration {
  readonly kind: 'entity'
  readonly name: string
  readonly collection: string
  readonly fields: readonly GenerationField[]
}

export interface CaseGenerationDeclaration {
  readonly kind: 'case'
  readonly name: string
  readonly cases: readonly string[]
}

export type GenerationDeclaration = EntityGenerationDeclaration | CaseGenerationDeclaration

export interface GenerationJsonSchema {
  readonly $schema?: string
  readonly title?: string
  readonly description?: string
  readonly type?: 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string'
  readonly enum?: readonly JsonValue[]
  readonly properties?: Readonly<Record<string, GenerationJsonSchema>>
  readonly required?: readonly string[]
  readonly items?: GenerationJsonSchema
  readonly default?: JsonValue
  readonly additionalProperties?: boolean
}

export interface CompileGenerationOptions {
  /** Relation field paths to include. All relations are excluded by default. */
  readonly relations?: readonly string[]
  /** Catalog used to resolve explicitly included relation targets by entity name. */
  readonly declarations?: readonly GenerationDeclaration[]
}

export interface CompiledGenerationSchema {
  readonly schema: GenerationJsonSchema
  readonly guide: string
  readonly includedFields: readonly string[]
}

export interface GenerationInput {
  readonly name: string
  readonly value: JsonValue
}

export type GenerationAvailability =
  | { readonly status: 'available' }
  | { readonly status: 'unavailable'; readonly reason: string }

export type GenerationFailureCode =
  | 'accept_failed'
  | 'cancelled'
  | 'invalid_scripted_answer'
  | 'model_unavailable'
  | 'provider_error'
  | 'schema_mismatch'
  | 'scripted_failure'
  | 'validation_failed'

export interface GenerationFailure {
  readonly status: 'failure'
  readonly code: GenerationFailureCode
  readonly message: string
  readonly issues?: readonly string[]
}

export interface GenerationSuccess<Value> {
  readonly status: 'success'
  readonly value: Value
}

export type GenerationResult<Value> = GenerationFailure | GenerationSuccess<Value>

export type DeepPartial<Value> = Value extends readonly (infer Item)[] ? readonly DeepPartial<Item>[]
  : Value extends object ? { readonly [Key in keyof Value]?: DeepPartial<Value[Key]> }
  : Value

export interface GenerationRun<Value> {
  readonly partials: AsyncIterable<DeepPartial<Value>>
  readonly final: Promise<GenerationResult<Value>>
}

/**
 * The shared provider shape deliberately mirrors structured-generation SDKs while
 * remaining independent of any provider package.
 */
export interface GenerationProvider {
  availability(): Promise<GenerationAvailability>
  generate<Value extends JsonValue = JsonValue>(
    schema: GenerationJsonSchema,
    inputs: readonly GenerationInput[],
    guide: string,
  ): GenerationRun<Value>
}

export interface GenerationValidateRule<Value> {
  readonly name: string
  readonly validate:
    | ((value: Value) => boolean | string | readonly string[])
    | ((value: Value) => Promise<boolean | string | readonly string[]>)
}
