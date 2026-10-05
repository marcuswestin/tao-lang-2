import { Describe, Test } from '@shared/test'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, rejects } from './test-validate'

Describe('validator: associated action members', () => {
  Test(
    'validates selected row and collection actions while retaining nested receiver fields',
    accepts(`
      data Books / Book {
        Title text,
        action Book.Return() { },
        action Books.Return() { }
      }
      type Revision is { Book }
      action Caller(Row Book, Rows Books, Value Revision) {
        let Saved = Row.Return
        let Again = Saved
        let Nested = Value.Book.Return
        let Postfix = (Value.Book).Return
        do Again()
        do Rows.Return()
        do Nested()
        do Postfix()
      }
    `),
  )

  Test(
    'rejects an unknown row action member',
    rejects(
      `
      data Books / Book { Title text, action Book.Return() { } }
      action Caller(Row Book) { let Saved = Row.Absent }
    `,
      typeValidationMessages.unknownMember('Book', 'Absent'),
    ),
  )

  Test(
    'rejects a singular action on a collection',
    rejects(
      `
      data Books / Book { Title text, action Book.Return() { } }
      action Caller(Rows Books) { let Saved = Rows.Return }
    `,
      typeValidationMessages.memberNotItem('Return'),
    ),
  )

  Test(
    'rejects a scalar action receiver',
    rejects(
      `
      data Books / Book { Title text, action Book.Return() { } }
      action Caller(Value text) { let Saved = Value.Return }
    `,
      typeValidationMessages.memberNotItem('Return'),
    ),
  )

  Test(
    'validates an unresolved nested prefix without suppressing its member error',
    rejects(
      `
      data Books / Book { Title text, action Book.Return() { } }
      type Revision is { Book }
      action Caller(Value Revision) { let Saved = Value.Absent.Return }
    `,
      typeValidationMessages.unknownMember('Revision', 'Absent'),
    ),
  )
})
