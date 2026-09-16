import TR from '@tao/runtime'

/** Deterministic cold-reference outcomes for the test-only HNReader availability harness. */
const probes = [
  {
    HnId: 901,
    Title: 'Missing history probe',
    Url: '',
    Score: 1,
    Author: 'fixture',
    CommentCount: 0,
    Rank: 1,
  },
  {
    HnId: 902,
    Title: 'Error history probe',
    Url: '',
    Score: 2,
    Author: 'fixture',
    CommentCount: 0,
    Rank: 2,
  },
]

export const UnavailableHistoryAdapter = TR.Http.adapter({
  Story: [
    TR.Http.on({ orderBy: 'Rank' }, async (_query, { upsert }) => {
      upsert(probes)
    }),
    TR.Http.on({ where: 'HnId' }, async query => {
      if (query.where['HnId'] === 902) {
        TR.Errors.failHost('Deterministic history lookup failure.')
      }
      // HnId 901 deliberately returns no row, so the cold reference settles as missing.
    }),
  ],
  Comment: [
    TR.Http.on({ where: 'Story' }, async () => {}),
  ],
})
