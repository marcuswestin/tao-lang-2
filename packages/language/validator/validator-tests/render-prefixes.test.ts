import { Describe, Expect, Test } from '@shared/test'
import { ViewsValidator } from '../validator-src/validators/views-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: render prefixes', () => {
  Test('accepts reactive occurrence labels on quotations and custom roots in either order', async () => {
    await testValidateCode(`
      use Col from @tao/ui
      view Main {
        state Caption is text = "Library"
        accessible label Caption
        render Col {
          #quoted a11y label (Caption) "Visible"
          accessible label Caption #custom Leaf
          accessible label "Literal" "Child"
        }
      }
      view Leaf { render "Leaf" }
    `)
  })

  Test('rejects dangling labels and labels separated from their target by setup', async () => {
    for (const body of ['accessible label "Label"', 'accessible label "Label" let Gap = "Gap" "Child"']) {
      const result = await testValidateCodeWithErrors(`use Col from @tao/ui view Main { render Col { ${body} } }`)
      Expect(validationErrorMessages(result)).toEqual([ViewsValidator.messages.accessibilityAttachment])
    }
  })

  Test('rejects labels on loops without changing legacy tag-only loop attachment', async () => {
    const invalid = await testValidateCodeWithErrors(`
      use Col, Text from @tao/ui
      view Main { render Col { accessible label "Rows" loop ["One"] / Item { Text(Item) } } }
    `)
    Expect(validationErrorMessages(invalid)).toEqual([ViewsValidator.messages.accessibilityAttachment])
    await testValidateCode(`
      use Col, Text from @tao/ui
      view Main { render Col { #rows loop ["One"] / Item { Text(Item) } } }
    `)
  })

  Test('rejects nontext labels and multiple fills within one metadata cluster', async () => {
    const nontext = await testValidateCodeWithErrors('view Main { accessible label 42 render "Visible" }')
    Expect(validationErrorMessages(nontext)).toEqual([ViewsValidator.messages.accessibilityText])
    const labels = await testValidateCodeWithErrors(`
      view Main { accessible label "First" a11y label "Second" render "Visible" }
    `)
    Expect(validationErrorMessages(labels)).toEqual([ViewsValidator.messages.duplicateAccessibilityLabel])
    const tags = await testValidateCodeWithErrors(`
      view Main { #first accessible label "Label" #second render "Visible" }
    `)
    Expect(validationErrorMessages(tags)).toEqual([ViewsValidator.messages.duplicatePrefixTag])
  })

  Test('retains text constructors and their ordinary semantic validation', async () => {
    await testValidateCode(`type Caption is text view Main { accessible label Caption "Label" render "Visible" }`)
    const invalid = await testValidateCodeWithErrors(`
      use Col from @tao/ui
      view Main { let Caption = "Label" render Col { accessible label Caption "Child" } }
    `)
    Expect(validationErrorMessages(invalid)).toContain(ViewsValidator.messages.accessibilityAttachment)
  })
})
