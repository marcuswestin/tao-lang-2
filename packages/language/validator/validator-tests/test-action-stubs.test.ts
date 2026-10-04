import { Describe, Expect, Test } from '@shared/test'
import { testValidationMessages } from '../validator-src/validators/tests-validator'
import { validationErrorMessages, withValidatedFiles } from './test-validate'

const declarations = `
  app Demo { id "demo" version "1.0.0" name "Demo" view Main }
  view Main() { render inject \`\`\`ts return null \`\`\` }
  type ExportFailure is one of Offline, TooLarge
  action Export() fails Offline "Offline." from ./Export.ts
  action Native() { }
`

async function errorsFor(steps: string): Promise<string[]> {
  let errors: string[] = []
  await withValidatedFiles('Main.tao', {
    'Main.tao': `${declarations}\ntest "Suite" { test "check" { ${steps} } }`,
    'Export.ts': 'export function Export() {}',
  }, result => {
    errors = validationErrorMessages(result)
  })
  return errors
}

Describe('validator: foreign action failure stubs', () => {
  Test('accepts a declared case before run', async () => {
    Expect(await errorsFor('action Export fails Offline run Demo')).toEqual([])
  })

  Test('rejects a case the action did not declare', async () => {
    Expect(await errorsFor('action Export fails TooLarge run Demo')).toContain(
      testValidationMessages.actionStubCase('Export', 'TooLarge'),
    )
  })

  Test('rejects native actions', async () => {
    Expect(await errorsFor('action Native fails Offline run Demo')).toContain(
      testValidationMessages.actionStubForeign('Native'),
    )
  })

  Test('rejects duplicate and late stubs', async () => {
    const errors = await errorsFor('action Export fails Offline run Demo action Export fails Offline')
    Expect(errors).toContain(testValidationMessages.actionStubDuplicate('Export'))
    Expect(errors).toContain(testValidationMessages.actionStubBeforeRun)
  })
})
