import TR from '@runtime/TR'
import { Deferred, Describe, Expect, Test } from '@shared/test'
import type {
  TaoDataConnection,
  TaoDataSchemaDefinition,
  TaoFillOps,
  TaoFillRequest,
  TaoQueryFilter,
} from '../TaoRuntime-src/TR-data'
import { memoryDataProvider, testDataConnection } from '../TaoRuntime-src/TR-data-provider'
import { HostEnvironmentError, UserInputError } from '../TaoRuntime-src/TR-errors'

/**
 * Two stores, the way an app with two datasources mounts them: stories come from one, bookmarks are
 * kept in the other, and a bookmark names its story across the boundary. The two schemas share
 * nothing, so every assertion here is about the reference rather than about rows that happen to sit
 * together.
 */
const storiesDefinition: TaoDataSchemaDefinition = {
  name: 'Stories',
  schemaVersion: 1,
  entities: {
    Story: {
      collection: 'Stories',
      fields: {
        HnId: { kind: 'number', unique: true },
        Title: { kind: 'text' },
      },
    },
  },
}

const bookmarksDefinition: TaoDataSchemaDefinition = {
  name: 'Bookmarks',
  schemaVersion: 1,
  entities: {
    Bookmark: {
      collection: 'Bookmarks',
      fields: {
        Story: { kind: 'reference', referenceField: 'HnId', relation: 'Story', store: 'Stories' },
        Note: { kind: 'text', defaultValue: '' },
      },
    },
  },
}

