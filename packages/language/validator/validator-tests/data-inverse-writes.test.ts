import { Describe, Test } from '@shared/test'
import { dataWriteValidationMessages } from '../validator-src/validators/data-write-validator'
import { accepts, rejects } from './test-validate'

const declaration = 'data Notes / Note { Pinned yes / Unpinned no }'

Describe('validator: inverse Boolean writes', () => {
  Test(
    'accepts either value through the inverse label',
    accepts(`
    ${declaration}
    action Change(Note) {
      update Note { Unpinned: true }
      update Note { Unpinned: false }
    }
  `),
  )

  Test(
    'preserves bare declared cases and unnamed Boolean fields',
    accepts(`
    ${declaration}
    data Flags / Flag { Selected yes / no }
    action Change(Note, Flag) {
      update Note { Unpinned }
      update Flag { Selected }
    }
  `),
  )

  for (const fields of ['Pinned: true, Unpinned: false', 'Unpinned: false, Pinned: true']) {
    Test(
      `rejects both aliases even when values agree: ${fields}`,
      rejects(
        `
      ${declaration}
      action Change(Note) { update Note { ${fields} } }
    `,
        dataWriteValidationMessages.duplicateWriteField('Pinned'),
      ),
    )
  }

  Test(
    'keeps the stored Boolean type requirement for an inverse label',
    rejects(
      `
    ${declaration}
    action Change(Note) { update Note { Unpinned: "wrong" } }
  `,
      dataWriteValidationMessages.fieldType('Pinned', 'boolean', 'text'),
    ),
  )
})
