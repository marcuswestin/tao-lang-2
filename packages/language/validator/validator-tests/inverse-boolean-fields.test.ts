import { Type } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { validationErrorMessages, withValidationParse } from './test-validate'

Describe('validator: inverse boolean fields', () => {
  Test('reads and writes the negative case through its one stored boolean field', async () => {
    await withValidationParse(`
      data Books / Book { LoanedOut yes / Returned no }
      action MarkReturned(Book) {
        let IsReturned = Book.Returned
        update Book { Returned: yes }
      }
    `, ({ result }) => {
      Expect(validationErrorMessages(result)).toEqual([])

      const book = result.entry.ast.statements.find(AST.isEntityDataDeclaration)
      Assert.defined(book, 'validated inverse-field fixture has its Books entity')
      const storedField = Type.dataFields(book).find(field => field.name === 'LoanedOut')
      Assert.defined(storedField, 'validated inverse-field fixture has its stored LoanedOut field')

      const returnedRead = [...AST.streamAllContents(result.entry.ast)]
        .filter(AST.isMemberAccessExpression)
        .find(node => node.members.at(-1) === 'Returned')
      Assert.defined(returnedRead, 'validated inverse-field fixture reads Book.Returned')
      Expect(Type.ofExpression(returnedRead)).toEqual(Type.dataFieldValueType(storedField))
      Expect(Type.dataFieldOfMemberAccess(returnedRead)).toBe(storedField)
    })
  })
})
