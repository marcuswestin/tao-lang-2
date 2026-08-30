import type { TaoQueryDescriptor } from './TR-data'

/**
 * The adapter-authoring surface behind the package-owned `@tao/data/providers/http` datasource. An
 * app declares each supported query shape in a sidecar through `TR.Http.adapter` and `TR.Http.on`;
 * the provider implementation matching descriptors against those shapes lives with the package.
 */

/** TaoHttpFillTools is what one matched shape's fill receives to land fetched rows. */
export type TaoHttpFillTools = {
  /** upsert lands rows in the matched entity, keyed by its unique field. */
  upsert(rows: readonly Record<string, unknown>[]): void
  /** upsertInto lands rows in another entity — parents before children within one fill. */
  upsertInto(entity: string, rows: readonly Record<string, unknown>[]): void
}

/**
 * TaoHttpMatch declares one supported query shape. `where` is matched exactly — the descriptor's
 * equality filters must be exactly this set (none when omitted) — which keeps an unanticipated
 * query loud instead of filled with the wrong superset. A stated `orderBy` or `orderDirection`
 * must match exactly (ordering is how genuinely different feeds over one entity — front page vs.
 * newest — are told apart, and a bounded fetch depends on the direction); an omitted one matches
 * any ordering, because ordering that does not change the fetched row set is applied locally by
 * the store anyway. Shapes are tried in declaration order; first match wins.
 */
export type TaoHttpMatch = {
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
  where?: string | readonly string[]
}

export type TaoHttpShape = {
  fill(query: TaoQueryDescriptor, tools: TaoHttpFillTools): Promise<void>
  matches: TaoHttpMatch
}

/** TaoHttpAdapter maps each entity to the query shapes its API actually supports. */
export type TaoHttpAdapter = Readonly<Record<string, readonly TaoHttpShape[]>>

/** HttpAdapterControls is the published authoring surface for adapter sidecars. */
export const HttpAdapterControls = {
  /** adapter types an adapter literal without changing it. */
  adapter(shapes: TaoHttpAdapter): TaoHttpAdapter {
    return shapes
  },

  /** on declares one supported query shape: `on({ orderBy: 'Rank' }, async (query, tools) => …)`. */
  on(
    matches: TaoHttpMatch,
    fill: (query: TaoQueryDescriptor, tools: TaoHttpFillTools) => Promise<void>,
  ): TaoHttpShape {
    return { fill, matches }
  },
} as const
