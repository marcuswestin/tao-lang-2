import { AST } from '@parser'
import { Describe, Expect, Test } from '@shared/test'
import { rejectsParser, testParseCode } from './test-parse'

Describe('parser: query pagination', () => {
  Test('parses a numeric page size as its own query clause', async () => {
    const parsed = await testParseCode(`
      data Documents / Document { Title text }
      view Home() { query Documents = Documents with { order by Title paginate 40 } }
    `)
    const query = AST.streamAllContents(parsed.entry.ast).find(AST.isEntityQueryDeclaration)!
    const pagination = query.block!.clauses.find(AST.isPaginationClause)!

    Expect(pagination.pageSize.value).toBe(40)
    Expect(query.block!.clauses.some(AST.isOrderClause)).toBe(true)
  })

  Test('rejects expressions and non-finite or negative values where pagination requires a number literal', async () => {
    for (const pageSize of ['PageSize', '-1', 'NaN', 'Infinity']) {
      await rejectsParser(`
        data Documents / Document { Title text }
        view Home(PageSize number) { query Documents = Documents with { paginate ${pageSize} } }
      `)()
    }
  })

  Test('keeps comma-separated query clauses distinct from render and expression boundaries', async () => {
    const parsed = await testParseCode(`
      data Documents / Document { Title text }
      view Home { query Documents = Documents with { order by Title asc, paginate 40, } }
    `)
    const query = AST.streamAllContents(parsed.entry.ast).find(AST.isEntityQueryDeclaration)!
    Expect(query.block!.clauses.map(clause => clause.$type)).toEqual(['OrderClause', 'PaginationClause'])
  })
})
