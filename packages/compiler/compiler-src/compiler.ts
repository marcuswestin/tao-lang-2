import { Assert } from '@shared'
import Validator, { type ValidationResult } from '@validator'
import { errorMessages } from '@validator/diagnostics'
import RuntimeGen from './codegen/app/runtime-gen'

type CompileResult = {
  code: string
}

/** Compiler exposes Tao source compilation functions. */
export default {
  /** compileFile compiles the Tao file at `path` into Expo-compatible TSX source. */
  async compileFile(path: string): Promise<CompileResult> {
    return compileValidated(await Validator.validateFile(path))
  },

  /** compileCode compiles Tao source code into Expo-compatible TSX source. */
  async compileCode(code: string): Promise<CompileResult> {
    return compileValidated(await Validator.validateCode(code))
  },
} as const

function compileValidated(result: ValidationResult): CompileResult {
  const errors = errorMessages(result.diagnostics)
  Assert(errors.length === 0, `Cannot compile Tao source with validation errors: ${errors.join('; ')}`, { errors })
  return { code: RuntimeGen.CompileTaoFile(result.parsed.ast) }
}
