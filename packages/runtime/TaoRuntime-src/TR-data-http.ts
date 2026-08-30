import type { TaoDataProvider, TaoFillOps, TaoFillRequest, TaoQueryDescriptor } from './TR-data'
import { MemoryProvider } from './TR-data-provider'

/**
 * The Http datasource machinery behind `@tao/data`'s `Http` type. The stdlib piece is deliberately
 * a thin, honest machine — descriptor matching, staleness, and error surfacing — while every
 * API-specific truth (which query shape maps to which request, how JSON becomes rows) lives in the
 * app's adapter. A live query matching no declared shape fails loudly; it never silently
 * non-fetches.
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

/** HttpProviderFactory is the zero-argument factory `provider HttpProvider from ./Providers.ts` calls. */
export function HttpProviderFactory(): TaoDataProvider {
  return httpProvider({})
}

const NANOSECONDS_PER_MILLISECOND = 1e6

function httpProvider(config: Readonly<Record<string, unknown>>): TaoDataProvider {
  const adapter = unwrapConfigValue(config['Adapter']) as TaoHttpAdapter | undefined
  const cacheForNs = unwrapConfigValue(config['CacheFor']) as number | undefined
  const base = MemoryProvider()
  return {
    load: storageKey => base.load(storageKey),
    persist: (storageKey, snapshot) => base.persist(storageKey, snapshot),
    referenceToken: reference => base.referenceToken!(reference),
    resolveReference: reference => base.resolveReference!(reference),
    fill: (request, ops) => runAdapterFill(adapter, request, ops),
    fillCacheMs: (cacheForNs ?? 0) / NANOSECONDS_PER_MILLISECOND,
    withConfiguration: configured => httpProvider(configured),
  }
}

async function runAdapterFill(
  adapter: TaoHttpAdapter | undefined,
  request: TaoFillRequest,
  ops: TaoFillOps,
): Promise<void> {
  if (!adapter) {
    throw new Error("An Http datasource requires an 'Adapter' declaring its supported query shapes.")
  }
  const { descriptor } = request
  const shapes = adapter[descriptor.entity]
  const shape = shapes?.find(candidate => shapeMatches(candidate.matches, descriptor))
  if (!shape) {
    throw new Error(
      `The Http adapter declares no query shape matching ${describeDescriptor(descriptor)}. `
        + (shapes?.length
          ? `Declared shapes for '${descriptor.entity}': ${shapes.map(s => describeMatch(s.matches)).join('; ')}.`
          : `It declares no shapes for '${descriptor.entity}' at all.`),
    )
  }
  await shape.fill(descriptor, {
    upsert: rows => ops.upsert(descriptor.entity, rows),
    upsertInto: (entity, rows) => ops.upsert(entity, rows),
  })
}

function shapeMatches(match: TaoHttpMatch, descriptor: TaoQueryDescriptor): boolean {
  const expected = [match.where ?? []].flat().slice().sort()
  const actual = Object.keys(descriptor.where).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) {
    return false
  }
  if (match.orderBy !== undefined && match.orderBy !== descriptor.orderBy) {
    return false
  }
  return match.orderDirection === undefined || match.orderDirection === descriptor.orderDirection
}

function describeDescriptor(descriptor: TaoQueryDescriptor): string {
  const where = Object.keys(descriptor.where)
  const parts = [
    where.length ? `where ${where.join(', ')}` : 'no filters',
    descriptor.orderBy ? `order by ${descriptor.orderBy} ${descriptor.orderDirection}` : 'no ordering',
  ]
  return `'${descriptor.entity}' (${parts.join(', ')})`
}

function describeMatch(match: TaoHttpMatch): string {
  const where = [match.where ?? []].flat()
  return [
    where.length ? `where ${where.join(', ')}` : 'no filters',
    match.orderBy ? `order by ${match.orderBy}` : 'no ordering',
  ].join(', ')
}

function unwrapConfigValue(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'evaluate' in value) {
    return (value as { evaluate(): { jsValue: unknown } }).evaluate().jsValue
  }
  return value
}
