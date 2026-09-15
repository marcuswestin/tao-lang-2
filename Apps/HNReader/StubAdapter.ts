import TR from '@tao/runtime'

/**
 * A deterministic in-repo feed for journeys: the same declared shapes as the real adapter, no
 * network. Tests run the HNReaderStub variant, so they exercise the real fill machinery — loading,
 * upsert-by-unique, relation resolution — against these canned rows.
 */
const frontPage = [
  {
    HnId: 101,
    Title: 'Show HN: A Tao reader',
    Url: 'https://example.com/tao-reader',
    Score: 42,
    Author: 'tester',
    CommentCount: 2,
    Rank: 1,
  },
  {
    HnId: 102,
    Title: 'Why local-first sync wins',
    Url: '',
    Score: 17,
    Author: 'writer',
    CommentCount: 0,
    Rank: 2,
  },
]

/** A story the stub serves only by id, which is how a bookmark to a story off the front page resolves. */
const offFrontPage = { HnId: 103, Title: 'An older story', Url: '', Score: 5, Author: 'archivist', CommentCount: 0 }

export const StubAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      upsert(frontPage.slice(0, query.limit ?? 30))
    }),
    TR.Http.on({ where: 'HnId' }, async (query, { upsert }) => {
      const id = query.where['HnId']
      upsert([...frontPage, offFrontPage].filter(story => story.HnId === id))
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async (query, { upsert }) => {
      const story = query.where['Story'] as { HnId: number }
      if (story.HnId !== 101) {
        return
      }
      upsert([
        {
          HnId: 1011,
          Story: { HnId: 101 },
          Author: 'alice',
          Text: 'Neat — does the store stay local-first?',
          Depth: 0,
          Ordering: 1,
        },
        {
          HnId: 1012,
          Story: { HnId: 101 },
          Author: 'bob',
          Text: 'Yes, queries evaluate locally.',
          Depth: 1,
          Ordering: 2,
        },
      ])
    }),
  ],
})
