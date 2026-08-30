import TR from '@runtime/TR'

/**
 * A deterministic in-repo feed for journeys: the same declared shapes as the real adapter, no
 * network. Tests run the HNReaderStub variant, so they exercise the real fill machinery — loading,
 * upsert-by-unique, relation resolution — against these canned rows.
 */
export const StubAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (query, { upsert }) => {
      upsert([
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
      ].slice(0, query.limit ?? 30))
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
