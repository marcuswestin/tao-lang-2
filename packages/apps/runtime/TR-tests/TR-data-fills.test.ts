import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type {
  TaoDataConnection,
  TaoDataSchemaDefinition,
  TaoFillOps,
  TaoFillRequest,
} from '../TaoRuntime-src/TR-data'
import { testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { HostEnvironmentError, onUnownedFailure } from '../TaoRuntime-src/TR-errors'
import { Clock } from '../TaoRuntime-src/TR-units'

const feedDefinition: TaoDataSchemaDefinition = {
  name: 'RuntimeFeed',
  schemaVersion: 1,
  entities: {
    Story: {
      collection: 'Stories',
      fields: {
        HnId: { kind: 'number', unique: true },
        Title: { kind: 'text' },
        Rank: { kind: 'number' },
      },
      inverseFields: {
        Comments: { inverseField: 'Story', relation: 'Comment' },
      },
    },
    Comment: {
      collection: 'Comments',
      fields: {
        Story: { kind: 'relation', relation: 'Story' },
        HnId: { kind: 'number', unique: true },
        Text: { kind: 'text' },
      },
    },
  },
}

type QueryRows = unknown[] & { Loading: boolean; Error: string; Refreshing: boolean; Stale: boolean }

function fillConnection(
  fill: (request: TaoFillRequest, ops: TaoFillOps) => Promise<void>,
  fillCacheMs?: number,
): TaoDataConnection {
  return { ...testDataConnection(), fill, ...(fillCacheMs !== undefined ? { fillCacheMs } : {}) }
}

function storiesPlan(limit?: number): Parameters<TR.DataSchema['query']>[0] {
  return {
    entity: 'Story',
    filters: [],
    ...(limit !== undefined ? { limit } : {}),
    order: { direction: 'asc', field: 'Rank' },
  }
}

Describe('TR.Data query fills', () => {
  Test('fills an activated query and upserts rows by the unique field', async () => {
    let fetchedTitle = 'Original'
    const connection = fillConnection(async (_request, ops) => {
      ops.upsert('Story', [
        { HnId: 1, Title: fetchedTitle, Rank: 1 },
        { HnId: 2, Title: 'Second', Rank: 2 },
      ])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()

    schema.activateQuery(storiesPlan())
    await schema.settle()
    Expect(schema.query(storiesPlan())).toHaveLength(2)

    fetchedTitle = 'Updated'
    schema.activateQuery(storiesPlan())
    await schema.settle()

    const rows = schema.query(storiesPlan()) as QueryRows
    Expect(rows).toHaveLength(2)
    Expect(schema.read(rows[0] as never, 'Title')).toBe('Updated')
  })

  Test('applies a query limit after ordering', async () => {
    const connection = fillConnection(async (_request, ops) => {
      ops.upsert('Story', [
        { HnId: 3, Title: 'Third', Rank: 3 },
        { HnId: 1, Title: 'First', Rank: 1 },
        { HnId: 2, Title: 'Second', Rank: 2 },
      ])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan(2))
    await schema.settle()

    const rows = schema.query(storiesPlan(2)) as QueryRows
    Expect(rows).toHaveLength(2)
    Expect(schema.read(rows[0] as never, 'Rank')).toBe(1)
    Expect(schema.read(rows[1] as never, 'Rank')).toBe(2)
  })

  Test('reports loading while a first fill has nothing to show, then ready', async () => {
    const gate = Deferred<void>()
    const connection = fillConnection(async (_request, ops) => {
      await gate.promise
      ops.upsert('Story', [{ HnId: 1, Title: 'First', Rank: 1 }])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()

    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    const filling = schema.query(storiesPlan()) as QueryRows
    Expect(filling.Loading).toBe(true)
    Expect(filling.Refreshing).toBe(false)

    gate.resolve()
    await schema.settle()
    const ready = schema.query(storiesPlan()) as QueryRows
    Expect(ready.Loading).toBe(false)
    Expect(ready).toHaveLength(1)
  })

  Test('reports refreshing over cached rows, and stale when the refill fails', async () => {
    let outcome: 'succeed' | 'fail' | 'wait' = 'succeed'
    let gate = Deferred<void>()
    const connection = fillConnection(async (_request, ops) => {
      if (outcome === 'wait') {
        await gate.promise
      }
      if (outcome === 'fail') {
        throw new HostEnvironmentError('Hacker News is unreachable')
      }
      ops.upsert('Story', [{ HnId: 1, Title: 'First', Rank: 1 }])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()

    outcome = 'wait'
    gate = Deferred<void>()
    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    const refreshing = schema.query(storiesPlan()) as QueryRows
    Expect(refreshing.Refreshing).toBe(true)
    Expect(refreshing.Loading).toBe(false)
    Expect(refreshing).toHaveLength(1)
    gate.resolve()
    await schema.settle()

    outcome = 'fail'
    schema.activateQuery(storiesPlan())
    await schema.settle()
    const stale = schema.query(storiesPlan()) as QueryRows
    Expect(stale.Stale).toBe(true)
    Expect(stale.Error).toBe('')
    Expect(stale).toHaveLength(1)
  })

  Test('surfaces a failed first fill as the query error with nothing to show', async () => {
    const connection = fillConnection(async () => {
      throw new HostEnvironmentError('Hacker News is unreachable')
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()

    const rows = schema.query(storiesPlan()) as QueryRows
    Expect(rows.Error).toBe('Hacker News is unreachable')
    Expect(rows.Loading).toBe(false)
    Expect(rows.Stale).toBe(false)
    Expect(rows).toHaveLength(0)
  })

  Test('resolves fill relations by the target unique field and rejects unknown references', async () => {
    const connection = fillConnection(async (request, ops) => {
      if (request.descriptor.entity === 'Story') {
        ops.upsert('Story', [{ HnId: 7, Title: 'Show HN', Rank: 1 }])
        return
      }
      ops.upsert('Comment', [
        { HnId: 71, Story: { HnId: 7 }, Text: 'First comment' },
      ])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()
    const story = schema.query(storiesPlan())[0] as never

    const commentsPlan = {
      entity: 'Comment',
      filters: [{ field: 'Story', operator: '==' as const, value: () => TR.Value(story) }],
    }
    schema.activateQuery(commentsPlan)
    await schema.settle()

    const comments = schema.query(commentsPlan) as QueryRows
    Expect(comments).toHaveLength(1)
    Expect(schema.read(comments[0] as never, 'Text')).toBe('First comment')
    const linked = schema.read(comments[0] as never, 'Story')
    Expect(schema.read(linked as never, 'Title')).toBe('Show HN')

    Expect(() => schema.upsertFromFill('Comment', [{ HnId: 72, Story: { HnId: 99 }, Text: 'Orphan' }]))
      .toThrow("references no stored Story with HnId '99'")
  })

  Test('offers the adapter a descriptor carrying order, limit, and related-row snapshots', async () => {
    const descriptors: TaoFillRequest['descriptor'][] = []
    const connection = fillConnection(async (request, ops) => {
      descriptors.push(request.descriptor)
      if (request.descriptor.entity === 'Story') {
        ops.upsert('Story', [{ HnId: 7, Title: 'Show HN', Rank: 1 }])
      }
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan(30))
    await schema.settle()
    const story = schema.query(storiesPlan(30))[0] as never
    schema.activateQuery({
      entity: 'Comment',
      filters: [{ field: 'Story', operator: '==', value: () => TR.Value(story) }],
    })
    await schema.settle()

    Expect(descriptors[0]).toEqual({
      entity: 'Story',
      limit: 30,
      orderBy: 'Rank',
      orderDirection: 'asc',
      where: {},
    })
    Expect(descriptors[1]!.entity).toBe('Comment')
    const storyRef = descriptors[1]!.where['Story'] as Record<string, unknown>
    Expect(storyRef['HnId']).toBe(7)
    Expect(storyRef['Title']).toBe('Show HN')
  })

  Test('deduplicates concurrent activations and honors the fill cache window', async () => {
    Clock.beginTest()
    try {
      let fillCount = 0
      const connection = fillConnection(async (_request, ops) => {
        fillCount += 1
        ops.upsert('Story', [{ HnId: 1, Title: 'First', Rank: 1 }])
      }, 5000)
      const schema = TR.Data.Schema(feedDefinition, connection)
      await schema.settle()

      schema.activateQuery(storiesPlan())
      schema.activateQuery(storiesPlan())
      await schema.settle()
      Expect(fillCount).toBe(1)

      schema.activateQuery(storiesPlan())
      await schema.settle()
      Expect(fillCount).toBe(1)

      Clock.advance(6000)
      schema.activateQuery(storiesPlan())
      await schema.settle()
      Expect(fillCount).toBe(2)
    } finally {
      Clock.endTest()
    }
  })

  Test('bridges fill state to the language subject cases a render site matches', async () => {
    let outcome: 'succeed' | 'fail' | 'wait' = 'succeed'
    let gate = Deferred<void>()
    const connection = fillConnection(async (_request, ops) => {
      if (outcome === 'wait') {
        await gate.promise
      }
      if (outcome === 'fail') {
        throw new HostEnvironmentError('unreachable')
      }
      ops.upsert('Story', [{ HnId: 1, Title: 'First', Rank: 1 }])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    // TR.IsCase is what `Query is refreshing` compiles to, so this crosses the same bridge a
    // render site does.
    const cases = (rows: unknown) => ({
      loading: TR.IsCase(TR.Value(rows), 'loading').jsValue,
      refreshing: TR.IsCase(TR.Value(rows), 'refreshing').jsValue,
      stale: TR.IsCase(TR.Value(rows), 'stale').jsValue,
      error: TR.IsCase(TR.Value(rows), 'error').jsValue,
    })

    outcome = 'wait'
    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    Expect(cases(schema.query(storiesPlan()))).toEqual({
      loading: true,
      refreshing: false,
      stale: false,
      error: false,
    })
    gate.resolve()
    outcome = 'succeed'
    await schema.settle()

    outcome = 'wait'
    gate = Deferred<void>()
    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    Expect(cases(schema.query(storiesPlan()))).toEqual({
      loading: false,
      refreshing: true,
      stale: false,
      error: false,
    })
    gate.resolve()
    await schema.settle()

    outcome = 'fail'
    schema.activateQuery(storiesPlan())
    await schema.settle()
    Expect(cases(schema.query(storiesPlan()))).toEqual({
      loading: false,
      refreshing: false,
      stale: true,
      error: false,
    })
  })

  Test('treats a descriptor that filled empty as content, not a second spinner', async () => {
    let gate = Deferred<void>()
    const connection = fillConnection(async () => {
      await gate.promise
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()

    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    Expect((schema.query(storiesPlan()) as QueryRows).Loading).toBe(true)
    gate.resolve()
    await schema.settle()

    gate = Deferred<void>()
    schema.activateQuery(storiesPlan())
    await Promise.resolve()
    const refilling = schema.query(storiesPlan()) as QueryRows
    Expect(refilling.Loading).toBe(false)
    Expect(refilling.Refreshing).toBe(true)
    gate.resolve()
    await schema.settle()
  })

  Test('routes a filter that throws during activation to the unowned-failure seam', async () => {
    const connection = fillConnection(async (_request, ops) => {
      ops.upsert('Story', [{ HnId: 1, Title: 'First', Rank: 1 }])
    })
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()
    const story = schema.query(storiesPlan())[0] as never

    // A relation filter whose target is deleted between render and the activation microtask throws
    // while the descriptor is still being built, so there is no descriptor to fail. It must reach
    // the runtime's unowned-failure seam rather than becoming an unhandled promise rejection.
    const failures: unknown[] = []
    const stopObserving = onUnownedFailure(error => failures.push(error))
    try {
      const commentsPlan = {
        entity: 'Comment',
        filters: [{ field: 'Story', operator: '==' as const, value: () => TR.Value(story) }],
      }
      schema.delete(story)
      schema.activateQuery(commentsPlan)
      await schema.settle()
    } finally {
      stopObserving()
    }

    Expect(failures).toHaveLength(1)
    Expect(String(failures[0])).toContain('refers to missing Story')
  })

  Test('rejects fill rows that break the entity contract', async () => {
    const schema = TR.Data.Schema(feedDefinition, fillConnection(async () => {}))
    await schema.settle()

    Expect(() => schema.upsertFromFill('Story', [{ Title: 'No key', Rank: 1 }]))
      .toThrow("missing unique field 'HnId'")
    Expect(() => schema.upsertFromFill('Story', [{ HnId: 1, Nope: 'x' }]))
      .toThrow("has no fillable field 'Nope'")
    Expect(() => schema.upsertFromFill('Story', [{ HnId: 1, Title: 5, Rank: 1 }]))
      .toThrow('expects text, got number')
    Expect(() => schema.upsertFromFill('Story', [{ HnId: 1, Rank: 1 }]))
      .toThrow("missing required field 'Title'")
    Expect(() => schema.upsertFromFill('Comment', [{ HnId: 1, Story: 'Story-1', Text: 'x', Ordering: 1, Depth: 0 }]))
      .toThrow('expects an object naming the Story unique field')
  })

  Test('keys fills by sort direction, so opposite bounded feeds fill separately', async () => {
    const connection = fillConnection(async () => {})
    const schema = TR.Data.Schema(feedDefinition, connection)
    await schema.settle()

    const ascending = schema.queryActivationKey({
      entity: 'Story',
      filters: [],
      limit: 10,
      order: { direction: 'asc', field: 'Rank' },
    })
    const descending = schema.queryActivationKey({
      entity: 'Story',
      filters: [],
      limit: 10,
      order: { direction: 'desc', field: 'Rank' },
    })
    Expect(ascending).not.toBe(descending)
  })

  Test('rebinds on a configuration change and keeps the store on an identical rebind', async () => {
    // A fill-capable provider reading its adapter from configuration, the way the stdlib Http
    // package does — the rebind semantics under test live entirely in the runtime.
    const feedProvider: TR.DataProvider = {
      connect: context => {
        const rows = context.configuration['FillRows'] as ReadonlyArray<Record<string, unknown>>
        return fillConnection(async (_request, ops) => {
          ops.upsert('Story', rows)
        })
      },
      fills: true,
    }
    const declaration = TR.Data.Declaration('Feed', feedProvider)
    const firstRows = [{ HnId: 1, Title: 'From the first adapter', Rank: 1 }]
    const secondRows = [{ HnId: 2, Title: 'From the second adapter', Rank: 1 }]
    const schema = TR.Data.Schema(feedDefinition, testDataConnection())

    schema.bindConfigured(TR.Data.Configure(declaration, { FillRows: TR.Value(firstRows) }))
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()
    Expect(schema.query(storiesPlan())).toHaveLength(1)

    schema.bindConfigured(TR.Data.Configure(declaration, { FillRows: TR.Value(firstRows) }))
    await schema.settle()
    Expect(schema.query(storiesPlan())).toHaveLength(1)

    schema.bindConfigured(TR.Data.Configure(declaration, { FillRows: TR.Value(secondRows) }))
    await schema.settle()
    schema.activateQuery(storiesPlan())
    await schema.settle()
    const rows = schema.query(storiesPlan()) as QueryRows
    Expect(rows).toHaveLength(1)
    Expect(schema.read(rows[0] as never, 'Title')).toBe('From the second adapter')
  })

  Test('keeps fills out of snapshot-only connections and their queries', async () => {
    const schema = TR.Data.Schema(feedDefinition, testDataConnection())
    await schema.settle()

    Expect(schema.queryActivationKey(storiesPlan())).toBeUndefined()
    const release = schema.activateQuery(storiesPlan())
    release()
    await schema.settle()

    const rows = schema.query(storiesPlan()) as QueryRows
    Expect(rows.Refreshing).toBe(false)
    Expect(rows.Stale).toBe(false)
  })
})
