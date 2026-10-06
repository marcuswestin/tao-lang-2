import TR from '@runtime/TR'
import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import type { GroupedRowsModule } from './syntax2-app-contracts'
import { syntax2Library } from './syntax2-app-runtime'

// Load the unchanged authored module through the isolated runtime fixture.
const { GroupedRows }: GroupedRowsModule = await import(FS.resolvePath('GroupedRows.ts', syntax2Library))

Describe('Syntax2 grouped row projection', () => {
  Test('groups live handles by author identity and keeps book keys across regrouping', async () => {
    const schema = TR.Data.Schema({
      name: 'GroupedRowsProof',
      schemaVersion: 1,
      entities: {
        Person: { collection: 'People', fields: { Name: { kind: 'text' } } },
        Book: {
          collection: 'Books',
          fields: { Author: { kind: 'relation', relation: 'Person', optional: true } },
        },
      },
    }, { load: () => undefined, save: () => {} })
    await schema.settle()
    TR.Data.Create(schema, 'Person', { Name: TR.Value('Ada') })
    TR.Data.Create(schema, 'Person', { Name: TR.Value('Ada') })
    const people = schema.query({ entity: 'Person', filters: [] })
    TR.Data.Create(schema, 'Book', { Author: TR.Value(people[0]) })
    TR.Data.Create(schema, 'Book', { Author: TR.Value(people[1]) })
    TR.Data.Create(schema, 'Book', { Author: TR.Value(people[0]) })
    TR.Data.Create(schema, 'Book', {})
    const books = schema.query({ entity: 'Book', filters: [] })
    // These authenticated builder callbacks stand in for checked Tao functions; no UI is built here.
    const row = (key: TR.Evaluable, content: TR.Evaluable) =>
      TR.Value({
        RowKey: key.evaluate().jsValue,
        Content: TR.Capability.attach(content, {}),
      })
    const builders = TR.Capability.attach(TR.Value(true), {
      Header: TR.Function((_receiver: TR.Evaluable, key: TR.Evaluable, label: TR.Evaluable) => row(key, label)),
      BookRow: TR.Function((_receiver: TR.Evaluable, key: TR.Evaluable, book: TR.Evaluable) => row(key, book)),
    })
    const project = () => GroupedRows(books, builders)
    const first = project()
    Expect(first.map(entry => entry.Content.getJSValue())).toEqual([
      'Ada',
      books[0],
      books[2],
      'Ada',
      books[1],
      'Unknown author',
      books[3],
    ])
    Expect(new Set(first.map(entry => entry.RowKey)).size).toBe(first.length)
    const reversed = GroupedRows([books[1], books[0], books[2], books[3]], builders)
    Expect(reversed.map(entry => entry.RowKey)).toEqual([
      first[3]!.RowKey,
      first[4]!.RowKey,
      first[0]!.RowKey,
      first[1]!.RowKey,
      first[2]!.RowKey,
      first[5]!.RowKey,
      first[6]!.RowKey,
    ])
    // Projection preserves occurrences; LazyList owns duplicate-key rejection.
    const duplicate = GroupedRows([books[0], books[0]], builders)
    Expect(duplicate).toHaveLength(3)
    Expect(duplicate[1]!.RowKey).toBe(duplicate[2]!.RowKey)
    Expect(duplicate[1]!.Content.getJSValue()).toBe(books[0])
    Expect(duplicate[2]!.Content.getJSValue()).toBe(books[0])
    const firstBookKey = first[1]!.RowKey
    const originalHeaderKey = first[0]!.RowKey
    TR.Data.Update(TR.Value(people[0]), { Name: TR.Value('Augusta') })
    const renamed = project()
    Expect(renamed[0]!.Content.getJSValue()).toBe('Augusta')
    Expect(renamed[0]!.RowKey).toBe(originalHeaderKey)
    TR.Data.Update(TR.Value(books[0]), { Author: TR.Value(people[1]) })
    const regrouped = project()
    const moved = regrouped.find(entry => entry.Content.getJSValue() === books[0])!
    Expect(moved.RowKey).toBe(firstBookKey)
    Expect(moved.Content.getJSValue()).toBe(books[0])
    Expect(regrouped.map(entry => entry.Content.getJSValue())).toEqual([
      'Ada',
      books[0],
      books[1],
      'Augusta',
      books[2],
      'Unknown author',
      books[3],
    ])
  })
})
