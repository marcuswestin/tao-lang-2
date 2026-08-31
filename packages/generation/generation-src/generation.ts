export {
  AppleFoundationModelsProvider,
  type AppleFoundationModelsProviderOptions,
} from './apple-foundation-models-provider'
export {
  type AppleFoundationModelsService,
  startAppleFoundationModelsService,
  UnavailableGenerationProvider,
} from './apple-foundation-models-service'
export type {
  CaseGenerationDeclaration,
  CompiledGenerationSchema,
  CompileGenerationOptions,
  DeepPartial,
  EntityGenerationDeclaration,
  GenerationAvailability,
  GenerationDeclaration,
  GenerationDefault,
  GenerationFailure,
  GenerationFailureCode,
  GenerationField,
  GenerationFieldType,
  GenerationInput,
  GenerationJsonSchema,
  GenerationProvider,
  GenerationResult,
  GenerationRun,
  GenerationScalar,
  GenerationSuccess,
  GenerationValidateRule,
  JsonObject,
  JsonPrimitive,
  JsonValue,
} from './generation-contract'
export { checkGenerationSchema } from './json-schema'
export { compileGenerationSchema } from './schema-compiler'
export {
  type RecordedGenerationCall,
  type ScriptedAnswer,
  type ScriptedFailure,
  type ScriptedGeneration,
  ScriptedGenerationProvider,
} from './scripted-provider'
export {
  generateValidated,
  type GenerateValidatedOptions,
  validateGeneratedDraft,
  type ValidateGeneratedDraftOptions,
} from './validate-gate'
