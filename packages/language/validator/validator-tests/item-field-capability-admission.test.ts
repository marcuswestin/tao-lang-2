import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { configuredItemValidationMessages } from '../validator-src/validators/configured-item-validator'
import { testValidateCode, testValidateCodeWithErrors, validationErrorMessages } from './test-validate'

Describe('validator: explicit item field capability admission', () => {
  Test('admits a concrete method witness into an explicitly labeled capability field', async () => {
    await testValidateCode(`
      type Title is text with {
        func ToText() fails never -> text { return "Title:{Title}" }
      }
      can Display { ToText() fails never -> text }
      type Row is { Content Display }
      view Main {
        let Value = Title "before"
        let Entry = Row { Content: Value }
        render "Items"
      }
    `)
  })

  for (const actual of ['Parent', 'Sibling']) {
    Test(`keeps ${actual} from implicitly constructing a labeled Child field`, async () => {
      const result = await testValidateCodeWithErrors(`
        type Parent is text
        type Child is Parent
        type Sibling is Parent
        type Row is { Content Child }
        view Main {
          let Given = ${actual} "before"
          let Entry = Row { Content: Given }
          render "Items"
        }
      `)
      Expect(result.entry.document.parseResult.parserErrors).toHaveLength(0)
      const property = AST.streamAllContents(result.entry.ast).find(node =>
        AST.isConfigurationEntry(node) && node.label === 'Content'
      )
      Expect.Is(property, AST.isConfigurationEntry)
      const expected = configuredItemValidationMessages.namedPropertyType('Content', 'Row.Content', actual)
      Expect(validationErrorMessages(result)).toContain(expected)
      const diagnostic = result.diagnostics.find(diagnostic => diagnostic.message === expected)
      Expect(diagnostic?.source).toBe('validator')
      Expect(diagnostic?.range).toEqual(property.$cstNode!.range)
    })
  }
})
