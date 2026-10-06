import { Workspace } from '@compiler/workspace'
import { Diagnostics, FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { FunctionsValidator } from '../validator-src/validators/functions-validator'

const syntax2Library = 'Apps/Syntax2/library/Library.tao'
const retainedDeclarationsStart = '// 1. Private semantic roles remain accessible through the exported signature.'
const retainedDeclarationsEnd = '// 3. Live data identity and one stored Boolean with its inverse member.'

async function validateWithSyntax2Declarations(main: string) {
  const root = Repo.getRoot()
  const source = await FS.readText(FS.resolvePath(syntax2Library, root))
  const start = source.indexOf(retainedDeclarationsStart)
  const end = source.indexOf(retainedDeclarationsEnd, start)
  Expect(start).toBeGreaterThanOrEqual(0)
  Expect(end).toBeGreaterThan(start)
  const declarations = source.slice(start, end).trim()

  let result: Awaited<ReturnType<Workspace['validate']>> | undefined
  await withTaoFiles('syntax2-forcing-', {
    'Main.tao': `use Name, PersonName, Subtract from ./Library\nuse Duration from @tao/core\n${main}`,
    'Library.tao': declarations,
    '.tao/.gitkeep': '',
  }, async paths => {
    const workspace = await Workspace.open(FS.dirname(paths['Main.tao']!))
    result = await workspace.validate(paths['Main.tao']!)
  })
  Expect(result).toBeDefined()
  return result!
}

function expectFunctionArgumentFailure(
  diagnostics: Awaited<ReturnType<typeof validateWithSyntax2Declarations>>['diagnostics'],
  functionName: string,
) {
  const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  Expect(errors.map(diagnostic => diagnostic.message)).toContain(
    FunctionsValidator.messages.functionUnmatchedArgument(functionName),
  )
  Expect(errors.every(diagnostic => diagnostic.source === 'validator')).toBe(true)
}

Describe('validator: retained Syntax2 forcing examples', () => {
  Test('rejects ambiguous positional calls to the actual Subtract declaration', async () => {
    const result = await validateWithSyntax2Declarations(`let Ambiguous = Subtract(2, 5)`)
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    Expect(errors.map(diagnostic => diagnostic.message)).toEqual([
      FunctionsValidator.messages.functionDuplicateArgumentType('Subtract'),
      FunctionsValidator.messages.functionMissingArgument('Subtract', 'Left'),
      FunctionsValidator.messages.functionMissingArgument('Subtract', 'Right'),
    ])
    Expect(errors.every(diagnostic => diagnostic.source === 'validator')).toBe(true)
  })

  Test('accepts role-qualified arguments to the actual Subtract declaration', async () => {
    const result = await validateWithSyntax2Declarations(`let Ordered = Subtract(Right 2, Left 5)`)
    Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
  })

  Test('rejects narrowing Name into PersonName.GivenName', async () => {
    const result = await validateWithSyntax2Declarations(
      `let Person = PersonName(Name "Ada", .FamilyName "Lovelace")`,
    )
    expectFunctionArgumentFailure(result.diagnostics, 'PersonName')
  })

  Test('accepts the literal projected GivenName for PersonName', async () => {
    const result = await validateWithSyntax2Declarations(
      `let Person = PersonName(.GivenName "Ada", .FamilyName "Lovelace")`,
    )
    Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
  })

  Test('rejects quantity arguments to the actual numeric Subtract declaration', async () => {
    const result = await validateWithSyntax2Declarations(`let Invalid = Subtract(1 minutes, 30 seconds)`)
    const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
    Expect(errors.map(diagnostic => diagnostic.message)).toEqual([
      FunctionsValidator.messages.functionDuplicateArgumentType('Subtract'),
      FunctionsValidator.messages.functionMissingArgument('Subtract', 'Left'),
      FunctionsValidator.messages.functionMissingArgument('Subtract', 'Right'),
    ])
    Expect(errors.every(diagnostic => diagnostic.source === 'validator')).toBe(true)
  })

  Test('accepts infix subtraction across duration units', async () => {
    const result = await validateWithSyntax2Declarations(
      `let Remaining = 1 minutes - 30 seconds`,
    )
    Expect(Diagnostics.errorMessages(result.diagnostics)).toEqual([])
  })
})
