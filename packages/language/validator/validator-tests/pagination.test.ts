import { Describe, stubContainer, stubView, Test } from '@shared/test'
import { dataValidationMessages } from '../validator-src/validators/data-validator'
import { accepts, app, rejects } from './test-validate'

Describe('validator: query pagination', () => {
  Test('accepts a page size of 40', accepts(queryApp('paginate 40')))

  Test('accepts pagination ordered by the existing entity identity', accepts(queryApp('order by Id asc, paginate 40')))

  Test('accepts safe page sizes above the app backend bound', accepts(queryApp('paginate 41')))

  Test('rejects invalid page sizes', async () => {
    for (const pageSize of ['0', '1.5', '9007199254740992']) {
      await rejects(queryApp(`paginate ${pageSize}`), dataValidationMessages.paginationPageSize)()
    }
  })

  Test(
    'rejects duplicate paginate clauses',
    rejects(
      queryApp('paginate 40 paginate 20'),
      dataValidationMessages.duplicatePagination,
    ),
  )

  Test(
    'rejects mixing limit and paginate',
    rejects(
      queryApp('limit 40 paginate 20'),
      dataValidationMessages.paginationWithLimit,
    ),
  )

  Test('keeps a query limit valid on its own', accepts(queryApp('limit 40')))
})

function queryApp(clauses: string): string {
  return app(
    `render Col() { query Documents = Documents with { ${clauses} } }`,
    `data Documents / Document { Title text }${stubContainer('Col')}${stubView('Text', 'Value text')}`,
  )
}
