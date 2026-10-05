import TR from '@tao/runtime'

type LivePerson = Readonly<{ Name: string }>
type LiveBook = Readonly<{ Author?: LivePerson | null }>
type Row = Readonly<{ RowKey: string; Content: TR.Capability }>

/** Cached field reads register dependencies; the rows retain original live book handles. */
export function GroupedRows(items: readonly LiveBook[], builders: TR.Capability): readonly Row[] {
  const groups = new Map<string, { label: string; books: { id: string; book: LiveBook }[] }>()
  for (const book of items) {
    const bookID = TR.Data.NativeEntityContext(book).id
    const author = book.Author
    const authorID = author ? TR.Data.NativeEntityContext(author).id : null
    const key = JSON.stringify(['author', authorID])
    let group = groups.get(key)
    if (!group) {
      group = { label: author ? author.Name : 'Unknown author', books: [] }
      groups.set(key, group)
    }
    group.books.push({ id: bookID, book })
  }
  const rows: Row[] = []
  for (const [key, group] of groups) {
    rows.push(
      TR.Call(
        TR.Capability.method(builders, 'Header'),
        TR.Value(JSON.stringify(['header', key])),
        TR.Value(group.label),
      ).evaluate().jsValue as Row,
    )
    for (const { id, book } of group.books) {
      rows.push(
        TR.Call(
          TR.Capability.method(builders, 'BookRow'),
          TR.Value(JSON.stringify(['book', id])),
          TR.Value(book),
        ).evaluate().jsValue as Row,
      )
    }
  }
  return rows
}