Describe('TR.Data references across stores', () => {
  Test('stores a reference as the target unique value and reads it back as the live row', async () => {
    const { bookmarks, stories } = await linkedStores()
    const story = await createStory(stories, 101, 'Show HN')
    const bookmark = await createBookmark(bookmarks, story, 'read later')

    // The handle comes back from the store that owns Story, not from the one holding the bookmark.
    const referenced = TR.Data.Read(bookmark, 'Story')
    Expect(TR.Data.Read(referenced, 'Title')).toBe('Show HN')
    Expect(referenced).toBe(story)
    Expect(TR.Data.EntityAvailability(referenced)).toEqual({ status: 'available' })
    // The bookmark's own snapshot carries only the unique value.
    Expect(bookmarks.captureSnapshot()).toContain('"Story":101')
  })

  Test('reads a reference whose target is gone as a missing handle a guard can see', async () => {
    const { bookmarks, stories } = await linkedStores()
    const story = await createStory(stories, 202, 'Gone')
    const bookmark = await createBookmark(bookmarks, story, 'kept')

    TR.Data.Delete(TR.Value(story))
    await TR.Data.Settle(stories)

    const dangling = TR.Data.Read(bookmark, 'Story')
    Expect(dangling).toBeDefined()
    Expect(TR.Data.EntityAvailability(dangling)).toEqual({ status: 'missing' })
    // The placeholder is stable, so a re-render reads the same handle rather than a new one.
    Expect(TR.Data.Read(bookmark, 'Story')).toBe(dangling)
    // Deleting one side never reaches the other: the bookmark is still here, still naming story 202.
    Expect(TR.Data.Read(bookmark, 'Note')).toBe('kept')
  })

  Test('fetches a referenced row the feed has not served, loading until it lands', async () => {
    const release = Deferred<void>()
    const requests: TaoFillRequest[] = []
    const stories = TR.Data.Schema(
      storiesDefinition,
      fillConnection(async (request, ops) => {
        requests.push(request)
        await release.promise
        ops.upsert('Story', [{ HnId: 303, Title: 'Fetched cold' }])
      }),
    )
    const bookmarks = await memoryStore(bookmarksDefinition)
    TR.Data.LinkStores([stories, bookmarks])
    await TR.Data.Settle(stories)
    const bookmark = await storedBookmark(bookmarks, 303)

    const pending = TR.Data.Read(bookmark, 'Story')
    await flushMicrotasks()
    Expect(TR.Data.EntityAvailability(pending)).toEqual({ status: 'loading' })
    // The one-row query a live query would make, offered once however often the reference is read.
    TR.Data.Read(bookmark, 'Story')
    await flushMicrotasks()
    Expect(requests.map(request => request.descriptor)).toEqual([
      { entity: 'Story', limit: 1, where: { HnId: 303 } },
    ])

    release.resolve()
    await TR.Data.Settle(stories)
    const landed = TR.Data.Read(bookmark, 'Story')
    Expect(TR.Data.Read(landed, 'Title')).toBe('Fetched cold')
    Expect(TR.Data.EntityAvailability(landed)).toEqual({ status: 'available' })
  })

  Test('reports a failed cold fetch as an error on the reference', async () => {
    const stories = TR.Data.Schema(
      storiesDefinition,
      fillConnection(async () => {
        throw new HostEnvironmentError('feed unreachable')
      }),
    )
    const bookmarks = await memoryStore(bookmarksDefinition)
    TR.Data.LinkStores([stories, bookmarks])
    await TR.Data.Settle(stories)
    const bookmark = await storedBookmark(bookmarks, 404)

    const failing = TR.Data.Read(bookmark, 'Story')
    await flushMicrotasks()
    await TR.Data.Settle(stories)

    Expect(TR.Data.EntityAvailability(failing)).toEqual({ message: 'feed unreachable', status: 'error' })
  })

  Test('gives cold references in different entities independent placeholder and fill identities', async () => {
    const requests: TaoFillRequest[] = []
    const schema = TR.Data.Schema(
      {
        name: 'IndependentColdReferences',
        schemaVersion: 1,
        entities: {
          Author: { collection: 'Authors', fields: { ExternalId: { kind: 'number', unique: true } } },
          Story: { collection: 'Stories', fields: { ExternalId: { kind: 'number', unique: true } } },
        },
      },
      fillConnection(async request => {
        requests.push(request)
      }),
    )
    await schema.settle()

    const author = schema.referencedHandle('Author', 'ExternalId', 42)
    const story = schema.referencedHandle('Story', 'ExternalId', 42)
    await schema.settle()

    Expect(author).not.toBe(story)
    Expect(requests.map(request => request.descriptor)).toEqual([
      { entity: 'Author', limit: 1, where: { ExternalId: 42 } },
      { entity: 'Story', limit: 1, where: { ExternalId: 42 } },
    ])
  })

  Test('clears a reference to none', async () => {
    const { bookmarks, stories } = await linkedStores()
    const story = await createStory(stories, 505, 'Cleared')
    const bookmark = await createBookmark(bookmarks, story, '')

    TR.Data.Update(TR.Value(bookmark), { Story: TR.Value(null) })
    await TR.Data.Settle(bookmarks)

    Expect(TR.Data.Read(bookmark, 'Story')).toBeUndefined()
    Expect(bookmarks.captureSnapshot()).toContain('"Story":null')
  })

  Test('resolves only among the stores its own project links', async () => {
    // Another project mounted first, holding a store of the same name and the same row, so a lookup
    // across every schema in the process would find its row before ours.
    const otherStories = await memoryStore(storiesDefinition)
    TR.Data.LinkStores([otherStories])
    TR.Data.Create(otherStories, 'Story', { HnId: TR.Value(606), Title: TR.Value('Theirs') })
    await TR.Data.Settle(otherStories)
    const { bookmarks, stories } = await linkedStores()
    const story = await createStory(stories, 606, 'Ours')
    const bookmark = await createBookmark(bookmarks, story, '')

    Expect(TR.Data.Read(TR.Data.Read(bookmark, 'Story'), 'Title')).toBe('Ours')
  })

  Test('filters a query by a reference using the value it stores', async () => {
    const { bookmarks, stories } = await linkedStores()
    const kept = await createStory(stories, 701, 'Kept')
    const other = await createStory(stories, 702, 'Other')
    await createBookmark(bookmarks, kept, 'one')
    await createBookmark(bookmarks, other, 'two')

    const matches = rows(bookmarks, 'Bookmark', [{ field: 'Story', operator: '==', value: () => TR.Value(kept) }])

    Expect(matches.map(match => TR.Data.Read(match, 'Note'))).toEqual(['one'])
  })

  Test('refuses a reference written from the wrong entity', async () => {
    const { bookmarks, stories } = await linkedStores()
    const bookmark = await createBookmark(bookmarks, await createStory(stories, 801, 'First'), '')

    Expect(() => TR.Data.Update(TR.Value(bookmark), { Story: TR.Value(bookmark) })).toThrow(UserInputError)
  })

  Test('defaults a store storage key to the bound datasource name, keeping an explicit key first', async () => {
    const provider = memoryDataProvider()
    const declaration = TR.Data.Declaration('Memory', provider)
    const stories = TR.Data.Schema(storiesDefinition)
    TR.Data.BindConfigured(stories, TR.Data.Configure(declaration, {}), 'Feed')
    await TR.Data.Settle(stories)
    TR.Data.Create(stories, 'Story', { HnId: TR.Value(1), Title: TR.Value('Named') })
    await TR.Data.Settle(stories)

    // The rows live under the datasource's own name, not the store's collection-derived name.
    Expect(await providerConnection(provider, 'Feed').load()).toContain('Named')
    Expect(await providerConnection(provider, 'Stories').load()).toBeUndefined()

    TR.Data.BindConfigured(stories, TR.Data.Configure(declaration, { StorageKey: TR.Value('explicit') }), 'Feed')
    await TR.Data.Settle(stories)
    Expect(stories.captureIdentity()).toContain('"explicit"')
  })

  Test('rejects a reference definition that tries to cascade across the boundary', () => {
    Expect(() =>
      TR.Data.Schema({
        name: 'ReferenceCascade',
        schemaVersion: 1,
        entities: {
          Bookmark: {
            collection: 'Bookmarks',
            fields: {
              Story: { kind: 'reference', onDelete: 'cascade', referenceField: 'HnId', relation: 'Story' },
            },
          },
        },
      })
    ).toThrow(UserInputError)
  })
})

