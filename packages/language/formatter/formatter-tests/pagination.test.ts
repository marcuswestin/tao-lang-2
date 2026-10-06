import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: query pagination', () => {
  Test(
    'formats paginate with one space and keeps it as its own query clause',
    formats(
      'view Home(){query Documents=Documents with{order by Title paginate    40}} data Documents/Document{Title text}',
      `
      view Home() {
         query Documents = Documents with {
            order by Title
            paginate 40
      }  }

      data Documents / Document {
         Title text
      }
    `,
    ),
  )
})
