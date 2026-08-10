import { Describe, Expect, Test } from '@shared/test'
import { FunctionalCoreValidator } from '../validator-src/FunctionalCoreValidator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

const runtimeViews = `
  layout Stack { render inject \`\`\`ts\nreturn null\n\`\`\` }
  view Text Value is text { render inject Value \`\`\`ts\nreturn null\n\`\`\` }
`

Describe('functional core validator', () => {
  Test('accepts a typed functional render path', async () => {
    await testValidateCode(`
      app FunctionalApp { view Main }
      function HasCount Count is number returns boolean = Count > 0 and not false
      function Label Count is number returns text = interpolate "Count: ", Count
      view Main {
        render Stack {
          if HasCount(2) {
            Text Label(2)
          } else {
            Text "Empty"
          }
          for Name in ["Inbox" "Today"] { Text Name }
        }
      }
      ${runtimeViews}
    `)
  })

  Test('reports actionable function, condition, and collection errors', async () => {
    const result = await testValidateCodeWithErrors(`
      app BrokenApp { view Main }
      function Wrong Value is number returns boolean = Value + 1
      view Main {
        render Stack {
          if 1 { Text "Wrong condition" }
          for Value in "not a list" { Text Value }
        }
      }
      ${runtimeViews}
    `)
    const errors = validationErrorMessages(result)

    Expect(errors).toContain(FunctionalCoreValidator.messages.functionReturn('Wrong', 'boolean', 'number'))
    Expect(errors).toContain(FunctionalCoreValidator.messages.conditionBoolean)
    Expect(errors).toContain(FunctionalCoreValidator.messages.forCollection)
  })
})
