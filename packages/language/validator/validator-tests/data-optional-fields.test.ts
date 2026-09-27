import { Describe, stubView, Test } from '@shared/test'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { dataWriteValidationMessages } from '../validator-src/validators/data-write-validator'
import { typeValidationMessages } from '../validator-src/validators/types-validator'
import { accepts, rejects } from './test-validate'

const declarations = `
  type Role is one of Reader, Editor
  data Notes / Note { Title text, State Role? }
`

Describe('validator: optional data fields', () => {
  Test(
    'keeps inverse collections nonnullable for counts and relationship queries',
    accepts(`
    data Owners / Owner { Children? }
    data Children / Child { Owner }
    view Inspect(Owner) {
      let Count = Owner.Children.Count
      query Children = Owner.Children with { }
      render Empty()
    }
    ${stubView('Empty')}
  `),
  )

  Test(
    'accepts omitted, absent, and concrete optional fields in creates and updates',
    accepts(`
    ${declarations}
    action Add() {
      create Note { Title: "Omitted" }
      create Note { Title: "Absent", State: none }
      create Note { Title: "Concrete", State: Reader }
    }
    action Clear(Note) { update Note { State: none } }
  `),
  )

  Test(
    'copies optional values between named create and update fields',
    accepts(`
    ${declarations}
    action Copy(Source Note, Target Note) {
      create Note { Title: "Copy", State: Source.State }
      update Target { State: Source.State }
    }
  `),
  )

  Test(
    'does not require an optional field in a create input projection',
    accepts(`
    ${declarations}
    type NoteInput is Note { Title }
    action Add(Input NoteInput) { create Note with Input }
  `),
  )

  Test(
    'reads optional stored and projected fields as nullable values',
    accepts(`
    ${declarations}
    type NoteInput is Note { Title, State }
    view Inspect(Note, Input NoteInput) {
      let StoredAbsent = Note.State == none
      let ProjectedAbsent = Input.State == none
      render Empty()
    }
    ${stubView('Empty')}
  `),
  )

  Test(
    'still requires a nonoptional field',
    rejects(
      `
    ${declarations}
    action Add() { create Note { State: Reader } }
  `,
      dataWriteValidationMessages.missingCreateField('Note', 'Title'),
    ),
  )

  Test(
    'rejects chained access through an optional entity relation',
    rejects(
      `
    data Accounts / Account { Name text }
    data Notes / Note { Owner Account? }
    view Inspect(Note) { let Name = Note.Owner.Name render Empty() }
    ${stubView('Empty')}
  `,
      typeValidationMessages.memberNotItem('Name'),
    ),
  )

  Test(
    'rejects chained access through a projected optional entity relation',
    rejects(
      `
    data Accounts / Account { Name text }
    data Notes / Note { Owner Account? }
    type NoteInput is Note { Owner }
    view Inspect(Input NoteInput) { let Name = Input.Owner.Name render Empty() }
    ${stubView('Empty')}
  `,
      typeValidationMessages.memberNotItem('Name'),
    ),
  )

  Test(
    'still rejects none in a nonoptional enum',
    rejects(
      `
    type Role is one of Reader, Editor
    data Notes / Note { State Role }
    action Add() { create Note { State: none } }
  `,
      dataWriteValidationMessages.fieldType('State', 'Role', 'none'),
    ),
  )

  Test(
    'still prohibits optional fields with defaults',
    rejects(
      `
    type Role is one of Reader, Editor
    data Notes / Note { State Role? (default Reader) }
  `,
      dataValidationMessages.optionalDefault('State'),
    ),
  )
})
