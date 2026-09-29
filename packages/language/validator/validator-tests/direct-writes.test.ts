import { Describe, Test } from '@shared/test'
import { dataWriteValidationMessages } from '../validator-src/validators/data-write-validator'
import { accepts, rejects, stubView } from './test-validate'

const source = (body: string) => `
  data Items / Item { Title text, Pinned yes / no, Optional yes / no? }
  app Demo { view Empty }
  view Main(Item) { action Flip() { ${body} } render Empty() }
  ${stubView('Empty')}
`
const entityStateSource = (body: string) =>
  source(body).replace(
    'action Flip()',
    'state Selected = Item action Flip()',
  )

Describe('validator: direct row toggles', () => {
  Test(
    'accepts a single nonoptional yes/no row field and existing state toggles',
    accepts(
      source(
        'toggle Item.Pinned',
      ) + ' view StateOwner() { state Ready = false action Flip() { toggle Ready } render Empty() }',
    ),
  )

  Test(
    'rejects a non-boolean row field',
    rejects(
      source('toggle Item.Title'),
      dataWriteValidationMessages.toggleField('Item'),
    ),
  )

  Test(
    'rejects an optional yes/no row field',
    rejects(
      source('toggle Item.Optional'),
      dataWriteValidationMessages.toggleOptional('Item', 'Optional'),
    ),
  )

  Test(
    'rejects a row without a field',
    rejects(
      source('toggle Item'),
      dataWriteValidationMessages.toggleField('Item'),
    ),
  )

  Test(
    'rejects a non-boolean field through an entity-valued state handle',
    rejects(entityStateSource('toggle Selected.Title'), dataWriteValidationMessages.toggleField('Item')),
  )
  Test(
    'rejects an optional field through an entity-valued state handle',
    rejects(
      entityStateSource('toggle Selected.Optional'),
      dataWriteValidationMessages.toggleOptional('Item', 'Optional'),
    ),
  )
})
