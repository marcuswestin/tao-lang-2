import { Diagnostics, FS, Text } from '@shared'
import { Expect, fence, mkTestDir, tsFence, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import Validator, { type ValidationResult } from '../validator-src/validator'

export { fence, tsFence }

/** app wraps a MainView body using the current mandatory declaration parameter-list shape. */
export function app(body: string, extra = ''): string {
  return `
    app MyApp { view MainView }
    view MainView() { ${body} }
    ${extra}
  `
}

/** stubView returns a no-op view fixture using a parenthesized parameter list. */
export function stubView(name: string, parameters = ''): string {
  return `
    view ${name}(${parameters}) {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}

/** stubLayout returns a no-op layout fixture using a parenthesized parameter list. */
export function stubLayout(name: string, parameters = ''): string {
  return `
    layout ${name}(${parameters}) {
      render inject ${tsFence}
        return null
      ${fence}
    }
  `
}

export type ValidatedFiles = Awaited<ReturnType<typeof Workspace.validate>>

const validatorSession = Validator.createSession()

export async function withValidatedFiles<
  const Files extends Record<string, string>,
  EntryFile extends keyof Files & string,
>(
  entryFile: EntryFile,
  files: Files,
  testFunction: (validated: ValidatedFiles) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles('tao-validator-', files, async paths => {
    await testFunction(await Workspace.validate(paths[entryFile]))
  })
}

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

/** accepts returns a test callback that requires source to validate without errors. */
export function accepts(source: string): () => Promise<ValidationResult> {
  return async () => await testValidateCode(source)
}

/** rejects returns a test callback that requires validation errors containing every message. */
export function rejects(source: string, ...messages: readonly string[]): () => Promise<void> {
  return async () => {
    const result = await testValidateCodeWithErrors(source)
    const errors = validationErrorMessages(result).join('\n')
    for (const message of messages) {
      Expect(errors).toContain(message)
    }
  }
}

/** validationErrorMessages returns all validation error messages. */
export function validationErrorMessages(result: ValidationResult): string[] {
  return Diagnostics.errorMessages(result.diagnostics)
}

async function validateCode(source: string): Promise<ValidationResult> {
  return await (await validatorSession).validateCode(source)
}
