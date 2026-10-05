import TR from '@runtime/TR'
import { captureActionReceiver } from '@runtime/TR-action-receivers'
import { readAvailability, withReadAvailability } from '@runtime/TR-read-availability'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'

const definition: TaoDataSchemaDefinition = {
  name: 'CapturedActionBooks',
  entities: { Book: { collection: 'Books', fields: { Title: { kind: 'text' } } } },
}
const connection = (): TaoDataConnection => ({ load: () => undefined, save: () => {} })

Describe('associated action receiver capture', () => {
  Test('captures one selected wrapper once while its original entity fields stay live', async () => {
    const schema = TR.Data.Schema(definition, connection())
    TR.Data.Create(schema, 'Book', { Title: TR.Value('first') })
    TR.Data.Create(schema, 'Book', { Title: TR.Value('second') })
    const [first, second] = schema.query({ entity: 'Book', filters: [] })
    const firstWrapper = TR.Value(first)
    let selected = firstWrapper
    let reads = 0
    const receiver = captureActionReceiver(
      TR.Alias(() => {
        reads += 1
        return selected
      }),
      'one',
    )
    const seen: unknown[] = []
    const saved = TR.Action(() => {
      seen.push(receiver.evaluate().jsValue)
    })
    selected = TR.Value(second)
    TR.Data.Update(firstWrapper, { Title: TR.Value('updated') })
    await TR.Do(saved)
    await TR.Do(saved)
    Expect(seen).toEqual([first, first])
    Expect(receiver).toBe(firstWrapper)
    Expect(reads).toBe(1)
    Expect(TR.Member(receiver, ['Title']).evaluate().jsValue).toBe('updated')
  })

  Test('snapshots collection membership while preserving original entities and item wrappers', async () => {
    const schema = TR.Data.Schema(definition, connection())
    TR.Data.Create(schema, 'Book', { Title: TR.Value('first') })
    TR.Data.Create(schema, 'Book', { Title: TR.Value('second') })
    const [first, second] = schema.query({ entity: 'Book', filters: [] })
    const wrapped = TR.Value(second)
    let members: unknown[] = [first, wrapped]
    let reads = 0
    const source = TR.Alias(() => {
      reads += 1
      return TR.Value(members)
    })
    const captured = captureActionReceiver(source, 'many')
    const seen: unknown[] = []
    const saved = TR.Action(() => {
      seen.push(...captured.evaluate().jsValue)
    })
    members.push({ Title: 'late' })
    members = [{ Title: 'replacement' }]
    TR.Data.Update(TR.Value(first), { Title: TR.Value('updated') })
    TR.Data.Update(wrapped, { Title: TR.Value('also updated') })
    await TR.Do(saved)
    Expect(reads).toBe(1)
    Expect(seen).toHaveLength(2)
    Expect(seen[0]).toBe(first)
    Expect(seen[1]).toBe(wrapped)
    Expect(captured.evaluate().jsValue[0]).toBe(first)
    Expect(captured.evaluate().jsValue[1]).toBe(wrapped)
    Expect(TR.Member(TR.Value(first), ['Title']).evaluate().jsValue).toBe('updated')
    Expect(TR.Member(wrapped, ['Title']).evaluate().jsValue).toBe('also updated')
  })

  Test('completes legacy evaluated wrappers and retains read availability for both cardinalities', () => {
    const item = { Title: 'legacy' }
    let reads = 0
    const state = { status: 'loading' } as const
    const evaluated = withReadAvailability({
      evaluate() {
        return this
      },
      jsValue: item,
    }, state)
    const one = captureActionReceiver({
      evaluate() {
        reads += 1
        return evaluated
      },
      jsValue: item,
    }, 'one')
    Expect(one.getJSValue()).toEqual(item)
    Expect(one.evaluate()).toBe(one)
    Expect(reads).toBe(1)
    Expect(readAvailability(one)).toBe(state)
    const array = withReadAvailability(TR.Value([evaluated]), state)
    const many = captureActionReceiver(array, 'many')
    Expect(many.jsValue[0]).toBe(evaluated)
    Expect(readAvailability(many)).toBe(state)
  })

  Test('retained entity authority rejects mutation after a provider generation changes during await', async () => {
    const schema = TR.Data.Schema(definition, connection())
    TR.Data.Create(schema, 'Book', { Title: TR.Value('before') })
    const book = schema.query({ entity: 'Book', filters: [] })[0]
    const receiver = captureActionReceiver(TR.Value(book), 'one')
    const entered = Deferred()
    const release = Deferred()
    const saved = TR.Action(async () => {
      entered.resolve()
      await release.promise
      TR.Data.Update(receiver, { Title: TR.Value('after') })
    })
    const pending = TR.DoResult(saved)
    const rejection = Expect(pending).rejects.toThrow(
      "Entity handle 'Book-1' belongs to an inactive provider generation.",
    )
    await entered.promise
    schema.configure(connection())
    release.resolve()
    await rejection
  })
})
