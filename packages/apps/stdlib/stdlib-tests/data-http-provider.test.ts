import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import { HttpProvider } from '../@tao/data/providers/http/Http'

function collectingOps(): {
  ops: TR.DataFillOps
  upserts: Array<{ entity: string; rows: readonly unknown[] }>
} {
  const upserts: Array<{ entity: string; rows: readonly unknown[] }> = []
  return { ops: { upsert: (entity, rows) => upserts.push({ entity, rows }) }, upserts }
}

function connectedHttp(adapter?: TR.HttpAdapter, cacheForNs?: number): TR.DataConnection {
  return HttpProvider().connect({
    configuration: {
      ...(adapter !== undefined ? { Adapter: adapter } : {}),
      ...(cacheForNs !== undefined ? { CacheFor: cacheForNs } : {}),
    },
    schema: { entities: {}, name: 'HttpProviderTest' },
    storageKey: 'HttpProviderTest',
  })
}

Describe('@tao/data Http provider', () => {
  Test('routes a descriptor to the matching declared shape with entity-curried upserts', async () => {
    const adapter = TR.Http.adapter({
      Story: [
        TR.Http.on({ orderBy: 'Rank' }, async (query, tools) => {
          tools.upsert([{ HnId: 1, Title: `front page of ${query.limit ?? 'all'}` }])
          tools.upsertInto('Feed', [{ HnId: 9 }])
        }),
        TR.Http.on({ orderBy: 'PostedAt' }, async (_query, tools) => {
          tools.upsert([{ HnId: 2, Title: 'newest' }])
        }),
      ],
    })
    const connection = connectedHttp(adapter)
    const { ops, upserts } = collectingOps()

    await connection.fill!({ descriptor: { entity: 'Story', limit: 30, orderBy: 'Rank', where: {} } }, ops)

    Expect(upserts).toEqual([
      { entity: 'Story', rows: [{ HnId: 1, Title: 'front page of 30' }] },
      { entity: 'Feed', rows: [{ HnId: 9 }] },
    ])
  })

  Test('matches where sets exactly and treats an omitted orderBy as any ordering', async () => {
    const filled: string[] = []
    const adapter = TR.Http.adapter({
      Comment: [
        TR.Http.on({ where: 'Story' }, async () => {
          filled.push('by-story')
        }),
      ],
    })
    const connection = connectedHttp(adapter)
    const { ops } = collectingOps()

    await connection.fill!(
      { descriptor: { entity: 'Comment', orderBy: 'Ordering', where: { Story: { HnId: 7 } } } },
      ops,
    )
    Expect(filled).toEqual(['by-story'])

    await Expect(
      connection.fill!({ descriptor: { entity: 'Comment', where: {} } }, ops),
    ).rejects.toThrow("no query shape matching 'Comment' (no filters, no ordering)")
  })

  Test('matches a stated sort direction exactly and treats an omitted one as any direction', async () => {
    const filled: string[] = []
    const adapter = TR.Http.adapter({
      Story: [
        TR.Http.on({ orderBy: 'Rank', orderDirection: 'desc' }, async () => {
          filled.push('descending')
        }),
        TR.Http.on({ orderBy: 'Rank' }, async () => {
          filled.push('any-direction')
        }),
      ],
    })
    const connection = connectedHttp(adapter)
    const { ops } = collectingOps()

    await connection.fill!(
      { descriptor: { entity: 'Story', orderBy: 'Rank', orderDirection: 'desc', where: {} } },
      ops,
    )
    await connection.fill!(
      { descriptor: { entity: 'Story', orderBy: 'Rank', orderDirection: 'asc', where: {} } },
      ops,
    )
    Expect(filled).toEqual(['descending', 'any-direction'])
  })

  Test('fails loudly for an entity with no declared shapes and for a missing adapter', async () => {
    const { ops } = collectingOps()
    await Expect(
      connectedHttp(TR.Http.adapter({})).fill!({ descriptor: { entity: 'Story', where: {} } }, ops),
    ).rejects.toThrow("declares no shapes for 'Story' at all")

    await Expect(
      connectedHttp().fill!({ descriptor: { entity: 'Story', where: {} } }, ops),
    ).rejects.toThrow("requires an 'Adapter'")
  })

  Test('converts the CacheFor duration from nanoseconds to the fill cache window', () => {
    const fiveMinutesNs = 5 * 60 * 1e9
    Expect(connectedHttp(TR.Http.adapter({}), fiveMinutesNs).fillCacheMs).toBe(5 * 60 * 1000)
    Expect(connectedHttp(TR.Http.adapter({})).fillCacheMs).toBe(0)
  })

  Test('keeps snapshots isolated by storage key and marks the provider fill-capable', async () => {
    const provider = HttpProvider()
    Expect(provider.fills).toBe(true)
    const connect = (storageKey: string): TR.DataConnection =>
      provider.connect({
        configuration: {},
        schema: { entities: {}, name: 'HttpProviderTest' },
        storageKey,
      })
    const first = connect('first')
    const second = connect('second')
    await first.save('{"snapshot":"first"}')
    Expect(await first.load()).toBe('{"snapshot":"first"}')
    Expect(await second.load()).toBeUndefined()
  })
})
