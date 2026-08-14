import { Diagnostics } from '@shared'
import { Expect } from '@shared/test'
import Validator, { type ValidationResult } from '../validator-src/validator'

export const tsFence = '```ts'
export const fence = '```'

/** testValidateCode validates Tao source and asserts it has no error diagnostics. */
export async function testValidateCode(source: string): Promise<ValidationResult> {
  const result = await validateCode(source)

  Expect(validationErrorMessages(result)).toEqual([])
  return result
}

/** testValidateCodeWithErrors validates Tao source expected to produce error diagnostics. */
export async function testValidateCodeWithErrors(source: string): Promise<ValidationResult> {
  const result = await validateCode(source)

  Expect(validationErrorMessages(result).length).toBeGreaterThan(0)
  return result
}

/** validationErrorMessages returns all validation error messages. */
export function validationErrorMessages(result: ValidationResult): string[] {
  return Diagnostics.errorMessages(result.diagnostics)
}

async function validateCode(source: string): Promise<ValidationResult> {
  return await Validator.validateCode(source)
}
