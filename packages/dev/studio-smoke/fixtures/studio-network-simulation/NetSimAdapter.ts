import TR from '@tao/runtime'

/**
 * A deterministic in-repo feed, matching the fixture's own seeded rows by unique ItemId: the
 * network-simulation smoke drives delay, offline, and declared failure at the fill boundary, never
 * at the adapter, so this adapter only ever needs to serve the same two rows the fixture already
 * knows about.
 */
const seedItems = [
  { ItemId: 1, Title: 'Alpha item' },
  { ItemId: 2, Title: 'Beta item' },
]

export const NetSimAdapter = TR.Http.adapter({
  Item: [
    TR.Http.on({}, async (_query, { upsert }) => {
      upsert(seedItems)
    }),
  ],
})
