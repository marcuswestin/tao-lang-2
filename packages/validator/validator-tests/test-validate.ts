import { expect } from 'bun:test'
import Validator, { type ValidationResult } from '../validator-src/validator'

/** testValidateCode validates Tao source and asserts it has no error diagnostics. */
export async function testValidateCode(source: string): Promise<ValidationResult> {
  const result = await Validator.validateCode(source)

  expect(validationErrorMessages(result)).toEqual([])
  return result
}

/** testValidateCodeWithErrors validates Tao source expected to produce error diagnostics. */
export async function testValidateCodeWithErrors(source: string): Promise<ValidationResult> {
  const result = await Validator.validateCode(source)

  expect(validationErrorMessages(result).length).toBeGreaterThan(0)
  return result
}

/** validationErrorMessages returns all validation error messages. */
export function validationErrorMessages(result: ValidationResult): string[] {
  return result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.message)
}
