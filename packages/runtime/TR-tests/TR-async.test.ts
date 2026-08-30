import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoDataConnection, TaoDataSchemaDefinition } from '../TaoRuntime-src/TR-data'
import { onUnownedFailure } from '../TaoRuntime-src/TR-errors'

const noteDefinition: TaoDataSchemaDefinition = {
  name: 'AsyncNotes',
  entities: {
    Note: {
      collection: 'Notes',
      fields: {
        Title: { kind: 'text' },
      },
    },
  },
}

Describe('TR.Async', () => {
  Test('starts work immediately and lets following work continue before completion', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })

    TR.Async(async () => {
      order.push('launched')
      await gate
      order.push('completed')
    })
    order.push('following')

    Expect(order).toEqual(['launched', 'following'])
    release()
    await gate
    await Promise.resolve()
    Expect(order).toEqual(['launched', 'following', 'completed'])
  })

  Test('reports a rejected block instead of discarding it', async () => {
    const reported: unknown[] = []
    const stop = onUnownedFailure(error => reported.push(error))
    const failure = new Error('async block failed')

    TR.Async(async () => {
      throw failure
    })
    await settleDetachedWork()
    stop()

    Expect(reported).toEqual([failure])
  })

  Test('reports a synchronous throw the same way as a rejection', async () => {
    const reported: unknown[] = []
    const stop = onUnownedFailure(error => reported.push(error))
    const failure = new Error('async block threw')

    TR.Async(() => {
      throw failure
    })
    await settleDetachedWork()
    stop()

    Expect(reported).toEqual([failure])
  })

  Test('leaves failed provider writes observable through query error state', async () => {
    const provider: TaoDataConnection = {
      load: () => undefined,
      save: async () => {
        throw new Error('disk unavailable')
      },
    }
    const schema = TR.Data.Schema(noteDefinition, provider)

    TR.Async(async () => {
      TR.Data.Create(schema, 'Note', { Title: TR.Value('Draft') })
      await TR.Data.Settle(schema)
    })
    await TR.Data.Settle(schema)

    const notes = schema.query({ entity: 'Note', filters: [] }) as unknown[] & { Error: string }
    Expect(notes).toHaveLength(1)
    Expect(notes.Error).toContain('Could not save data: disk unavailable')
  })
})

async function settleDetachedWork(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
