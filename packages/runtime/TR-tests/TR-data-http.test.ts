import TR from '@runtime/TR'
import { Describe, Expect, Test } from '@shared/test'
import type { TaoFillOps } from '../TaoRuntime-src/TR-data'

function collectingOps(): { ops: TaoFillOps; upserts: Array<{ entity: string; rows: readonly unknown[] }> } {
  const upserts: Array<{ entity: string; rows: readonly unknown[] }> = []
  return { ops: { upsert: (entity, rows) => upserts.push({ entity, rows }) }, upserts }
}

function configuredHttp(adapter: TR.HttpAdapter, cacheForNs?: number): TR.DataProvider {
  const provider = TR.DataProvider.Http()
  return provider.withConfiguration!({
    Adapter: TR.Value(adapter),
    ...(cacheForNs !== undefined ? { CacheFor: TR.Value(cacheForNs) } : {}),
  })
}

Describe('TR.DataProvider.Http', () => {
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
    const provider = configuredHttp(adapter)
    const { ops, upserts } = collectingOps()

    await provider.fill!({ descriptor: { entity: 'Story', limit: 30, orderBy: 'Rank', where: {} } }, ops)

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
    const provider = configuredHttp(adapter)
    const { ops } = collectingOps()

    await provider.fill!(
      { descriptor: { entity: 'Comment', orderBy: 'Ordering', where: { Story: { HnId: 7 } } } },
      ops,
    )
    Expect(filled).toEqual(['by-story'])

    await Expect(
      provider.fill!({ descriptor: { entity: 'Comment', where: {} } }, ops),
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
    const provider = configuredHttp(adapter)
    const { ops } = collectingOps()

    await provider.fill!(
      { descriptor: { entity: 'Story', orderBy: 'Rank', orderDirection: 'desc', where: {} } },
      ops,
    )
    await provider.fill!(
      { descriptor: { entity: 'Story', orderBy: 'Rank', orderDirection: 'asc', where: {} } },
      ops,
    )
    Expect(filled).toEqual(['descending', 'any-direction'])
  })

  Test('fails loudly for an entity with no declared shapes and for a missing adapter', async () => {
    const { ops } = collectingOps()
    await Expect(
      configuredHttp(TR.Http.adapter({})).fill!({ descriptor: { entity: 'Story', where: {} } }, ops),
    ).rejects.toThrow("declares no shapes for 'Story' at all")

    const unconfigured = TR.DataProvider.Http()
    await Expect(
      unconfigured.fill!({ descriptor: { entity: 'Story', where: {} } }, ops),
    ).rejects.toThrow("requires an 'Adapter'")
  })

  Test('converts the CacheFor duration from nanoseconds to the fill cache window', () => {
    const fiveMinutesNs = 5 * 60 * 1e9
    Expect(configuredHttp(TR.Http.adapter({}), fiveMinutesNs).fillCacheMs).toBe(5 * 60 * 1000)
    Expect(configuredHttp(TR.Http.adapter({})).fillCacheMs).toBe(0)
  })
})
