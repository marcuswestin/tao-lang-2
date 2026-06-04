import { Assert } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { errorMessages } from '@validator/diagnostics'
import { compileFile as compileRuntimeFile } from './codegen/app/runtime-gen'

type CompileResult = {
  code: string
}

/** compileFile compiles the Tao file at `path` into Expo-compatible TSX source. */
async function compileFile(path: string): Promise<CompileResult> {
  return compileValidated(await Validator.validateFile(path))
}

/** compileCode compiles Tao source code into Expo-compatible TSX source. */
async function compileCode(code: string): Promise<CompileResult> {
  return compileValidated(await Validator.validateCode(code))
}

/** Compiler exposes Tao source compilation functions. */
const Compiler = {
  compileCode,
  compileFile,
}
export default Compiler

function compileValidated(result: ValidationResult): CompileResult {
  assertValidationClean(result)
  return { code: compileRuntimeFile(result.parsed.ast) }
}

function assertValidationClean(result: ValidationResult): void {
  const errors = errorMessages(result.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao source with validation errors: ${errors.join('; ')}`, { errors })
}