/** linkedStores mounts the pair on separate stores and links them, as one compiled project does. */
async function linkedStores(): Promise<{ bookmarks: TR.DataSchema; stories: TR.DataSchema }> {
  const stories = await memoryStore(storiesDefinition)
  const bookmarks = await memoryStore(bookmarksDefinition)
  TR.Data.LinkStores([stories, bookmarks])
  return { bookmarks, stories }
}

async function memoryStore(definition: TaoDataSchemaDefinition): Promise<TR.DataSchema> {
  const schema = TR.Data.Schema(definition, testDataConnection())
  await TR.Data.Settle(schema)
  return schema
}

function fillConnection(fill: (request: TaoFillRequest, ops: TaoFillOps) => Promise<void>): TaoDataConnection {
  return { ...testDataConnection(), fill }
}

async function createStory(stories: TR.DataSchema, hnId: number, title: string): Promise<unknown> {
  TR.Data.Create(stories, 'Story', { HnId: TR.Value(hnId), Title: TR.Value(title) })
  await TR.Data.Settle(stories)
  return only(rows(stories, 'Story', [{ field: 'HnId', operator: '==', value: () => TR.Value(hnId) }]))
}

async function createBookmark(bookmarks: TR.DataSchema, story: unknown, note: string): Promise<unknown> {
  TR.Data.Create(bookmarks, 'Bookmark', { Note: TR.Value(note), Story: TR.Value(story) })
  await TR.Data.Settle(bookmarks)
  return rows(bookmarks, 'Bookmark').at(-1)
}

/** storedBookmark lands a bookmark naming a story by value alone, the way a synced replica would. */
async function storedBookmark(bookmarks: TR.DataSchema, hnId: number): Promise<unknown> {
  await bookmarks.restoreCapturedSnapshot(JSON.stringify({
    formatVersion: 1,
    nextId: 2,
    rows: { Bookmark: [{ Id: 'Bookmark-1', Note: '', Story: hnId }] },
    schemaVersion: 1,
  }))
  return only(rows(bookmarks, 'Bookmark'))
}

function rows(schema: TR.DataSchema, entity: string, filters: TaoQueryFilter[] = []): readonly unknown[] {
  // The schema's own query rather than the `TR.Data.Query` hook: these checks run outside React.
  return schema.query({ entity, filters })
}

function only<ItemT>(items: readonly ItemT[]): ItemT {
  Expect(items.length).toBe(1)
  return items[0]!
}

function providerConnection(provider: TR.DataProvider, storageKey: string): TaoDataConnection {
  return provider.connect(Object.freeze({ configuration: Object.freeze({}), schema: storiesDefinition, storageKey }))
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
  }
}
