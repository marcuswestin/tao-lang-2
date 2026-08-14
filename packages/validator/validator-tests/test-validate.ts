import { Diagnostics, FS, Text } from '@shared'
import { Expect, mkTestDir } from '@shared/test'
import { Workspace } from '@workspace'
import Validator, { type ValidationResult } from '../validator-src/validator'

export const tsFence = '```ts'
export const fence = '```'

export async function withValidationParse<T>(
  source: string,
  testFunction: (fixture: {
    result: ValidationResult
    workspace: Workspace
  }) => T | Promise<T>,
): Promise<T> {
  const rootDir = await mkTestDir('tao-validator-parse-')
  try {
    const sourcePath = FS.resolvePath('Source.tao', rootDir)
    await FS.writeText(sourcePath, Text.stripIndent(source))
    const workspace = await Workspace.open(rootDir)
    const validated = await workspace.validate(sourcePath)
    return await testFunction({ result: validated, workspace })
  } finally {
    await FS.remove(rootDir)
  }
}

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
